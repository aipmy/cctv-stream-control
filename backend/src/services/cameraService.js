import net from "node:net";
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import path from "node:path";
import { JsonStore } from "../core/jsonStore.js";
import { config } from "../core/config.js";
import { buildSourceUrl, normalizeCamera, publicCamera } from "../core/cctv.js";

const store = new JsonStore(path.join(config.dataDir, "cameras.json"), []);

export async function listCameras({ revealSecret = false } = {}) {
  const cameras = await store.read();
  return revealSecret ? cameras : cameras.map(publicCamera);
}

export async function getCamera(id, { revealSecret = false } = {}) {
  const cameras = await store.read();
  const found = cameras.find((c) => c.id === id);
  if (!found) return null;
  return revealSecret ? found : publicCamera(found);
}

export async function createCamera(payload, { revealSecret = false } = {}) {
  let created;
  await store.update((cameras) => {
    created = normalizeCamera({ ...payload, id: undefined });
    return [...cameras, created].sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name));
  });
  return revealSecret ? created : publicCamera(created);
}

export async function updateCamera(id, payload, { revealSecret = false } = {}) {
  let updated = null;
  await store.update((cameras) => cameras.map((camera) => {
    if (camera.id !== id) return camera;
    updated = normalizeCamera(payload, camera);
    return updated;
  }).sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name)));
  return updated ? (revealSecret ? updated : publicCamera(updated)) : null;
}

export async function deleteCamera(id) {
  let deleted = false;
  await store.update((cameras) => {
    deleted = cameras.some((c) => c.id === id);
    return cameras.filter((c) => c.id !== id);
  });
  return deleted;
}


export async function replaceCameras(payload, { mode = "replace" } = {}) {
  if (!Array.isArray(payload)) throw new Error("Payload cameras harus array");
  const normalized = payload.map((item) => normalizeCamera(item));
  let result = [];
  await store.update((cameras) => {
    const next = mode === "append" ? [...cameras, ...normalized] : normalized;
    const dedup = new Map();
    for (const camera of next) dedup.set(camera.id, camera);
    result = Array.from(dedup.values()).sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name));
    return result;
  });
  return result.map(publicCamera);
}

export async function markCameraStatus(id, patch) {
  let updated = null;
  await store.update((cameras) => cameras.map((camera) => {
    if (camera.id !== id) return camera;
    updated = normalizeCamera({ ...camera, ...patch }, camera);
    return updated;
  }));
  return updated ? publicCamera(updated) : null;
}

export async function logCameraError(id, message) {
  let updated = null;
  await store.update((cameras) => cameras.map((camera) => {
    if (camera.id !== id) return camera;
    const errorHistory = Array.isArray(camera.errorHistory) ? [...camera.errorHistory] : [];
    errorHistory.unshift({ timestamp: new Date().toISOString(), message });
    if (errorHistory.length > 10) errorHistory.length = 10;
    updated = normalizeCamera({ ...camera, errorHistory }, camera);
    return updated;
  }));
  return updated ? publicCamera(updated) : null;
}

function tcpProbe(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok, error) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (err) => finish(false, err.message));
    socket.connect(Number(port), host);
  });
}

function httpProbe(urlString, timeoutMs = 1800) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(urlString); } catch { resolve({ ok: false, error: "invalid url" }); return; }
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, { method: "HEAD", timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, statusCode: res.statusCode });
    });
    req.once("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.once("error", (err) => resolve({ ok: false, error: err.message }));
    req.end();
  });
}

function ffprobeCamera(camera, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const source = buildSourceUrl(camera);
    const transport = ["tcp", "udp", "auto"].includes(String(camera.rtspTransport || "tcp")) ? String(camera.rtspTransport || "tcp") : "tcp";
    const args = [
      "-v", "error",
      ...(transport === "auto" ? [] : ["-rtsp_transport", transport]),
      "-timeout", String(timeoutMs * 1000),
      "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate",
      "-of", "json",
      source,
    ];
    const child = spawn(config.ffprobeBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs + 1000);
    child.stdout.on("data", (chunk) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk) => { err += chunk.toString(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        try { resolve({ ok: true, info: JSON.parse(out) }); }
        catch { resolve({ ok: true }); }
      } else {
        resolve({ ok: false, error: err.trim() || `ffprobe exit ${code}` });
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
  });
}

export async function probeCamera(id, { deep = false } = {}) {
  const camera = await getCamera(id, { revealSecret: true });
  if (!camera) return null;
  if (!camera.enabled) {
    const updated = await markCameraStatus(id, { status: "offline" });
    return { camera: updated, probe: { ok: false, skipped: true, reason: "camera disabled" } };
  }
  let probe;
  if (deep && (camera.sourceType === "RTSP" || camera.sourceType === "RTSP+ONVIF")) {
    probe = await ffprobeCamera(camera);
  } else if (camera.sourceType === "RTSP" || camera.sourceType === "RTSP+ONVIF") {
    probe = await tcpProbe(camera.ip, camera.rtspPort || 554);
  } else {
    probe = await httpProbe(buildSourceUrl(camera));
  }
  const patch = probe.ok
    ? { status: "online", lastSeen: new Date().toISOString() }
    : { status: "offline" };
  const updated = await markCameraStatus(id, patch);
  return { camera: updated, probe };
}

export async function probeTransientCamera(payload) {
  const tempCamera = normalizeCamera(payload);
  let probe;
  if (tempCamera.sourceType === "RTSP" || tempCamera.sourceType === "RTSP+ONVIF") {
    probe = await ffprobeCamera(tempCamera);
  } else {
    probe = await httpProbe(buildSourceUrl(tempCamera));
  }
  return { camera: publicCamera(tempCamera), probe };
}

export async function probeAll({ deep = false } = {}) {
  const cameras = await listCameras({ revealSecret: true });
  const results = [];
  for (const camera of cameras) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await probeCamera(camera.id, { deep }));
  }
  return results;
}
