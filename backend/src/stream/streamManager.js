import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import { config } from "../core/config.js";

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
import { CameraMotionEngine, motionEmitter, isIgnoredPoint } from "../core/motionEngine.js";

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

const recordSessions = new Map(); // cameraId -> ChildProcess (FFmpeg)

async function startRecording(camera) {
  if (!camera.enableRecording) return;
  if (recordSessions.has(camera.id)) return;
  
  const outputDir = path.join(config.storageDir, "record_hls", camera.id);
  await fs.mkdir(outputDir, { recursive: true });
  
  const playlistPath = path.join(outputDir, "index.m3u8");
  const go2rtcInput = `rtsp://127.0.0.1:${config.go2rtcRtspPort}/${camera.id}?mp4`;

  const args = [
    "-hide_banner", "-loglevel", "error",
    "-rtsp_transport", "tcp",
    "-i", go2rtcInput,
    "-sn", "-dn"
  ];
  
  if (camera.recordMode === "transcode") {
    args.push("-c:v", config.videoEncoder || "libx264", "-preset", "ultrafast");
  } else {
    args.push("-c:v", "copy");
  }
  
  args.push(
    "-c:a", "copy",
    "-f", "hls",
    "-hls_time", "10",
    "-hls_list_size", "0",
    "-hls_segment_type", "fmp4",
    "-hls_fmp4_init_filename", "init.mp4",
    "-strftime", "1",
    "-hls_segment_filename", path.join(outputDir, "seg_%s.m4s"),
    playlistPath
  );

  const child = spawn(config.ffmpegBin || "ffmpeg", args);
  recordSessions.set(camera.id, child);
  console.log(`[Recording] Started FFmpeg recording for camera ${camera.id}`);

  child.on("close", (code) => {
    console.log(`[Recording] FFmpeg stopped for camera ${camera.id} (code ${code})`);
    recordSessions.delete(camera.id);
    
    if (!child.intentionallyKilled && camera.enableRecording) {
      console.log(`[Recording] Auto-restarting FFmpeg for camera ${camera.id} in 5s...`);
      setTimeout(() => {
        startRecording(camera).catch(console.error);
      }, 5000);
    }
  });
}

function stopRecording(cameraId) {
  const child = recordSessions.get(cameraId);
  if (child) {
    child.intentionallyKilled = true;
    child.kill("SIGKILL");
    recordSessions.delete(cameraId);
  }
}

const aiSessions = new Map();      // cameraId -> session, termasuk stopped/error beberapa menit untuk debug
const aiStartLocks = new Map();    // cameraId -> Promise<session|null>

export { motionEmitter };


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

export function isChildAlive(session) {
  return session && session.status !== "stopped" && session.status !== "error";
}

function scheduleAiIdleCleanup() {
  const interval = Math.max(5000, Math.floor(config.streamIdleMs / 2));
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of aiSessions.entries()) {
      const alive = isChildAlive(session);
      if (!alive) {
        const closedAt = session.closedAt ? new Date(session.closedAt).getTime() : 0;
        if (closedAt && now - closedAt > config.streamErrorRetentionMs) aiSessions.delete(id);
        continue;
      }
      
      // Watchdog: Detect frozen stream (no frames for 45s)
      if (session.lastFrameAt && now - session.lastFrameAt > 45000) {
        logLifecycle(session, `watchdog timeout: no frames received for 45s, stream appears stuck.`);
        session.status = "error";
        session.rawError = "Stream frozen (Watchdog timeout: no frames received)";
        if (session.pollTimer) clearInterval(session.pollTimer);
        continue;
      }
    }
  }, interval);
  timer.unref?.();
}

scheduleAiIdleCleanup();

function nowIso() {
  return new Date().toISOString();
}

