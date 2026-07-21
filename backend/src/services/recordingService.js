import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { config } from "../core/config.js";
import jpeg from "jpeg-js";
import { rgbaToGray, detectMotion } from "../core/motionEngine.js";
import { JsonStore } from "../core/jsonStore.js";
import { getCamera, listCameras } from "./cameraService.js";

import { auditRequest } from "../modules/audit/auditService.js";

const eventStore = new JsonStore(path.join(config.dataDir, "events.json"), []);
const settingsStore = new JsonStore(path.join(config.dataDir, "settings.json"), {
  retentionDays: 7,
  maxStorageGb: 5,
  telegramBotToken: "",
  telegramChatId: "",
  recordingMode: "continuous",
  preMotionSeconds: 15,
  postMotionSeconds: 15,
  segmentDuration: 5,
  enableAudioRecording: true,
  customStorageDir: "",
});

// Track last motion timestamp per camera (updated continuously by streamManager)
const lastMotionAt = new Map(); // cameraId -> timestamp

export function updateLastMotionAt(cameraId, timestamp) {
  lastMotionAt.set(cameraId, timestamp);
}

export async function getSettings() {
  const settings = await settingsStore.read();
  if (settings.customStorageDir) {
    config.setStorageDir(settings.customStorageDir);
  } else {
    config.setStorageDir(null);
  }
  return settings;
}

export async function updateSettings(payload) {
  let isStorageDirChanged = false;
  const updated = await settingsStore.update((settings) => {
    const oldDir = settings.customStorageDir || "";
    const newDir = payload.customStorageDir !== undefined ? String(payload.customStorageDir).trim() : oldDir;
    if (oldDir !== newDir) {
      isStorageDirChanged = true;
    }
    return {
      ...settings,
      retentionDays: Number(payload.retentionDays ?? settings.retentionDays),
      maxStorageGb: Number(payload.maxStorageGb ?? settings.maxStorageGb),
      telegramBotToken: String(payload.telegramBotToken ?? settings.telegramBotToken).trim(),
      telegramChatId: String(payload.telegramChatId ?? settings.telegramChatId).trim(),
      recordingMode: String(payload.recordingMode ?? settings.recordingMode ?? "continuous"),
      preMotionSeconds: Number(payload.preMotionSeconds ?? settings.preMotionSeconds ?? 15),
      postMotionSeconds: Number(payload.postMotionSeconds ?? settings.postMotionSeconds ?? 15),
      segmentDuration: Number(payload.segmentDuration ?? settings.segmentDuration ?? 5),
      enableAudioRecording: Boolean(payload.enableAudioRecording ?? settings.enableAudioRecording ?? true),
      customStorageDir: newDir,
    };
  });
  if (updated.customStorageDir) {
    config.setStorageDir(updated.customStorageDir);
  } else {
    config.setStorageDir(null);
  }

  if (isStorageDirChanged) {
    import("../stream/streamManager.js").then(({ stopAiStream }) => {
      stopAiStream().catch(err => console.error("Gagal menghentikan stream setelah ganti folder:", err));
    }).catch(err => console.error("Gagal import streamManager:", err));
  }

  return updated;
}

// Inisialisasi storage path dari settings.json saat startup
getSettings().catch((err) => {
  console.error("Gagal menginisialisasi customStorageDir:", err);
});

export async function listEvents() {
  return await eventStore.read();
}

export async function deleteEvent(id) {
  let deleted = false;
  await eventStore.update((events) => {
    const found = events.find(e => e.id === id);
    if (found) {
      deleted = true;
      // Delete physical files asynchronously
      const snapPath = path.join(config.storageDir, "events", `${id}.jpg`);
      const videoPath = path.join(config.storageDir, "events", `${id}.mp4`);
      fs.unlink(snapPath).catch(() => {});
      fs.unlink(videoPath).catch(() => {});
    }
    return events.filter(e => e.id !== id);
  });
  return deleted;
}

export async function clearAllEvents() {
  await eventStore.write([]);
  // Clear entire events storage folder
  const eventsDir = path.join(config.storageDir, "events");
  try {
    const files = await fs.readdir(eventsDir);
    for (const file of files) {
      await fs.unlink(path.join(eventsDir, file)).catch(() => {});
    }
  } catch (err) {
    // ignore
  }
  return true;
}

