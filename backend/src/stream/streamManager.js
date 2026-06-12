import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import { config } from "../core/config.js";
import { buildSourceUrl } from "../core/cctv.js";
import { getCamera, markCameraStatus, logCameraError } from "../services/cameraService.js";
import { recordTraffic } from "../core/traffic.js";
import {
  buildHlsArgs,
  buildRtspInputArgs,
  normalizeHlsMode,
  normalizeRtspTimeoutOption,
  normalizeRtspTransport,
} from "./ffmpegArgs.js";
import { classifyStreamError } from "./streamError.js";

const hlsSessions = new Map();      // cameraId -> session, termasuk stopped/error beberapa menit untuk debug
const hlsStartLocks = new Map();    // cameraId -> Promise<session|null>
const mjpegSessions = new Map();    // cameraId -> shared MJPEG session
const mjpegStartLocks = new Map();  // cameraId -> Promise<session|null>
const streamViewers = new Map();       // cameraId -> Map(viewerId -> { lastSeen, output })
const cameraTrafficTotals = new Map(); // cameraId -> { pullBytes, outBytes }
const cameraTrafficLast = new Map();   // cameraId -> { at, pullBytes, outBytes }
const VIEWER_TTL_MS = 18_000;

function cameraTraffic(id) {
  const key = String(id || "unknown");
  let t = cameraTrafficTotals.get(key);
  if (!t) {
    t = { pullBytes: 0, outBytes: 0 };
    cameraTrafficTotals.set(key, t);
  }
  return t;
}

export function recordCameraTraffic(id, kind, bytes) {
  const n = Number(bytes || 0);
  if (!id || !Number.isFinite(n) || n <= 0) return;
  const t = cameraTraffic(id);
  if (kind === "pull") t.pullBytes += n;
  else if (kind === "out") t.outBytes += n;
}

function nowIso() {
  return new Date().toISOString();
}

function safeViewerId(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_.:-]/g, "")
    .slice(0, 120) || "anonymous";
}

export function removeViewer(id, viewerId) { const k = safeViewerId(viewerId); const v = streamViewers.get(id); if (v) { v.delete(k); if (v.size === 0) streamViewers.delete(id); } }

export function recordViewer(id, viewerId, output = "HLS Stable") {
  if (!id) return;
  const key = safeViewerId(viewerId);
  const now = Date.now();
  let viewers = streamViewers.get(id);
  if (!viewers) {
    viewers = new Map();
    streamViewers.set(id, viewers);
  }
  viewers.set(key, { lastSeen: now, output: normalizeOutput(output) });
  for (const [k, v] of viewers.entries()) {
    if (now - v.lastSeen > VIEWER_TTL_MS) viewers.delete(k);
  }
  if (viewers.size === 0) streamViewers.delete(id);
}

function activeViewerCount(id) {
  const viewers = streamViewers.get(id);
  if (!viewers) return 0;
  const now = Date.now();
  let count = 0;
  for (const [k, v] of viewers.entries()) {
    if (now - v.lastSeen <= VIEWER_TTL_MS) count += 1;
    else viewers.delete(k);
  }
  if (viewers.size === 0) streamViewers.delete(id);
  return count;
}

function redact(value = "") {
  return String(value)
    .replace(/(rtsp|http|https):\/\/([^:\s/@]+):([^@\s/]+)@/gi, "$1://$2:****@")
    .replace(/password=([^&\s]+)/gi, "password=****");
}

function writeDiagnosticLog(session, chunkOrText, { captureError = false } = {}) {
  const raw = Buffer.isBuffer(chunkOrText) ? chunkOrText.toString() : String(chunkOrText || "");
  const text = redact(raw).trimEnd();
  if (!text) return;
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return;
  if (captureError) {
    session.rawError = `${session.rawError || ""}${lines.join("\n")}\n`.slice(-config.streamErrorBytes);
  }
  if (!config.ffmpegLogToConsole && !config.ffmpegLogToFile) return;
  if (config.ffmpegLogToFile) {
    try { fsSync.mkdirSync(config.logDir, { recursive: true }); } catch { /* ignore */ }
  }
  for (const line of lines) {
    const out = `[${nowIso()}][ffmpeg][${session.id}][pid=${session.pid || "-"}][${session.output}] ${line}`;
    if (config.ffmpegLogToConsole) console.error(out);
    if (config.ffmpegLogToFile) {
      try { fsSync.appendFileSync(path.join(config.logDir, "ffmpeg-stream.log"), `${out}\n`); } catch { /* ignore */ }
    }
  }
}