export async function startAiStream(id) {
  const locked = aiStartLocks.get(id);
  if (locked) {
    const session = await locked;
    return session;
  }

  const startPromise = (async () => {
    const existing = aiSessions.get(id);
    if (existing) {
      if (existing.status !== "stopped" && existing.status !== "error") {
        return existing;
      }
    }

    const camera = await getCamera(id, { revealSecret: true });
    if (!camera) return null;
    if (!camera.enabled) {
      const err = new Error("Camera disabled");
      err.status = 409;
      throw err;
    }

    const session = {
      id,
      key: id,
      output: "AI_FRAME",
      startedAt: nowIso(),
      status: "starting",
      rawError: "",
      lastRequestAt: Date.now(),
      keepAlive: Boolean(camera.enableRecording || camera.enableNotifications),
      lastFrame: null,
      lastFrameAt: Date.now(),
      pollTimer: null
    };
    aiSessions.set(id, session);
    await markCameraStatus(id, { status: "starting" });
    
    // Start FFmpeg recording if enabled
    if (camera.enableRecording) {
      startRecording(camera).catch(console.error);
    }

    logLifecycle(session, `start polling go2rtc for camera: ${id}`);
    
    const fps = camera.detectFps || 6;
    const args = [
      "-hide_banner", "-loglevel", "error",
      "-rtsp_transport", "tcp",
      "-i", `rtsp://127.0.0.1:${config.go2rtcRtspPort}/${id}?mp4`,
      "-vf", `fps=${fps}`,
      "-c:v", "mjpeg",
      "-f", "image2pipe",
      "pipe:1"
    ];

    session.child = spawn(config.ffmpegBin || "ffmpeg", args);
    let frameBuffer = Buffer.alloc(0);
    const startMarker = Buffer.from([0xFF, 0xD8]);
    const endMarker = Buffer.from([0xFF, 0xD9]);

    session.child.stdout.on("data", (chunk) => {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      let start = frameBuffer.indexOf(startMarker);
      let end = frameBuffer.indexOf(endMarker);
      
      while (start !== -1 && end !== -1 && end > start) {
        const frame = frameBuffer.slice(start, end + 2);
        frameBuffer = frameBuffer.slice(end + 2);
        
        session.lastFrame = frame;
        session.lastFrameAt = Date.now();
        session.status = "running";
        
        // Feed frame to pixel-diff motion engine
        const hasSmart = Boolean(camera.enableSmartDetection ?? (camera.enableRecording || camera.enableNotifications));
        const hasListeners = motionEmitter.listenerCount(`motion-${id}`) > 0;
        const hasAiListeners = motionEmitter.listenerCount(`ai-motion-${id}`) > 0;
        
        if (hasSmart || hasListeners || hasAiListeners) {
          const nowMs = Date.now();
          let pixelMotionDetected = false;

          if (!session.lastMotionProcess || nowMs - session.lastMotionProcess > 250) {
            session.lastMotionProcess = nowMs;
            const engine = getMotionEngine(id);
            const result = engine.processFrame(frame, {
              sensitivity: camera.motionSensitivity ?? 50,
              excludeAreas: camera.excludeAreas || [],
            });
            pixelMotionDetected = Boolean(result && result.motion);
            session.lastPixelBoxes = result && result.boxes ? result.boxes.map(b => ({
              ...b,
              frameWidth: result.width,
              frameHeight: result.height
            })) : [];
            
            if (pixelMotionDetected && hasSmart) {
              void handleMotionDetected(camera, null, session.lastPixelBoxes, frame);
            }
          }

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
                
                if (predictions === null) return;
                
                const PERSON_CLASSES = ["person"];
                const PET_CLASSES = ["cat", "dog", "bird", "horse", "sheep", "cow"];
                const VEHICLE_CLASSES = ["car", "motorcycle", "bus", "truck", "bicycle"];
                
                const filtered = (predictions || []).filter(p => {
                  if (modes.includes("human") && PERSON_CLASSES.includes(p.class)) return true;
                  if (modes.includes("pet") && PET_CLASSES.includes(p.class)) return true;
                  if (modes.includes("object") && !PERSON_CLASSES.includes(p.class) && !PET_CLASSES.includes(p.class)) return true;
                  if (modes.includes("vehicle") && VEHICLE_CLASSES.includes(p.class)) return true;
                  return false;
                }).filter(p => {
                  const cx = p.bbox[0] + (p.bbox[2] / 2);
                  const cy = p.bbox[1] + (p.bbox[3] / 2);
                  const nx = cx / p.frameWidth;
                  const ny = cy / p.frameHeight;
                  if (isIgnoredPoint(nx, ny, camera.excludeAreas || [])) {
                    return false; // Center is in masked area, ignore!
                  }
                  
                  // Enforce physical motion: Ignore stationary objects (like parked cars)
                  if (!session.lastPixelBoxes || session.lastPixelBoxes.length === 0) {
                    return false;
                  }
                  
                  const pLeft = p.bbox[0] / p.frameWidth;
                  const pTop = p.bbox[1] / p.frameHeight;
                  const pRight = (p.bbox[0] + p.bbox[2]) / p.frameWidth;
                  const pBottom = (p.bbox[1] + p.bbox[3]) / p.frameHeight;
                  
                  for (const pb of session.lastPixelBoxes) {
                    const fw = pb.frameWidth || 640;
                    const fh = pb.frameHeight || 360;
                    const pbLeft = pb.x / fw;
                    const pbTop = pb.y / fh;
                    const pbRight = (pb.x + pb.w) / fw;
                    const pbBottom = (pb.y + pb.h) / fh;
                    
                    const overlapLeft = Math.max(pLeft, pbLeft);
                    const overlapTop = Math.max(pTop, pbTop);
                    const overlapRight = Math.min(pRight, pbRight);
                    const overlapBottom = Math.min(pBottom, pbBottom);
                    
                    if (overlapLeft < overlapRight && overlapTop < overlapBottom) {
                      return true; // Overlaps with motion box!
                    }
                  }
                  return false;
                });
                
                let finalPredictions = filtered;
                const now = Date.now();
                
                if (filtered.length > 0) {
                  session.lastAiPredictions = filtered;
                  session.lastAiPredictionTime = now;
                } else if (session.lastAiPredictions && now - session.lastAiPredictionTime < 2000) {
                  finalPredictions = session.lastAiPredictions;
                } else {
                  session.lastAiPredictions = null;
                }
                
                motionEmitter.emit(`ai-motion-${id}`, {
                  ts: new Date().toISOString(),
                  predictions: finalPredictions
                });

                const eventFiltered = finalPredictions.filter(p => p.score >= threshold);
                if (eventFiltered.length > 0 && hasSmart) {
                  void handleMotionDetected(camera, eventFiltered, null, frame);
                }
              }).catch(err => {
                session.aiBusy = false;
                session.lastAiProcess = Date.now();
              });
            }).catch(err => {
              session.aiBusy = false;
              session.lastAiProcess = Date.now();
            });
          }
        }

        start = frameBuffer.indexOf(startMarker);
        end = frameBuffer.indexOf(endMarker);
      }
      
      // Prevent buffer from growing infinitely on bad data
      if (frameBuffer.length > 5 * 1024 * 1024) {
        frameBuffer = Buffer.alloc(0);
      }
    });

    session.child.stderr.on("data", (data) => {
      const msg = data.toString();
      if (!msg.includes("frame=") && config.ffmpegLogToConsole) {
        console.error(`[AI-FFmpeg][${id}] ${msg.trim()}`);
      }
    });

    session.child.on("close", (code) => {
      if (session.status !== "stopping" && code !== 0 && code !== 255) {
        console.error(`[AI-FFmpeg] Process for ${id} died (code ${code}). Restarting in 5s...`);
        setTimeout(() => startAiStream(id), 5000);
      }
    });

    return session;
  })().finally(() => aiStartLocks.delete(id));

  aiStartLocks.set(id, startPromise);
  return startPromise;
}

export async function stopAiStream(id) {
  const stopped = [];
  const stopOne = async (cameraId, session) => {
    if (!session) return;
    if (session.child) {
      session.status = "stopping";
      session.child.kill("SIGTERM");
      session.child = null;
    }
    stopRecording(cameraId);
    session.status = "stopped";
    session.closedAt = nowIso();
    stopped.push(cameraId);
  };

  if (id) {
    await stopOne(id, aiSessions.get(id));
    aiSessions.delete(id);
  } else {
    for (const [cameraId, session] of aiSessions.entries()) {
      await stopOne(cameraId, session);
    }
    aiSessions.clear();
  }
  return stopped;
}