/**
 * Triggers a smart CCTV event (motion or sound detection).
 */
export async function triggerEvent(cameraId, type, { req = null, predictions = null, pixelBoxes = null, snapshotBuffer = null } = {}) {
  const camera = await getCamera(cameraId, { revealSecret: true });
  if (!camera) {
    throw new Error(`Camera with ID ${cameraId} not found`);
  }

  const settings = await getSettings();
  const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  
  const eventsDir = path.join(config.storageDir, "events");
  await fs.mkdir(eventsDir, { recursive: true });

  const snapshotFilename = `${eventId}.jpg`;
  const snapshotFile = path.join(eventsDir, snapshotFilename);

  let score = undefined;
  if (predictions && predictions.length > 0) {
    const matched = predictions.find(p => p.class === type || (type === "person" && p.class === "person"));
    if (matched) {
      score = Math.round(matched.score * 100);
    } else {
      score = Math.round(Math.max(...predictions.map(p => p.score || 0)) * 100);
    }
  }

  // Handle Snapshot Generation from buffer
  if (snapshotBuffer) {
    try {
      // Save the raw snapshot directly
      await fs.writeFile(snapshotFile, snapshotBuffer);

      // FIRE & FORGET: Draw bounding boxes using FFmpeg (zero Node.js event loop blocking)
      const detectionModes = camera?.detectionModes || ["pixel", "human", "pet"];
      let boxesToDraw = [];
      let classifiedMode = "pixel";
      
      if (predictions && predictions.length > 0) {
        const hasHuman = predictions.some((p) => p.class === "person");
        const hasPet = predictions.some((p) => ["cat", "dog", "bird"].includes(p.class));
        if (hasHuman && detectionModes.includes("human")) classifiedMode = "human";
        else if (hasPet && detectionModes.includes("pet")) classifiedMode = "pet";
      }

      if (classifiedMode !== "pixel" && predictions) {
        for (const p of predictions) {
          if (classifiedMode === "human" && p.class !== "person") continue;
          if (classifiedMode === "pet" && !["cat", "dog", "bird"].includes(p.class)) continue;
          boxesToDraw.push({
            x: Math.max(0, Math.round(p.bbox[0])),
            y: Math.max(0, Math.round(p.bbox[1])),
            w: Math.max(1, Math.round(p.bbox[2])),
            h: Math.max(1, Math.round(p.bbox[3])),
            color: classifiedMode === "human" ? "red" : "blue"
          });
        }
      } else if (classifiedMode === "pixel" && pixelBoxes && pixelBoxes.length > 0) {
        const largestBox = pixelBoxes.reduce((a, b) => (a.w * a.h > b.w * b.h ? a : b));
        boxesToDraw.push({
          x: Math.max(0, largestBox.x),
          y: Math.max(0, largestBox.y),
          w: Math.max(1, largestBox.w),
          h: Math.max(1, largestBox.h),
          color: "yellow"
        });
      }

      if (boxesToDraw.length > 0) {
        const drawboxFilters = boxesToDraw.map(b => `drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=${b.color}@0.8:t=3`).join(',');
        const tempFile = snapshotFile + ".tmp.jpg";
        
        const ffmpegChild = spawn(config.ffmpegBin || "ffmpeg", [
          "-y",
          "-v", "error",
          "-i", snapshotFile,
          "-vf", drawboxFilters,
          "-q:v", "3",
          tempFile
        ]);
        
        ffmpegChild.on("close", (code) => {
          if (code === 0 && fsSync.existsSync(tempFile)) {
            fsSync.renameSync(tempFile, snapshotFile);
          } else if (fsSync.existsSync(tempFile)) {
            fsSync.unlinkSync(tempFile);
          }
        });
      }
    } catch (err) {
      console.error(`[Event Recording] Failed to generate snapshot for ${eventId}`, err);
    }
  }

  const newEvent = {
    id: eventId,
    cameraId: camera.id,
    cameraName: camera.name,
    site: camera.site,
    ts: new Date().toISOString(),
    endTime: null, // Track ongoing event duration
    type,
    score,
    snapshotPath: `/api/events/snapshot/${eventId}`,
    videoPath: null // Removed mp4 generation
  };

  await eventStore.update((events) => {
    return [newEvent, ...events].slice(0, 1000);
  });

  // Audit log
  if (req) {
    await auditRequest(req, {
      actor: req.user || { username: "System Event Engine" },
      action: "cctv.event_triggered",
      outcome: "success",
      target: { type: "camera", id: camera.id, label: camera.name },
      details: { eventId, type },
    });
  }

  // Notifications
  if (camera.enableNotifications && settings.telegramBotToken && settings.telegramChatId) {
    void sendTelegramAlert(settings.telegramBotToken, settings.telegramChatId, {
      cameraName: camera.name,
      site: camera.site,
      type,
      snapshotFile: fsSync.existsSync(snapshotFile) ? snapshotFile : null,
    });
  }

  return newEvent;
}