function writeFfmpegLog(session, chunkOrText) {
  writeDiagnosticLog(session, chunkOrText, { captureError: true });
}

function logLifecycle(session, message) {
  writeDiagnosticLog(session, message);
}

export function isChildAlive(child) {
  return child && child.exitCode === null && child.signalCode === null && !child.killed;
}

function scheduleHlsIdleCleanup() {
  const interval = Math.max(5000, Math.floor(config.streamIdleMs / 2));
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of hlsSessions.entries()) {
      const alive = isChildAlive(session.child);
      if (!alive) {
        const closedAt = session.closedAt ? new Date(session.closedAt).getTime() : 0;
        if (closedAt && now - closedAt > config.streamErrorRetentionMs) hlsSessions.delete(id);
        continue;
      }
      if (session.lastRequestAt && now - session.lastRequestAt > config.streamIdleMs) {
        session.status = "idle-timeout";
        logLifecycle(session, `idle timeout ${config.streamIdleMs}ms, stopping ffmpeg`);
        session.child.kill("SIGTERM");
      }
    }
  }, interval);
  timer.unref?.();
}

scheduleHlsIdleCleanup();

function normalizeOutput(output = "HLS Stable") {
  return output === "HLS Low Latency" || output === "ll" ? "HLS Low Latency" : "HLS Stable";
}

function streamDir(id, output = "HLS Stable") {
  return path.join(config.storageDir, "hls", id, output.replace(/\W+/g, "_").toLowerCase());
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; }
  catch { return false; }
}

async function playlistReady(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.includes("#EXTINF") && raw.includes(".ts");
  } catch {
    return false;
  }
}

function maskArgs(args) {
  return args.map((arg) => redact(arg));
}

async function cleanDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

export async function startHls(id, requestedOutput = "HLS Stable") {
  const output = normalizeOutput(requestedOutput);
  const existing = hlsSessions.get(id);
  if (existing) {
    if (isChildAlive(existing.child)) {
      if (existing.output === output) {
        existing.lastRequestAt = Date.now();
        return existing;
      }
      await stopHls(id);
    } else {
      const closedAtMs = existing.closedAt ? new Date(existing.closedAt).getTime() : 0;
      if (existing.status === "error" && Date.now() - closedAtMs < 10000) {
        return existing;
      }
    }
  }

  const locked = hlsStartLocks.get(id);
  if (locked) {
    const session = await locked;
    if (session) session.lastRequestAt = Date.now();
    return session;
  }

  await stopMjpeg(id);

  const startPromise = (async () => {
    const camera = await getCamera(id, { revealSecret: true });
    if (!camera) return null;
    if (!camera.enabled) {
      const err = new Error("Camera disabled");
      err.status = 409;
      throw err;
    }

    const dir = streamDir(id, output);
    await cleanDir(dir);
    const args = buildHlsArgs({ camera, output, dir, options: config });
    const child = spawn(config.ffmpegBin, args, { stdio: ["ignore", "ignore", "pipe"] });
    const session = {
      id,
      key: id,
      output,
      hlsMode: normalizeHlsMode(camera.hlsMode, config),
      rtspTransport: normalizeRtspTransport(camera.rtspTransport, config),
      rtspTimeoutOption: normalizeRtspTimeoutOption(camera.rtspTimeoutOption, config),
      dir,
      playlist: path.join(dir, "index.m3u8"),
      child,
      pid: child.pid,
      startedAt: nowIso(),
      status: "starting",
      rawError: "",
      lastRequestAt: Date.now(),
    };
    hlsSessions.set(id, session);
    await markCameraStatus(id, { status: "starting" });

    logLifecycle(session, `spawn: ${config.ffmpegBin} ${maskArgs(args).join(" ")}`);

    child.stderr.on("data", (chunk) => writeFfmpegLog(session, chunk));
    child.on("spawn", () => {
      session.status = "starting";
      session.pid = child.pid;
    });
    child.on("close", async (code, signal) => {
      const wasRequestedStop = session.status === "stopped" || session.status === "idle-timeout";
      if (!wasRequestedStop) {
        session.status = signal === "SIGTERM" ? "stopped" : code === 0 ? "ended" : "error";
      } else if (session.status === "idle-timeout" && signal === "SIGTERM") {
        session.status = "stopped";
      }
      session.exitCode = code;
      session.signalCode = signal;
      session.closedAt = nowIso();
      logLifecycle(session, `closed: code=${code} signal=${signal || "-"}`);
      if (!wasRequestedStop && code !== 0 && signal !== "SIGTERM") {
        await markCameraStatus(id, { status: "offline" });
        await logCameraError(id, `Stream stopped unexpectedly (Code: ${code}, Signal: ${signal})`);
      }
    });
    child.on("error", async (err) => {
      session.status = "error";
      session.rawError = err.message;
      session.closedAt = nowIso();
      logLifecycle(session, `spawn error: ${err.message}`);
      await markCameraStatus(id, { status: "offline" });
      await logCameraError(id, `Spawn error: ${err.message}`);
    });
    return session;
  })().finally(() => hlsStartLocks.delete(id));

  hlsStartLocks.set(id, startPromise);
  return startPromise;
}

