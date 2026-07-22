import net from "node:net";
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import path from "node:path";
import { JsonStore } from "../core/jsonStore.js";
import { config } from "../core/config.js";
import { getUsernameByIp, getFallbackUsername } from "../core/userTracker.js";
import { normalizeCamera, publicCamera } from "../core/cctv.js";
import { syncGo2rtc } from "./go2rtcSync.js";

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
  syncGo2rtc(await store.read()).catch(e => console.error("Sync failed:", e));
  return revealSecret ? created : publicCamera(created);
}

export async function updateCamera(id, payload, { revealSecret = false } = {}) {
  let updated = null;
  await store.update((cameras) => cameras.map((camera) => {
    if (camera.id !== id) return camera;
    updated = normalizeCamera(payload, camera);
    return updated;
  }).sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name)));
  if (updated) syncGo2rtc(await store.read()).catch(e => console.error("Sync failed:", e));
  return updated ? (revealSecret ? updated : publicCamera(updated)) : null;
}

export async function deleteCamera(id) {
  let deleted = false;
  await store.update((cameras) => {
    deleted = cameras.some((c) => c.id === id);
    return cameras.filter((c) => c.id !== id);
  });
  if (deleted) syncGo2rtc(await store.read()).catch(e => console.error("Sync failed:", e));
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
  syncGo2rtc(result).catch(e => console.error("Sync failed:", e));
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
    const source = camera.streamUrl;
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
    probe = await httpProbe(camera.streamUrl);
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
    probe = await httpProbe(tempCamera.streamUrl);
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

// Poll go2rtc for viewer counts, status, and bandwidth
let lastBytes = {};
setInterval(async () => {
  try {
    const res = await fetch("http://127.0.0.1:1984/api/streams");
    if (!res.ok) return;
    const streams = await res.json();
    const now = Date.now();
    
    await store.update((cameras) => {
      let changed = false;
      for (const cam of cameras) {
        const streamData = streams[cam.id];
        
        let newViewers = 0;
        let pullBytes = 0;
        let outBytes = 0;

        let activeViewers = [];

        if (streamData) {
           if (streamData.consumers) {
            const humanConsumers = streamData.consumers.filter(c => {
              if (c.format_name === 'keyframe' || c.format_name === 'snapshot') return false;
              if (c.user_agent === 'node' || c.user_agent === 'go2rtc') return false;
              return true;
            });

            outBytes = humanConsumers.reduce((acc, c) => acc + (c.bytes_send || 0), 0);

            // Step 2: Track active viewers (deduplicating by username if known, or consumer ID)
            const viewerMap = new Map();
            for (const c of humanConsumers) {
              let rawIp = c.remote_addr || "Unknown IP";
              let realIp = rawIp;
              
              if (rawIp.includes("forwarded ")) {
                realIp = rawIp.split("forwarded ")[1].trim();
              } else if (rawIp.includes(" ")) {
                // WebRTC format: "214.213.212.1:63933 prflx"
                realIp = rawIp.split(" ")[0];
                if (realIp.includes(":")) realIp = realIp.split(":")[0];
              } else if (rawIp.includes(":")) {
                realIp = rawIp.split(":")[0].replace(/\[|\]/g, '');
              }

              const username = getUsernameByIp(realIp) || getFallbackUsername() || "Pengguna";
              const viewerKey = (realIp === "127.0.0.1" || realIp === "::1" || username === "Pengguna")
                ? `viewer-${c.id}`
                : username;

              if (!viewerMap.has(viewerKey)) {
                viewerMap.set(viewerKey, {
                  id: String(c.id),
                  username,
                  ip: realIp,
                  userAgent: c.user_agent || "Unknown Browser",
                  output: c.format_name || "unknown",
                  lastSeenAgoSeconds: 0
                });
              }
            }

            activeViewers = Array.from(viewerMap.values());
            newViewers = activeViewers.length;
          }
          if (streamData.producers) {
            pullBytes = streamData.producers.reduce((acc, p) => acc + (p.bytes_recv || 0), 0);
          }
        }
        
        // If it's actively streaming (has producers or consumers), we know it is online
        const isOnline = !!streamData && ((streamData.producers && streamData.producers.length > 0) || newViewers > 0);
        
        if (cam.viewerCount !== newViewers || JSON.stringify(cam.activeViewers) !== JSON.stringify(activeViewers)) {
          cam.viewerCount = newViewers;
          cam.activeViewers = activeViewers;
          changed = true;
        }
        
        if (isOnline && cam.status !== "online") {
          cam.status = "online";
          cam.lastSeen = new Date().toISOString();
          changed = true;
        }

        // Calculate bandwidth
        const last = lastBytes[cam.id];
        if (last) {
          const dt = (now - last.time) / 1000;
          if (dt > 0) {
             const pullDiff = Math.max(0, pullBytes - last.pull);
             const outDiff = Math.max(0, outBytes - last.out);
             const pullKbps = (pullDiff * 8) / 1000 / dt;
             const outKbps = (outDiff * 8) / 1000 / dt;
             
             if (Math.abs((cam.pullBandwidthKbps || 0) - pullKbps) > 5 || Math.abs((cam.bandwidthKbps || 0) - outKbps) > 5) {
               cam.pullBandwidthKbps = Math.round(pullKbps);
               cam.bandwidthKbps = Math.round(outKbps);
               changed = true;
             }
          }
        }
        
        lastBytes[cam.id] = { pull: pullBytes, out: outBytes, time: now };
      }
      return changed ? cameras : cameras;
    });
  } catch (err) {
    // silently ignore fetch errors if go2rtc is down
  }
}, 3000);

export async function getGlobalMetrics() {
  const cameras = await store.read();
  let cctvPullKbps = 0;
  let cctvOutKbps = 0;
  let viewers = 0;
  let activeCameras = 0;

  for (const c of cameras) {
    if (c.viewerCount > 0) activeCameras++;
    viewers += (c.viewerCount || 0);
    cctvPullKbps += (c.pullBandwidthKbps || 0);
    cctvOutKbps += (c.bandwidthKbps || 0);
  }

  return {
    cctvPullKbps,
    cctvOutKbps,
    viewers,
    activeCameras,
    activeProcesses: 0
  };
}