/**
 * Extends the duration of an active event.
 */
export async function extendEventDuration(eventId, newEndTimeMs) {
  let updated = false;
  await eventStore.update((events) => {
    const evt = events.find((e) => e.id === eventId);
    if (evt) {
      evt.endTime = new Date(newEndTimeMs).toISOString();
      updated = true;
    }
    return events;
  });
  return updated;
}

export function doesSegmentOverlap(segTs, startUnix, endUnix, segDuration = 5) {
  return segTs <= endUnix && (segTs + segDuration) > startUnix;
}

let isCleanupRunning = false;

/**
 * Cleanup / Auto-rotation service.
 */
export async function runStorageCleanup() {
  if (isCleanupRunning) return;
  isCleanupRunning = true;
  try {
    const settings = await getSettings();
    const retentionMs = settings.retentionDays * 24 * 60 * 60 * 1000;
    const maxSizeBytes = settings.maxStorageGb * 1024 * 1024 * 1024;
    const now = Date.now();
    const segDuration = settings.segmentDuration || 10; // Phase 2 default to 10s

    // ── 0. Clean /tmp/cctv_hls stale live-view segments (older than 2 min) ──
    const tmpHlsDir = "/tmp/cctv_hls";
    let tmpCleaned = 0;
    if (fsSync.existsSync(tmpHlsDir)) {
      try {
        const tmpCamDirs = await fs.readdir(tmpHlsDir);
        for (const camDir of tmpCamDirs) {
          const camPath = path.join(tmpHlsDir, camDir);
          const subDirs = await fs.readdir(camPath).catch(() => []);
          const dirsToScan = [camPath, ...subDirs.map(d => path.join(camPath, d))];
          for (const dirPath of dirsToScan) {
            try {
              const files = await fs.readdir(dirPath);
              for (const file of files) {
                if (!file.endsWith(".ts")) continue;
                const filePath = path.join(dirPath, file);
                try {
                  const st = await fs.stat(filePath);
                  if (now - st.mtime.getTime() > 2 * 60 * 1000) {
                    await fs.unlink(filePath).catch(() => {});
                    tmpCleaned++;
                  }
                } catch { /* ignore */ }
              }
            } catch { /* not a dir, skip */ }
          }
        }
      } catch { /* ignore */ }
    }
    if (tmpCleaned > 0) {
      console.log(`[Storage Cleanup] Cleaned ${tmpCleaned} stale /tmp/cctv_hls segments.`);
    }

    const fileInfos = [];
    let zeroByteCleaned = 0;

    // Helper to recursively scan a directory
    async function scanDir(dirPath) {
      if (!fsSync.existsSync(dirPath)) return;
      const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          try {
            const stats = await fs.stat(fullPath);
            if (stats.size === 0) {
              await fs.unlink(fullPath).catch(() => {});
              zeroByteCleaned++;
              continue;
            }
            fileInfos.push({
              name: entry.name,
              path: fullPath,
              size: stats.size,
              time: stats.mtime.getTime(),
              dir: path.dirname(fullPath)
            });
          } catch { /* ignore */ }
        }
      }
    }

    // ── 1. Scan entire storageDir (including unmanaged folders like cctv_record & temp_downloads) ──
    if (config.storageDir) {
      await fs.mkdir(config.storageDir, { recursive: true }).catch(() => {});
      await scanDir(config.storageDir);
    }

    if (zeroByteCleaned > 0) {
      console.log(`[Storage Cleanup] Removed ${zeroByteCleaned} empty (0-byte) files.`);
    }

    // Pre-load events and cameras for segment pruning
    const events = await listEvents();
    const eventsByCamera = new Map();
    for (const evt of events) {
      if (!eventsByCamera.has(evt.cameraId)) {
        eventsByCamera.set(evt.cameraId, []);
      }
      eventsByCamera.get(evt.cameraId).push(evt);
    }
    const pre = settings.preMotionSeconds || 15;
    const post = settings.postMotionSeconds || 15;
    
    const cameras = await listCameras({ revealSecret: true });
    const cameraMap = new Map(cameras.map((c) => [c.id, c]));

    const isSegmentActive = (cameraId, segTsSec, isSequential) => {
      const camera = cameraMap.get(cameraId);
      if (!camera || !camera.enableRecording) return false;
      if (camera.recordingMode !== "event") return true;
      if (isSequential) return true; // HLS live segments are short-lived anyway
      
      const camEvents = eventsByCamera.get(cameraId) || [];
      for (const evt of camEvents) {
        const evtTs = Math.floor(new Date(evt.ts).getTime() / 1000);
        const endTsSec = evt.endTime ? Math.floor(new Date(evt.endTime).getTime() / 1000) : evtTs;
        const windowStart = evtTs - pre;
        const windowEnd = endTsSec + post;
        if (doesSegmentOverlap(segTsSec, windowStart, windowEnd, segDuration)) return true;
      }
      return false;
    };

    // ── 2. Classify and Prune Segments ──
    const activeFileInfos = [];
    
    for (const fileInfo of fileInfos) {
      // Is it a segment? Support both legacy .ts and new Native .mp4 chunks
      const match = fileInfo.name.match(/seg_(\d+)\.(ts|mp4|m4s)/);
      if (match) {
        let timestampSec = parseInt(match[1], 10);
        const isSequential = timestampSec < 1000000000;
        
        // Deduce cameraId from path (assuming immediate parent dir is cameraId, which is true for record_hls/cam1/seg.ts)
        const parts = fileInfo.dir.split(path.sep);
        const cameraId = parts[parts.length - 1];

        const camera = cameraMap.get(cameraId);
        const recordingEnabled = camera?.enableRecording ?? false;
        const isEventMode = camera?.recordingMode === "event";

        // Delete segment immediately if recording is disabled or outside motion window
        if (!recordingEnabled || (isEventMode && !isSegmentActive(cameraId, timestampSec, isSequential))) {
          await fs.unlink(fileInfo.path).catch(() => {});
          continue;
        }
        
        // Overwrite time for unix timestamp segments so cleanup sorts them by semantic time
        if (!isSequential) {
          fileInfo.time = timestampSec * 1000;
        }
      }
      
      // Keep file for quota enforcement
      activeFileInfos.push(fileInfo);
    }

    // ── 3. Enforce retention & quota across ALL files ──
    activeFileInfos.sort((a, b) => a.time - b.time);

    let totalSize = activeFileInfos.reduce((sum, f) => sum + f.size, 0);
    const deletedEventIds = new Set();
    let deletedFilesCount = 0;
    let freedBytes = 0;
    const toDelete = [];

    for (const fileInfo of activeFileInfos) {
      const isExpired = (now - fileInfo.time) > retentionMs;
      const isOverQuota = totalSize > maxSizeBytes;

      if (isExpired || isOverQuota) {
        toDelete.push(fileInfo);
        totalSize -= fileInfo.size;
        freedBytes += fileInfo.size;

        // If it's an event snapshot or video, track it to purge DB
        const eventMatch = fileInfo.name.match(/^(evt_[a-z0-9_]+)\.(jpg|mp4)$/i);
        if (eventMatch && fileInfo.path.includes(path.sep + "events" + path.sep)) {
          deletedEventIds.add(eventMatch[1]);
        } else {
          deletedFilesCount++;
        }
      }
    }

    // Parallel deletion to avoid slow SD card bottlenecks
    for (let i = 0; i < toDelete.length; i += 50) {
      const chunk = toDelete.slice(i, i + 50);
      await Promise.all(chunk.map(f => fs.unlink(f.path).catch(() => {})));
    }

    if (deletedEventIds.size > 0) {
      await eventStore.update((events) => {
        return events.filter((e) => !deletedEventIds.has(e.id));
      });
    }

    if (deletedFilesCount > 0 || deletedEventIds.size > 0) {
      const freedMb = (freedBytes / (1024 * 1024)).toFixed(1);
      const remainMb = (totalSize / (1024 * 1024)).toFixed(1);
      const limitMb = (maxSizeBytes / (1024 * 1024)).toFixed(0);
      console.log(`[Storage Cleanup] Swept unmanaged files & segments. Deleted ${deletedFilesCount} files + ${deletedEventIds.size} events. Freed ${freedMb}MB. Remaining: ${remainMb}MB / ${limitMb}MB limit.`);
    }
  } catch (err) {
    console.error("[Storage Cleanup] Error running auto-rotation clean:", err);
  } finally {
    isCleanupRunning = false;
  }
}