export async function stopHls(id, _output) {
  const stopped = [];
  const stopOne = (cameraId, session) => {
    if (!session) return;
    if (isChildAlive(session.child)) session.child.kill("SIGTERM");
    session.status = "stopped";
    session.closedAt = nowIso();
    stopped.push(cameraId);
  };

  if (id) {
    stopOne(id, hlsSessions.get(id));
  } else {
    for (const [cameraId, session] of hlsSessions.entries()) stopOne(cameraId, session);
  }
  return stopped;
}

export async function waitForPlaylist(session) {
  const started = Date.now();
  while (Date.now() - started < config.hlsStartTimeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    if (await playlistReady(session.playlist)) return true;
    if (!isChildAlive(session.child) && session.status !== "starting") return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return exists(session.playlist);
}

export function getHlsFilePath(id, output, filename) {
  const safeName = filename || "index.m3u8";
  if (safeName.includes("..") || safeName.includes("/") || safeName.includes("\\")) return null;
  return path.join(streamDir(id, normalizeOutput(output)), safeName);
}

function proxyHttpMjpeg(id, camera, res) {
  const source = buildSourceUrl(camera);
  const url = new URL(source);
  const client = url.protocol === "https:" ? https : http;
  let firstByte = false;
  const req = client.get(url, async (upstream) => {
    if ((upstream.statusCode || 200) < 400) await markCameraStatus(id, { status: "online", lastSeen: nowIso() });
    res.writeHead(upstream.statusCode || 200, {
      "Content-Type": upstream.headers["content-type"] || "multipart/x-mixed-replace; boundary=frame",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Connection": "close",
    });
    upstream.on("data", (chunk) => {
      firstByte = true;
      recordCameraTraffic(id, "pull", chunk.length);
      recordCameraTraffic(id, "out", chunk.length);
    });
    upstream.pipe(res);
  });
  req.setTimeout(config.mjpegStartTimeoutMs, () => {
    if (!firstByte) req.destroy(new Error(`MJPEG timeout ${config.mjpegStartTimeoutMs}ms: tidak ada frame dari source`));
  });
  req.on("error", async (err) => {
    await markCameraStatus(id, { status: "offline" });
    if (!res.headersSent) res.status(504).json({ error: err.message });
    else res.end();
  });
  res.on("close", () => req.destroy());
}

function extractJpegs() {
  let buffer = Buffer.alloc(0);
  return (chunk, onFrame) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
      const end = start >= 0 ? buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2) : -1;
      if (start < 0 || end < 0) {
        if (buffer.length > 4_000_000) buffer = buffer.slice(-256_000);
        break;
      }
      const frame = buffer.slice(start, end + 2);
      buffer = buffer.slice(end + 2);
      onFrame(frame);
    }
  };
}

function writeMjpegFrame(id, res, frame) {
  if (res.writableEnded || res.destroyed) return;
  const header = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;
  res.write(header);
  res.write(frame);
  res.write("\r\n");
  recordCameraTraffic(id, "out", Buffer.byteLength(header) + frame.length + 2);
}

