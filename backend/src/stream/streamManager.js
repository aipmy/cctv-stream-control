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
import { triggerEvent, updateLastMotionAt, extendEventDuration } from "../services/recordingService.js";
import { CameraMotionEngine, motionEmitter } from "../core/motionEngine.js";

const motionEngines = new Map(); // cameraId -> CameraMotionEngine

const activeMotionEvents = new Map(); // cameraId -> { eventId, lastMotionAt }

export function getOngoingEventIds() {
  const ids = [];
  for (const active of activeMotionEvents.values()) {
    if (active.eventId && active.eventId !== "pending") {
      ids.push(active.eventId);
    }
  }
  return ids;
}

async function handleMotionDetected(camera, predictions = null, pixelBoxes = null, snapshotBuffer = null) {
  const now = Date.now();
  if (camera.name === "LivingRoom") {
    console.log(`[Motion Debug] handleMotionDetected for LivingRoom called! predictions=${predictions ? predictions.length : "null"}, pixelBoxes=${pixelBoxes ? pixelBoxes.length : "null"}`);
  }

  // Always update last motion timestamp (used by smart recording stop)
  updateLastMotionAt(camera.id, now);

  const modes = camera.detectionModes || ["pixel", "human", "pet"];
  let shouldTrigger = false;
  let reason = "motion";

  if (!predictions) {
    shouldTrigger = modes.includes("pixel");
  } else if (predictions.length === 0) {
    shouldTrigger = modes.includes("pixel");
  } else {
    for (const p of predictions) {
      if (modes.includes("human") && p.class === "person") {
        shouldTrigger = true; reason = "person"; break;
      }
      if (modes.includes("pet") && ["cat", "dog", "bird", "horse", "sheep", "cow"].includes(p.class)) {
        shouldTrigger = true; reason = p.class; break;
      }
      if (modes.includes("vehicle") && ["car", "motorcycle", "bus", "truck", "bicycle"].includes(p.class)) {
        shouldTrigger = true; reason = p.class; break;
      }
    }
    if (!shouldTrigger && modes.includes("pixel")) {
      shouldTrigger = true; reason = "motion";
    }
  }

  if (!shouldTrigger) {
    if (camera.name === "LivingRoom") {
      console.log(`[Motion Debug] LivingRoom motion ignored. modes: ${JSON.stringify(modes)}, predictions: ${predictions ? predictions.length : "null"}`);
    }
    return;
  }

  const active = activeMotionEvents.get(camera.id);
  if (active) {
    // If the event has been ongoing for more than 15 minutes (900000 ms), force close it
    // to prevent excessively long events. A new event will be created.
    if (now - active.startedAt > 900000) {
      console.log(`[Motion Detection] ⏱️ Event ${active.eventId} reached max duration (15m). Closing and starting a new one.`);
      activeMotionEvents.delete(camera.id);
    } else {
      // Extend the existing event
      active.lastMotionAt = now;
      return;
    }
  }

  // Trigger a NEW event
  console.log(`[Motion Detection] ⚠️ ${reason} detected on camera: ${camera.name} (${camera.id})!`);
  // Prevent async race condition
  activeMotionEvents.set(camera.id, { eventId: "pending", lastMotionAt: now, startedAt: now });
  try {
    const newEvent = await triggerEvent(camera.id, reason, { predictions, pixelBoxes, snapshotBuffer });
    const active = activeMotionEvents.get(camera.id);
    if (active && newEvent) {
      active.eventId = newEvent.id;
    }
  } catch (err) {
    console.error(`[Motion Detection] Failed to trigger event for camera ${camera.id}:`, err);
  }
}

// Background watchdog to update endTimes and cleanup
setInterval(async () => {
  const now = Date.now();
  for (const [cameraId, active] of activeMotionEvents.entries()) {
    try {
      if (active.eventId === "pending") continue;
      // Update the event's end time in the database continuously
      const eventExists = await extendEventDuration(active.eventId, active.lastMotionAt);

      if (!eventExists) {
        console.log(`[Motion Detection] ⚠️ Event ${active.eventId} not found in DB. Resetting state for ${cameraId}`);
        activeMotionEvents.delete(cameraId);
        continue;
      }

      // If no motion for 60 seconds, mark as ended locally
      if (now - active.lastMotionAt > 60000) {
        console.log(`[Motion Detection] 🛑 Motion ended for camera ${cameraId} (Event: ${active.eventId})`);
        activeMotionEvents.delete(cameraId);
      }
    } catch (e) {
      console.error(`[Motion Detection Watchdog] Error extending event ${active.eventId}: `, e);
    }
  }
}, 5000);

