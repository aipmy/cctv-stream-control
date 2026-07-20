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
    import("../stream/streamManager.js").then(({ stopAllStreams }) => {
      stopAllStreams().catch(err => console.error("Gagal menghentikan stream setelah ganti folder:", err));
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
      // Save the raw snapshot directly to avoid heavy blocking JPEG encoding on the Raspberry Pi CPU
      await fs.writeFile(snapshotFile, snapshotBuffer);
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

/**
 * Cleanup / Auto-rotation service.
 */
export async function runStorageCleanup() {
  try {
    const settings = await getSettings();
    const retentionMs = settings.retentionDays * 24 * 60 * 60 * 1000;
    const maxSizeBytes = settings.maxStorageGb * 1024 * 1024 * 1024;
    const now = Date.now();

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

    // ── 1. Scan events directory ──
    const eventsDir = path.join(config.storageDir, "events");
    await fs.mkdir(eventsDir, { recursive: true });
    const eventFiles = await fs.readdir(eventsDir);
    for (const filename of eventFiles) {
      const filePath = path.join(eventsDir, filename);
      try {
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          fileInfos.push({
            type: "event",
            name: filename,
            path: filePath,
            size: stats.size,
            time: stats.mtime.getTime(),
          });
        }
      } catch { /* ignore */ }
    }

    // ── 2. Scan HLS and record_hls directories for .ts files ──
    const hlsBaseDirs = [path.join(config.storageDir, "hls"), path.join(config.storageDir, "record_hls")];
    let zeroByteCleaned = 0;

    // Pre-load events and cameras once (not per hlsBaseDir)
    const events = await listEvents();
    const eventsByCamera = new Map();
    for (const evt of events) {
      if (evt.type !== "motion") continue;
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
      if (isSequential) return true;
      
      const camEvents = eventsByCamera.get(cameraId) || [];
      for (const evt of camEvents) {
        const evtTs = Math.floor(new Date(evt.ts).getTime() / 1000);
        const endTsSec = evt.endTime ? Math.floor(new Date(evt.endTime).getTime() / 1000) : evtTs;
        if (segTsSec >= evtTs - pre && segTsSec <= endTsSec + post) return true;
      }
      return false;
    };

    for (const hlsBaseDir of hlsBaseDirs) {
      if (!fsSync.existsSync(hlsBaseDir)) continue;

      const cameraDirs = await fs.readdir(hlsBaseDir);
      for (const cameraId of cameraDirs) {
        const camDir = path.join(hlsBaseDir, cameraId);
        const subdirs = ["hls_stable", "hls_low_latency", "copy", "transcode"];
        
        let allDirsToScan = [];
        try {
          const innerDirs = await fs.readdir(camDir);
          allDirsToScan = innerDirs.filter(d => subdirs.includes(d) || !d.includes("."));
        } catch { continue; }

        // Also scan camDir itself (record_hls segments are directly in camDir)
        allDirsToScan.push(".");

        for (const subdir of allDirsToScan) {
          const dirPath = subdir === "." ? camDir : path.join(camDir, subdir);
          if (!fsSync.existsSync(dirPath)) continue;

          const files = await fs.readdir(dirPath);
          for (const file of files) {
            if (!file.endsWith(".ts")) continue;
            const match = file.match(/seg_(\d+)\.ts/);
            if (!match) continue;
            let timestampSec = parseInt(match[1], 10);
            let timestamp = timestampSec * 1000;
            const filePath = path.join(dirPath, file);

            try {
              const stats = await fs.stat(filePath);

              // Clean up 0-byte files immediately (result of ENOSPC writes)
              if (stats.size === 0) {
                await fs.unlink(filePath).catch(() => {});
                zeroByteCleaned++;
                continue;
              }

              const isSequential = timestampSec < 1000000000;
              if (isSequential) {
                timestamp = stats.mtime.getTime();
                timestampSec = Math.floor(timestamp / 1000);
              }

              const camera = cameraMap.get(cameraId);
              const recordingEnabled = camera?.enableRecording ?? false;
              const isEventMode = camera?.recordingMode === "event";

              // Delete segment if recording is disabled, or if event mode is active and segment is outside motion window
              if (!recordingEnabled || (isEventMode && !isSegmentActive(cameraId, timestampSec, isSequential))) {
                await fs.unlink(filePath).catch(() => {});
                continue;
              }

              if (stats.isFile()) {
                fileInfos.push({
                  type: "segment",
                  name: file,
                  path: filePath,
                  size: stats.size,
                  time: timestamp,
                });
              }
            } catch { /* ignore */ }
          }
        }
      }
    }

    if (zeroByteCleaned > 0) {
      console.log(`[Storage Cleanup] Removed ${zeroByteCleaned} empty (0-byte) segment files.`);
    }

    // ── 3. Enforce retention & quota ──
    // Sort oldest first
    fileInfos.sort((a, b) => a.time - b.time);

    let totalSize = fileInfos.reduce((sum, f) => sum + f.size, 0);
    const deletedEventIds = new Set();
    let deletedSegments = 0;
    let freedBytes = 0;

    for (const fileInfo of fileInfos) {
      const isExpired = (now - fileInfo.time) > retentionMs;
      const isOverQuota = totalSize > maxSizeBytes;

      if (isExpired || isOverQuota) {
        await fs.unlink(fileInfo.path).catch(() => {});
        totalSize -= fileInfo.size;
        freedBytes += fileInfo.size;

        if (fileInfo.type === "event") {
          // Extract event ID from filename to purge from DB
          const match = fileInfo.name.match(/^(evt_[a-z0-9_]+)\.(jpg|mp4)$/i);
          if (match) {
            deletedEventIds.add(match[1]);
          }
        } else {
          deletedSegments++;
        }
      }
    }

    if (deletedEventIds.size > 0) {
      await eventStore.update((events) => {
        return events.filter((e) => !deletedEventIds.has(e.id));
      });
    }

    if (deletedSegments > 0 || deletedEventIds.size > 0) {
      const freedMb = (freedBytes / (1024 * 1024)).toFixed(1);
      const remainMb = (totalSize / (1024 * 1024)).toFixed(1);
      const limitMb = (maxSizeBytes / (1024 * 1024)).toFixed(0);
      console.log(`[Storage Cleanup] Deleted ${deletedSegments} segments + ${deletedEventIds.size} events. Freed ${freedMb}MB. Remaining: ${remainMb}MB / ${limitMb}MB limit.`);
    }
  } catch (err) {
    console.error("[Storage Cleanup] Error running auto-rotation clean:", err);
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
        if (!file.endsWith(".ts")) continue;
        const match = file.match(/seg_(\d+)\.ts/);
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
      const indexFile = path.join(dirPath, "index.m3u8");
      if (fsSync.existsSync(indexFile)) {
        const remaining = await fs.readdir(dirPath);
        const hasSegments = remaining.some(f => f.endsWith(".ts"));
        if (!hasSegments) {
          await fs.unlink(indexFile).catch(() => {});
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