async function startSharedMjpeg(id) {
  const existing = mjpegSessions.get(id);
  if (existing && isChildAlive(existing.child)) return existing;

  const locked = mjpegStartLocks.get(id);
  if (locked) return locked;

  await stopHls(id);

  const startPromise = (async () => {
    const camera = await getCamera(id, { revealSecret: true });
    if (!camera) return null;
    if (!camera.enabled) {
      const err = new Error("Camera disabled");
      err.status = 409;
      throw err;
    }
    const source = buildSourceUrl(camera);
    const args = [
      "-hide_banner", "-nostdin",
      "-fflags", "nobuffer",
      "-loglevel", config.ffmpegLogLevel,
      ...buildRtspInputArgs(camera, config),
      "-i", source,
      "-an",
      "-vf", `fps=${config.mjpegFps}${camera.streamQuality && camera.streamQuality !== "Auto" ? `,scale=-2:${camera.streamQuality.replace("p", "")}` : `,scale=${config.mjpegWidth}:-2`}`,
      "-q:v", String(config.mjpegQuality),
      "-f", "mjpeg",
      "pipe:1",
    ];
    const child = spawn(config.ffmpegBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const session = {
      id,
      output: "MJPEG",
      hlsMode: "mjpeg",
      rtspTransport: normalizeRtspTransport(camera.rtspTransport, config),
      rtspTimeoutOption: normalizeRtspTimeoutOption(camera.rtspTimeoutOption, config),
      child,
      pid: child.pid,
      clients: new Set(),
      startedAt: nowIso(),
      status: "starting",
      rawError: "",
      lastFrame: null,
      frameWaiters: new Set(),
      stopTimer: null,
    };
    mjpegSessions.set(id, session);
    await markCameraStatus(id, { status: "starting" });
    logLifecycle(session, `spawn: ${config.ffmpegBin} ${maskArgs(args).join(" ")}`);
    const parse = extractJpegs();

    child.stdout.on("data", (chunk) => {
      recordCameraTraffic(id, "pull", chunk.length);
      parse(chunk, (frame) => {
        session.status = "running";
        session.lastFrame = frame;
        if (!session.onlineMarked) { session.onlineMarked = true; void markCameraStatus(id, { status: "online", lastSeen: nowIso() }); }
        for (const waiter of [...session.frameWaiters || []]) waiter(true);
        session.frameWaiters?.clear?.();
        for (const client of [...session.clients]) writeMjpegFrame(id, client, frame);
      });
    });
    child.stderr.on("data", (chunk) => writeFfmpegLog(session, chunk));
    child.on("spawn", () => {
      session.status = "starting";
      session.pid = child.pid;
    });
    child.on("close", async (code, signal) => {
      session.status = signal === "SIGTERM" ? "stopped" : code === 0 ? "ended" : "error";
      session.exitCode = code;
      session.signalCode = signal;
      session.closedAt = nowIso();
      logLifecycle(session, `closed: code=${code} signal=${signal || "-"}`);
      for (const waiter of [...session.frameWaiters || []]) waiter(false);
      session.frameWaiters?.clear?.();
      for (const client of [...session.clients]) {
        if (!client.writableEnded) client.end();
      }
      session.clients.clear();
      if (mjpegSessions.get(id) === session) mjpegSessions.delete(id);
      if (code !== 0 && signal !== "SIGTERM") {
        await markCameraStatus(id, { status: "offline" });
        await logCameraError(id, `Stream stopped unexpectedly (Code: ${code}, Signal: ${signal})`);
      }
    });
    child.on("error", async (err) => {
      session.status = "error";
      session.rawError = err.message;
      session.closedAt = nowIso();
      logLifecycle(session, `spawn error: ${err.message}`);
      for (const waiter of [...session.frameWaiters || []]) waiter(false);
      session.frameWaiters?.clear?.();
      if (mjpegSessions.get(id) === session) mjpegSessions.delete(id);
      await markCameraStatus(id, { status: "offline" });
      await logCameraError(id, `Spawn error: ${err.message}`);
    });
    return session;
  })().finally(() => mjpegStartLocks.delete(id));

  mjpegStartLocks.set(id, startPromise);
  return startPromise;
}

function scheduleMjpegStop(id, session) {
  if (session.stopTimer) clearTimeout(session.stopTimer);
  session.stopTimer = setTimeout(() => {
    if (session.clients.size > 0) return;
    if (isChildAlive(session.child)) session.child.kill("SIGTERM");
    mjpegSessions.delete(id);
  }, config.streamIdleMs);
}

export async function waitForMjpegFrame(session, timeoutMs = config.mjpegStartTimeoutMs) {
  if (!session) return false;
  if (session.lastFrame) return true;
  if (!isChildAlive(session.child)) return false;
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      session.frameWaiters?.delete?.(finish);
      resolve(Boolean(ok));
    };
    const timer = setTimeout(() => finish(false), Math.max(1000, timeoutMs));
    session.frameWaiters?.add?.(finish);
  });
}