function getMotionEngine(cameraId) {
  let engine = motionEngines.get(cameraId);
  if (!engine) {
    engine = new CameraMotionEngine(cameraId);
    motionEngines.set(cameraId, engine);
  }
  return engine;
}

const hlsSessions = new Map();      // cameraId -> session, termasuk stopped/error beberapa menit untuk debug
const hlsStartLocks = new Map();    // cameraId -> Promise<session|null>
const mjpegSessions = new Map();    // cameraId -> shared MJPEG session
const mjpegStartLocks = new Map();  // cameraId -> Promise<session|null>
const streamViewers = new Map();       // cameraId -> Map(viewerId -> { lastSeen, output })
const cameraTrafficTotals = new Map(); // cameraId -> { pullBytes, outBytes }
const cameraTrafficLast = new Map();   // cameraId -> { at, pullBytes, outBytes }
const audioFailures = new Set();       // cameraId
const VIEWER_TTL_MS = 18_000;

export { motionEmitter, mjpegSessions };

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

export function recordViewer(id, viewerId, output = "HLS Stable", details = {}) {
  if (!id) return;
  const key = safeViewerId(viewerId);
  const now = Date.now();
  let viewers = streamViewers.get(id);
  if (!viewers) {
    viewers = new Map();
    streamViewers.set(id, viewers);
  }
  viewers.set(key, {
    lastSeen: now,
    output: normalizeOutput(output),
    username: details.username || "anonymous",
    ip: details.ip || "",
    userAgent: details.userAgent || "",
  });
  for (const [k, v] of viewers.entries()) {
    if (now - v.lastSeen > VIEWER_TTL_MS) viewers.delete(k);
  }
  if (viewers.size === 0) streamViewers.delete(id);
}