export async function deleteRecordingsForDate(cameraId, date) {
  const startOfDay = new Date(`${date}T00:00:00`);
  const endOfDay = new Date(`${date}T23:59:59.999`);
  const startUnix = Math.floor(startOfDay.getTime() / 1000);
  const endUnix = Math.floor(endOfDay.getTime() / 1000);

  const hlsBaseDirs = [path.join(config.storageDir, "hls", cameraId), path.join(config.storageDir, "record_hls", cameraId)];
  let deletedCount = 0;

  for (const baseDir of hlsBaseDirs) {
    if (!fsSync.existsSync(baseDir)) continue;
    let allDirsToScan = [];
    try {
      allDirsToScan = await fs.readdir(baseDir);
    } catch { continue; }

    for (const subdir of allDirsToScan) {
      const dirPath = path.join(baseDir, subdir);
      if (!fsSync.existsSync(dirPath) || !(await fs.stat(dirPath)).isDirectory()) continue;

      const files = await fs.readdir(dirPath);
      for (const file of files) {
        const match = file.match(/seg_(\d+)\.(ts|mp4|m4s)/);
        if (!match) continue;
        let ts = parseInt(match[1], 10);
        
        try {
          if (ts < 1000000000) {
            const stats = await fs.stat(path.join(dirPath, file));
            ts = Math.floor(stats.mtime.getTime() / 1000);
          }
        } catch { continue; }
        
        if (ts >= startUnix && ts <= endUnix) {
          await fs.unlink(path.join(dirPath, file)).catch(() => {});
          deletedCount++;
        }
      }

      // Clean up HLS playlist if empty
      // Clean up HLS playlist if empty
      const indexFile = path.join(dirPath, "index.m3u8");
      if (fsSync.existsSync(indexFile)) {
        const remaining = await fs.readdir(dirPath);
        const hasSegments = remaining.some(f => f.endsWith(".ts") || f.endsWith(".mp4") || f.endsWith(".m4s"));
        if (!hasSegments) {
          await fs.unlink(indexFile).catch(() => {});
          const initFile = path.join(dirPath, "init.mp4");
          if (fsSync.existsSync(initFile)) await fs.unlink(initFile).catch(() => {});
        }
      }
    }
  }
  return deletedCount;
}

export async function deleteAllRecordings(cameraId) {
  const hlsBaseDirs = [path.join(config.storageDir, "hls", cameraId), path.join(config.storageDir, "record_hls", cameraId)];
  for (const baseDir of hlsBaseDirs) {
    if (fsSync.existsSync(baseDir)) {
      await fs.rm(baseDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  return true;
}

export async function deleteSnapshotFile(eventId) {
  const snapPath = path.join(config.storageDir, "events", `${eventId}.jpg`);
  if (fsSync.existsSync(snapPath)) {
    await fs.unlink(snapPath).catch(() => {});
  }
  return true;
}