export async function startMjpeg(id) {
  return startSharedMjpeg(id);
}

export async function serveMjpeg(id, res) {
  const camera = await getCamera(id, { revealSecret: true });
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  if (!camera.enabled) {
    res.status(409).json({ error: "Camera disabled" });
    return;
  }

  if (camera.sourceType === "MJPEG") {
    proxyHttpMjpeg(id, camera, res);
    return;
  }

  const session = await startSharedMjpeg(id);
  if (!session) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  if (session.stopTimer) {
    clearTimeout(session.stopTimer);
    session.stopTimer = null;
  }

  const ready = await waitForMjpegFrame(session);
  if (!ready) {
    session.status = "error";
    const msg = classifyStreamError(session.rawError)?.message
      || "Kamera tidak mengirim frame sebelum batas waktu. Periksa IP, port, path, dan jaringan kamera.";
    await markCameraStatus(id, { status: "offline" });
    if (isChildAlive(session.child) && session.clients.size === 0) session.child.kill("SIGTERM");
    res.status(504).json({ error: msg });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Connection": "close",
  });

  session.clients.add(res);
  if (session.lastFrame) writeMjpegFrame(id, res, session.lastFrame);
  res.on("close", () => {
    session.clients.delete(res);
    if (session.clients.size === 0) scheduleMjpegStop(id, session);
  });
}

export function streamStatus() {
  const now = Date.now();
  const items = [];
  for (const [id, session] of hlsSessions.entries()) {
    items.push({
      key: id,
      id: session.id,
      output: session.output,
      hlsMode: session.hlsMode,
      rtspTransport: session.rtspTransport,
      rtspTimeoutOption: session.rtspTimeoutOption || "none",
      pid: session.pid,
      status: isChildAlive(session.child) ? session.status : session.status || "stopped",
      startedAt: session.startedAt,
      closedAt: session.closedAt || null,
      exitCode: session.exitCode ?? null,
      signalCode: session.signalCode ?? null,
      lastRequestAt: session.lastRequestAt ? new Date(session.lastRequestAt).toISOString() : null,
      idleSeconds: session.lastRequestAt ? Math.round((now - session.lastRequestAt) / 1000) : null,
      viewers: activeViewerCount(id),
      error: classifyStreamError(session.rawError),
      playlistReady: fsSync.existsSync(session.playlist),
    });
  }
  for (const [id, session] of mjpegSessions.entries()) {
    items.push({
      key: `${id}:mjpeg`,
      id,
      output: "MJPEG",
      rtspTransport: session.rtspTransport,
      rtspTimeoutOption: session.rtspTimeoutOption || "none",
      pid: session.pid,
      status: isChildAlive(session.child) ? session.status : session.status || "stopped",
      clients: activeViewerCount(id),
      startedAt: session.startedAt,
      closedAt: session.closedAt || null,
      exitCode: session.exitCode ?? null,
      signalCode: session.signalCode ?? null,
      error: classifyStreamError(session.rawError),
    });
  }
  return items;
}

function estimatedKbpsFor(streamType) {
  return streamType === "MJPEG"
    ? config.mjpegBandwidthKbps
    : streamType === "HLS Low Latency"
      ? config.hlsLowLatencyBandwidthKbps
      : config.hlsStableBandwidthKbps;
}

export function streamRuntimeStatusFor(id) {
  const hls = hlsSessions.get(id);
  if (hls && isChildAlive(hls.child)) {
    return hls.status === "running" ? "online" : "starting";
  }
  const mjpeg = mjpegSessions.get(id);
  if (mjpeg && isChildAlive(mjpeg.child)) {
    return mjpeg.status === "running" ? "online" : "starting";
  }
  return null;
}