export function getActiveViewerList(id) {
  const viewers = streamViewers.get(id);
  if (!viewers) return [];
  const now = Date.now();
  const list = [];
  for (const [k, v] of viewers.entries()) {
    if (now - v.lastSeen <= VIEWER_TTL_MS) {
      list.push({
        id: k,
        username: v.username || "anonymous",
        ip: v.ip || "",
        userAgent: v.userAgent || "",
        output: v.output,
        lastSeenAgoSeconds: Math.round((now - v.lastSeen) / 1000)
      });
    } else {
      viewers.delete(k);
    }
  }
  return list;
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
  return child && child.exitCode === null && child.signalCode === null;
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
      
      // Watchdog: Detect frozen stream (no frames for 45s)
      if (session.lastFrameAt && now - session.lastFrameAt > 45000) {
        logLifecycle(session, `watchdog timeout: no frames received for 45s, stream appears stuck. Killing ffmpeg.`);
        session.status = "error";
        session.rawError = "Stream frozen (Watchdog timeout: no frames received)";
        session.child.kill("SIGKILL");
        continue;
      }

      if (session.keepAlive) {
        session.lastRequestAt = now;
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
  return path.join("/tmp", "cctv_hls", id, output.replace(/\W+/g, "_").toLowerCase());
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

  const locked = hlsStartLocks.get(id);
  if (locked) {
    const session = await locked;
    if (session) session.lastRequestAt = Date.now();
    return session;
  }

  const startPromise = (async () => {
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

    const camera = await getCamera(id, { revealSecret: true });
    if (!camera) return null;
    if (!camera.enabled) {
      const err = new Error("Camera disabled");
      err.status = 409;
      throw err;
    }

    const dir = streamDir(id, output);
    let recordDir = null;

    if (camera.enableRecording) {
      // Always separate live stream (goes to /tmp) from recording (goes to HDD)
      const needsSeparateRecordOutput = true;

      if (needsSeparateRecordOutput) {
        recordDir = path.join(config.storageDir, "record_hls", id);
        await fs.mkdir(recordDir, { recursive: true });
        await fs.unlink(path.join(recordDir, "index.m3u8")).catch(() => {});
      } else {
        const oldRecordDir = path.join(config.storageDir, "record_hls", id);
        await fs.rm(oldRecordDir, { recursive: true, force: true }).catch(() => {});
      }

      await fs.mkdir(dir, { recursive: true });
      await fs.unlink(path.join(dir, "index.m3u8")).catch(() => {});
    } else {
      await cleanDir(dir);
    }
    
    const audioFallback = audioFailures.has(id);
    const args = buildHlsArgs({ camera, output, dir, recordDir, options: config, audioFallback });

    const hasSmartFeatures = Boolean(camera.enableSmartDetection ?? (camera.enableRecording || camera.enableNotifications));

    const child = spawn(config.ffmpegBin, args, { stdio: ["ignore", "pipe", "pipe"] });
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
      keepAlive: Boolean(camera.enableRecording || camera.enableNotifications),
      lastFrame: null,
      lastFrameAt: Date.now(),
    };
    hlsSessions.set(id, session);
    await markCameraStatus(id, { status: "starting" });

    logLifecycle(session, `spawn: ${config.ffmpegBin} ${maskArgs(args).join(" ")}`);

    const parse = extractJpegs();
    child.stdout.on("data", (chunk) => {
      recordCameraTraffic(id, "pull", chunk.length);
      parse(chunk, (frame) => {
        session.lastFrame = frame;
        session.lastFrameAt = Date.now();
        
        // Feed frame to pixel-diff motion engine (non-blocking)
        const hasSmart = Boolean(camera.enableSmartDetection ?? (camera.enableRecording || camera.enableNotifications));
        const hasListeners = motionEmitter.listenerCount(`motion-${id}`) > 0;
        const hasAiListeners = motionEmitter.listenerCount(`ai-motion-${id}`) > 0;
        
        if (hasSmart || hasListeners || hasAiListeners) {
          try {
            const nowMs = Date.now();
            let pixelMotionDetected = false;

            // 1. Basic Motion Engine (runs every 250ms for smooth UI tracking)
            if (!session.lastMotionProcess || nowMs - session.lastMotionProcess > 250) {
              session.lastMotionProcess = nowMs;
              const engine = getMotionEngine(id);
              const result = engine.processFrame(frame, {
                sensitivity: camera.motionSensitivity ?? 50,
                excludeAreas: camera.excludeAreas || [],
              });
              pixelMotionDetected = Boolean(result && result.motion);
              
              // If basic motion detected something, trigger fallback (especially for 'pixel' mode)
              if (pixelMotionDetected && hasSmart) {
                const pixelBoxes = result.boxes.map(b => ({
                  ...b,
                  frameWidth: result.width,
                  frameHeight: result.height
                }));
                void handleMotionDetected(camera, null, pixelBoxes, frame); // Pass null so it relies purely on pixel mode
              }
            }

            // 2. Continuous AI Engine (runs independently)
            // session.aiBusy lock prevents worker queue buildup
            const modes = camera.detectionModes || ["pixel", "human", "pet"];
            const hasAiModes = modes.some(m => ["human", "pet", "object", "vehicle"].includes(m));
            const needsAi = (hasSmart && hasAiModes) || hasAiListeners;

            const aiIntervalMs = Math.max(200, 1000 / (camera.detectFps || 1));
            if (needsAi && !session.aiBusy && (!session.lastAiProcess || nowMs - session.lastAiProcess > aiIntervalMs)) {
              session.aiBusy = true;
              
              
              import("../core/aiDetector.js").then(ai => {
                const threshold = (camera.aiSensitivity ?? 50) / 100;
                ai.detectObjects(frame, threshold).then(predictions => {
                  session.aiBusy = false;
                  session.lastAiProcess = Date.now();
                  
                  if (predictions === null) return; // Frame was dropped, do not wipe previous UI boxes
                  
                  // Filter predictions by camera detection modes
                  const modes = camera.detectionModes || ["pixel", "human", "pet"];
                  const PERSON_CLASSES = ["person"];
                  const PET_CLASSES = ["cat", "dog", "bird", "horse", "sheep", "cow"];
                  const VEHICLE_CLASSES = ["car", "motorcycle", "bus", "truck", "bicycle"];
                  
                  const filtered = (predictions || []).filter(p => {
                    if (modes.includes("human") && PERSON_CLASSES.includes(p.class)) return true;
                    if (modes.includes("pet") && PET_CLASSES.includes(p.class)) return true;
                    if (modes.includes("object") && !PERSON_CLASSES.includes(p.class) && !PET_CLASSES.includes(p.class)) return true;
                    if (modes.includes("vehicle") && VEHICLE_CLASSES.includes(p.class)) return true;
                    return false;
                  });
                  
                  let finalPredictions = filtered;
                  const now = Date.now();
                  
                  if (filtered.length > 0) {
                    session.lastAiPredictions = filtered;
                    session.lastAiPredictionTime = now;
                  } else if (session.lastAiPredictions && now - session.lastAiPredictionTime < 2000) {
                    // Temporal smoothing: Keep the box for 2 seconds if the AI momentarily drops it
                    finalPredictions = session.lastAiPredictions;
                  } else {
                    session.lastAiPredictions = null;
                  }
                  
                  // Emit filtered AI results (>= 10%) to frontend via SSE so they appear in live view
                  motionEmitter.emit(`ai-motion-${id}`, {
                    ts: new Date().toISOString(),
                    predictions: finalPredictions
                  });

                  // Filter again strictly for events (must meet camera's AI Sensitivity setting)
                  const eventFiltered = finalPredictions.filter(p => p.score >= threshold);

                  // If AI found matching objects that meet the sensitivity threshold, trigger recording/notification
                  if (eventFiltered.length > 0 && hasSmart) {
                    void handleMotionDetected(camera, eventFiltered, null, frame);
                  }
                }).catch(err => {
                  session.aiBusy = false;
                  session.lastAiProcess = Date.now();
                  console.error("[AI Engine Error]", err);
                });
              }).catch(err => {
                session.aiBusy = false;
                session.lastAiProcess = Date.now();
                console.error("[AI Load Error]", err);
              });
            }
          } catch (e) { /* ignore */ }
        }

        // Feed frame to any registered MJPEG clients
        const mjpeg = mjpegSessions.get(id);
        if (mjpeg) {
          mjpeg.status = "running";
          mjpeg.lastFrame = frame;
          for (const waiter of [...mjpeg.frameWaiters || []]) waiter(true);
          mjpeg.frameWaiters?.clear?.();
          for (const client of [...mjpeg.clients]) {
            writeMjpegFrame(id, client, frame);
          }
        }
      });
    });

    child.stderr.on("data", (chunk) => {
      writeFfmpegLog(session, chunk);
    });
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
        if (camera.audioMode === "Auto" && !audioFailures.has(id)) {
          audioFailures.add(id);
          session.rawError += "\n[Audio Fallback] FFmpeg crashed. Mematikan audio untuk percobaan berikutnya.";
        }
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
  const stopOne = async (cameraId, session) => {
    if (!session) return;
    if (isChildAlive(session.child)) {
      await new Promise((resolve) => {
        let exited = false;
        session.child.once("close", () => {
          exited = true;
          resolve();
        });
        session.child.kill("SIGTERM");
        setTimeout(() => {
          if (!exited && isChildAlive(session.child)) {
            console.log(`[StreamManager] Process ${session.pid} (Camera: ${cameraId}) did not exit on SIGTERM. Sending SIGKILL...`);
            session.child.kill("SIGKILL");
          }
          resolve();
        }, 2000);
      });
    }
    session.status = "stopped";
    session.closedAt = nowIso();
    stopped.push(cameraId);
  };

  if (id) {
    await stopOne(id, hlsSessions.get(id));
    hlsSessions.delete(id);
  } else {
    for (const [cameraId, session] of hlsSessions.entries()) {
      await stopOne(cameraId, session);
    }
    hlsSessions.clear();
  }
  return stopped;
}

export async function waitForPlaylist(session) {
  const started = Date.now();
  while (Date.now() - started < config.hlsStartTimeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    if (await playlistReady(session.playlist)) {
      session.status = "running";
      await markCameraStatus(session.id, { status: "online", lastSeen: nowIso() });
      return true;
    }
    if (!isChildAlive(session.child) && session.status !== "starting") return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const ok = await exists(session.playlist);
  if (ok) {
    session.status = "running";
    await markCameraStatus(session.id, { status: "online", lastSeen: nowIso() });
  }
  return ok;
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
  let frameCount = 0;
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
      frameCount++;
      if (frameCount % 10 === 0) console.log(`[extractJpegs] parsed ${frameCount} frames, buffer size ${buffer.length}`);
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
  if (existing) return existing;

  const hlsSession = await startHls(id);
  if (!hlsSession) return null;

  const session = {
    id,
    output: "MJPEG",
    clients: new Set(),
    startedAt: nowIso(),
    status: hlsSession.status === "running" ? "running" : "starting",
    rawError: "",
    lastFrame: hlsSession.lastFrame || null,
    frameWaiters: new Set(),
    stopTimer: null,
  };
  mjpegSessions.set(id, session);
  return session;
}

function scheduleMjpegStop(id, session) {
  if (session.stopTimer) clearTimeout(session.stopTimer);
  session.stopTimer = setTimeout(() => {
    if (session.clients.size > 0) return;
    mjpegSessions.delete(id);
  }, config.streamIdleMs);
}

export async function waitForMjpegFrame(session, timeoutMs = config.mjpegStartTimeoutMs) {
  if (!session) return false;
  if (session.lastFrame) return true;
  
  const hlsSession = hlsSessions.get(session.id);
  if (!hlsSession || !isChildAlive(hlsSession.child)) return false;

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
    if (session.status === "starting" && fsSync.existsSync(session.playlist)) {
      session.status = "running";
    }
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
    if (hls.status === "starting" && fsSync.existsSync(hls.playlist)) {
      hls.status = "running";
    }
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
  }
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
    activeViewers: getActiveViewerList(id),
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
  mjpegSessions.clear();
}