function cameraTrafficRatesFor(id, fallbackPullKbps = 0, fallbackOutKbps = 0) {
  const now = Date.now();
  const totals = cameraTraffic(id);
  const prev = cameraTrafficLast.get(id) || { at: now, pullBytes: totals.pullBytes, outBytes: totals.outBytes };
  const elapsed = Math.max(0.25, (now - prev.at) / 1000);
  const measuredPull = (totals.pullBytes - prev.pullBytes) / elapsed;
  const measuredOut = (totals.outBytes - prev.outBytes) / elapsed;
  cameraTrafficLast.set(id, { at: now, pullBytes: totals.pullBytes, outBytes: totals.outBytes });
  return {
    pullBytesPerSec: Math.max(0, measuredPull, (Number(fallbackPullKbps || 0) * 1000) / 8),
    outBytesPerSec: Math.max(0, measuredOut, (Number(fallbackOutKbps || 0) * 1000) / 8),
  };
}

export function streamMetricsFor(id, streamType) {
  let viewers = 0;
  let running = false;
  let starting = false;
  const hls = hlsSessions.get(id);
  if (hls && isChildAlive(hls.child)) {
    running = hls.status === "running";
    starting = hls.status !== "running";
  const mjpeg = mjpegSessions.get(id);
  if (mjpeg && isChildAlive(mjpeg.child)) {
    running = running || mjpeg.status === "running";
    starting = starting || mjpeg.status !== "running";
  }
  if (running || starting) {
    viewers = activeViewerCount(id);
  }
  const perViewerKbps = estimatedKbpsFor(streamType);
  const fallbackOutKbps = viewers === 0 ? 0 : perViewerKbps * viewers;
  const fallbackPullKbps = (running || starting) ? perViewerKbps : 0;
  const rates = cameraTrafficRatesFor(id, fallbackPullKbps, fallbackOutKbps);
  const bandwidthKbps = (rates.outBytesPerSec * 8) / 1000;
  const cctvPullKbps = (rates.pullBytesPerSec * 8) / 1000;
  const latencyMs = viewers === 0 ? 0 : streamType === "MJPEG" ? 700 : streamType === "HLS Low Latency" ? 650 : 1800;
  return {
    viewers, running, starting,
    bandwidthKbps, cctvPullKbps, latencyMs,
    outBytesPerSec: rates.outBytesPerSec,
    pullBytesPerSec: rates.pullBytesPerSec,
  };
}

export function streamSystemMetrics() {
  let cctvPullKbps = 0;
  let cctvOutKbps = 0;
  let viewers = 0;
  let activeProcesses = 0;
  const seen = new Set();
  for (const [id, session] of hlsSessions.entries()) {
    if (!isChildAlive(session.child)) continue;
    activeProcesses += 1;
    const type = session.output || "HLS Stable";
    const per = estimatedKbpsFor(type);
    cctvPullKbps += per;
    const v = activeViewerCount(id);
    viewers += v;
    cctvOutKbps += per * v;
    seen.add(id);
  }
  for (const [id, session] of mjpegSessions.entries()) {
    if (!isChildAlive(session.child)) continue;
    activeProcesses += 1;
    const per = estimatedKbpsFor("MJPEG");
    cctvPullKbps += per;
    const v = activeViewerCount(id);
    viewers += v;
    cctvOutKbps += per * v;
    seen.add(id);
  }
  return { cctvPullKbps, cctvOutKbps, viewers, activeProcesses, activeCameras: seen.size };
}

export async function stopMjpeg(id) {
  const mjpeg = mjpegSessions.get(id);
  if (mjpeg) {
    if (isChildAlive(mjpeg.child)) mjpeg.child.kill("SIGTERM");
    mjpeg.status = "stopped";
    mjpeg.closedAt = nowIso();
    mjpegSessions.delete(id);
    return true;
  }
  return false;
}

export async function stopCameraStreams(id) {
  const stopped = await stopHls(id);
  if (await stopMjpeg(id)) {
    stopped.push(`${id}:mjpeg`);
  }
  return stopped;
}

export async function stopAllStreams() {
  await stopHls();
  for (const [id, session] of mjpegSessions.entries()) {
    if (isChildAlive(session.child)) session.child.kill("SIGTERM");
    session.status = "stopped";
    session.closedAt = nowIso();
    mjpegSessions.delete(id);
  }
}
