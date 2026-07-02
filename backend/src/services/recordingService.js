import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { config } from "../core/config.js";
import jpeg from "jpeg-js";
import { rgbaToGray, detectMotion } from "../core/motionEngine.js";
import { JsonStore } from "../core/jsonStore.js";
import { getCamera, listCameras } from "./cameraService.js";
import { buildSourceUrl } from "../core/cctv.js";
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
  sourceQualityRecording: true,
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
      sourceQualityRecording: Boolean(payload.sourceQualityRecording ?? settings.sourceQualityRecording ?? true),
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
export async function triggerEvent(cameraId, type, { req = null } = {}) {
  const camera = await getCamera(cameraId, { revealSecret: true });
  if (!camera) {
    throw new Error(`Camera with ID ${cameraId} not found`);
  }

  const settings = await getSettings();
  const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  
  const eventsDir = path.join(config.storageDir, "events");
  await fs.mkdir(eventsDir, { recursive: true });

  const snapshotFilename = `${eventId}.jpg`;
  const videoFilename = `${eventId}.mp4`;
  const snapshotFile = path.join(eventsDir, snapshotFilename);
  const videoFile = path.join(eventsDir, videoFilename);

  // Check HLS playlist to use segment-based pre-recording
  const hlsSubdir = camera.streamType.replace(/\W+/g, "_").toLowerCase();
  const recordHlsDir = path.join(config.storageDir, "record_hls", camera.id, hlsSubdir);
  const recordPlaylistFile = path.join(recordHlsDir, "index.m3u8");
  
  const standardHlsDir = path.join(config.storageDir, "hls", camera.id, hlsSubdir);
  const standardPlaylistFile = path.join(standardHlsDir, "index.m3u8");

  let useSegmentMerger = false;
  let hlsDir = null;
  let playlistFile = null;

  if (fsSync.existsSync(recordPlaylistFile)) {
    useSegmentMerger = true;
    hlsDir = recordHlsDir;
    playlistFile = recordPlaylistFile;
  } else if (fsSync.existsSync(standardPlaylistFile)) {
    useSegmentMerger = true;
    hlsDir = standardHlsDir;
    playlistFile = standardPlaylistFile;
  }

  // Create Event record (optimistically assumed to be created)
  const newEvent = {
    id: eventId,
    cameraId: camera.id,
    cameraName: camera.name,
    site: camera.site,
    ts: new Date().toISOString(),
    type,
    snapshotPath: `/api/events/snapshot/${eventId}`,
    videoPath: camera.enableRecording ? `/api/events/video/${eventId}` : "",
  };



  // Audit log
  if (req) {
    await auditRequest(req, {
      actor: req.user || { username: "System Event Engine" },
      action: "cctv.event_triggered",
      outcome: "success",
      target: { type: "camera", id: camera.id, label: camera.name },
      details: { eventId, type, useSegmentMerger },
    });
  }

  // Run the recording, snapshot extraction, and notification asynchronously
  if (useSegmentMerger) {
    void processSegmentEventRecording({
      eventId,
      cameraId: camera.id,
      hlsDir,
      playlistFile,
      snapshotFile,
      videoFile,
      enableRecording: camera.enableRecording,
      enableNotifications: camera.enableNotifications,
      settings,
      cameraName: camera.name,
      site: camera.site,
      type,
    });
  } else {
    void processFallbackEventRecording({
      eventId,
      camera,
      snapshotFile,
      videoFile,
      enableRecording: camera.enableRecording,
      enableNotifications: camera.enableNotifications,
      settings,
      type,
    });
  }

  return newEvent;
}

/**
 * Parses HLS playlist to extract .ts segment files.
 */
async function getPlaylistSegments(playlistPath) {
  try {
    const content = await fs.readFile(playlistPath, "utf8");
    return content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("#"));
  } catch (err) {
    return [];
  }
}

/**
 * Handles HLS segment copy, pre-recording extraction, and merging.
 */
/**
 * Handles HLS segment copy, pre-recording extraction, and merging.
 */
async function processSegmentEventRecording({
  eventId,
  cameraId,
  hlsDir,
  playlistFile,
  snapshotFile,
  videoFile,
  enableRecording,
  enableNotifications,
  settings,
  cameraName,
  site,
  type,
}) {
  const triggerUnixTime = Math.floor(Date.now() / 1000);
  let classifiedMode = "pixel";
  let ignored = false;
  const tempWorkspace = path.join(config.storageDir, "temp_recordings", eventId);
  await fs.mkdir(tempWorkspace, { recursive: true });

  try {
    // 1. Wait for 20 seconds to allow HLS segments covering the event window to be fully written to disk
    await new Promise((resolve) => setTimeout(resolve, 20000));

    if (!fsSync.existsSync(hlsDir)) {
      console.error(`[Event Recording] HLS directory not found for ${cameraId}: ${hlsDir}`);
      return;
    }

    // 2. Scan HLS directory for all .ts segment files
    const files = await fs.readdir(hlsDir);
    const segments = [];
    for (const file of files) {
      if (!file.endsWith(".ts")) continue;
      const filePath = path.join(hlsDir, file);
      try {
        const stats = await fs.stat(filePath);
        let ts = Math.floor(stats.mtimeMs / 1000); // Fallback: use file modification time
        const match = file.match(/seg_(\d+)\.ts/);
        if (match) {
          ts = parseInt(match[1], 10);
        }
        segments.push({
          file,
          path: filePath,
          ts,
        });
      } catch { /* ignore */ }
    }

    if (segments.length === 0) {
      console.error(`[Event Recording] No segment files found in HLS directory for ${cameraId}`);
      return;
    }

    // Sort segments chronologically
    segments.sort((a, b) => a.ts - b.ts);
    // 3. Find the segment file that contains the trigger timestamp (the one closest to but not after triggerUnixTime)
    let triggerSegment = null;
    let triggerIdx = -1;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].ts <= triggerUnixTime) {
        triggerSegment = segments[i];
        triggerIdx = i;
        break;
      }
    }
    if (!triggerSegment) {
      triggerSegment = segments[0];
      triggerIdx = 0;
    }

    // 4. Extract snapshot frames using Jimp, relative to the actual trigger offset in the segment
    const snapSegmentPath1 = triggerSegment.path;
    const offsetSec1 = Math.max(0, triggerUnixTime - triggerSegment.ts);

    let snapSegmentPath2 = snapSegmentPath1;
    let offsetSec2 = offsetSec1 + 0.5;

    // Use the next segment for frame2 if it exists, to prevent out-of-bounds errors on short HLS segments
    if (triggerIdx !== -1 && triggerIdx + 1 < segments.length) {
      snapSegmentPath2 = segments[triggerIdx + 1].path;
      offsetSec2 = 0;
    } else if (offsetSec1 > 0.5) {
      offsetSec2 = offsetSec1 - 0.5;
    }

    const frame1File = path.join(tempWorkspace, "frame1.jpg");
    const frame2File = path.join(tempWorkspace, "frame2.jpg");

    await new Promise((resolve) => {
      const proc = spawn(config.ffmpegBin, ["-y", "-ss", String(offsetSec1), "-i", snapSegmentPath1, "-vframes", "1", "-vf", "scale=-1:360", "-q:v", "2", frame1File], { stdio: "ignore" });
      proc.on("close", resolve);
    });

    await new Promise((resolve) => {
      const proc = spawn(config.ffmpegBin, ["-y", "-ss", String(offsetSec2), "-i", snapSegmentPath2, "-vframes", "1", "-vf", "scale=-1:360", "-q:v", "2", frame2File], { stdio: "ignore" });
      proc.on("close", resolve);
    });
    let motionOverlayApplied = false;
    const frame1Exists = fsSync.existsSync(frame1File);
    const frame2Exists = fsSync.existsSync(frame2File);

    if (frame1Exists) {
      if (frame2Exists) {
        try {
          const buf1 = fsSync.readFileSync(frame1File);
          const buf2 = fsSync.readFileSync(frame2File);
          const img1 = jpeg.decode(buf1, { useTArray: true });
          const img2 = jpeg.decode(buf2, { useTArray: true });

          const width = img1.width;
          const height = img1.height;
          const gray1 = rgbaToGray(img1.data, width, height);
          const gray2 = rgbaToGray(img2.data, width, height);

          const camera = await getCamera(cameraId, { revealSecret: true });
          const detectionModes = camera?.detectionModes || ["pixel", "human", "pet"];
          const motionResult = detectMotion(gray1, gray2, width, height, {
            sensitivity: camera?.motionSensitivity ?? 50,
            excludeAreas: camera?.excludeAreas || [],
          });

          if (motionResult.motion && motionResult.boxes.length > 0) {
            // Classify based on bounding box shape
            const largestBox = motionResult.boxes.reduce((a, b) => (a.w * a.h > b.w * b.h ? a : b));
            const ratio = largestBox.h / largestBox.w;
            const coverage = (largestBox.w * largestBox.h) / (width * height);

            // Kamera CCTV dipasang dari sudut atas → orang terlihat dari atas
            // dan bounding box-nya cenderung lebar/kotak (rasio h/w bisa < 1.0).
            // Gunakan coverage dan ukuran absolut sebagai penentu utama,
            // bukan rasio tinggi/lebar yang hanya cocok untuk kamera depan.
            if (coverage > 0.80) {
              // Terlalu besar = perubahan seluruh frame (cahaya, bayangan, dll)
              classifiedMode = "pixel";
            } else if (largestBox.w > 20 && largestBox.h > 20) {
              // Objek cukup besar → kemungkinan besar manusia
              // (ratio > 0.5 agar tetap exclude noise horizontal tipis)
              classifiedMode = ratio > 0.5 ? "human" : "pixel";
            } else {
              classifiedMode = "pixel";
            }

            const isMatch = detectionModes.includes(classifiedMode);
            if (!isMatch) {
              console.log(`[Event Recording] Event ${eventId} ignored. Classified '${classifiedMode}' but camera only allows '${detectionModes.join(", ")}'.`);
              ignored = true;
              return;
            }

            const labelMap = {
              human: "Gerakan (Manusia)",
              pet: "Gerakan (Hewan/Lainnya)",
              pixel: "Gerakan (Perubahan Gambar)",
            };
            const eventRecord = {
              id: eventId,
              cameraId,
              cameraName,
              site,
              ts: new Date().toISOString(),
              type,
              snapshotPath: `/api/events/snapshot/${eventId}`,
              videoPath: enableRecording ? `/api/events/video/${eventId}` : "",
              typeDescription: labelMap[classifiedMode] || "Deteksi Gerakan",
              classification: classifiedMode,
            };
            await eventStore.update((events) => {
              return [eventRecord, ...events].slice(0, 1000);
            });

            // Draw red bounding boxes directly on RGBA buffer
            for (const box of motionResult.boxes) {
              const thickness = 3;
              const bx = Math.max(0, box.x);
              const by = Math.max(0, box.y);
              const bx2 = Math.min(width - 1, box.x + box.w);
              const by2 = Math.min(height - 1, box.y + box.h);
              for (let t = 0; t < thickness; t++) {
                for (let x = bx; x <= bx2; x++) {
                  for (const row of [by + t, by2 - t]) {
                    if (row >= 0 && row < height) {
                      const idx = (width * row + x) << 2;
                      img1.data[idx] = 255; img1.data[idx + 1] = 0; img1.data[idx + 2] = 0;
                    }
                  }
                }
                for (let y = by; y <= by2; y++) {
                  for (const col of [bx + t, bx2 - t]) {
                    if (col >= 0 && col < width) {
                      const idx = (width * y + col) << 2;
                      img1.data[idx] = 255; img1.data[idx + 1] = 0; img1.data[idx + 2] = 0;
                    }
                  }
                }
              }
            }
          }

          // Encode back to JPEG and save
          const encoded = jpeg.encode({ data: img1.data, width, height }, 85);
          fsSync.writeFileSync(snapshotFile, encoded.data);
          motionOverlayApplied = true;
        } catch (err) {
          console.error(`[Snapshot Overlay] Processing failed for ${eventId}:`, err);
        }
      }

      if (!motionOverlayApplied) {
        await fs.copyFile(frame1File, snapshotFile).catch(() => {});
      }

      if (!ignored) {
        const camera = await getCamera(cameraId, { revealSecret: true });
        const detectionModes = camera?.detectionModes || ["pixel", "human", "pet"];
        const isMatch = detectionModes.includes(classifiedMode);
        if (!isMatch) {
          console.log(`[Event Recording] Fallback event ${eventId} ignored. Classified '${classifiedMode}' but camera only allows '${detectionModes.join(", ")}'.`);
          ignored = true;
        }
      }

      if (!ignored) {
        const currentEvents = await eventStore.read();
        const exists = currentEvents.some((e) => e.id === eventId);
        if (!exists) {
          const eventRecord = {
            id: eventId,
            cameraId,
            cameraName,
            site,
            ts: new Date().toISOString(),
            type,
            snapshotPath: `/api/events/snapshot/${eventId}`,
            videoPath: enableRecording ? `/api/events/video/${eventId}` : "",
            typeDescription: "Deteksi Gerakan",
            classification: "pixel",
          };
          await eventStore.update((events) => {
            return [eventRecord, ...events].slice(0, 1000);
          });
        }
      }
    }

    // 5. Merge segments for a 30-second window: 10s pre-recording, 20s post-recording
    if (!ignored && enableRecording) {
      const startTimeWindow = triggerUnixTime - 15;
      const endTimeWindow = triggerUnixTime + 15;

      const segmentsToMerge = segments.filter(
        (s) => s.ts >= startTimeWindow && s.ts <= endTimeWindow
      );

      if (segmentsToMerge.length > 0) {
        const concatTxtPath = path.join(tempWorkspace, "concat.txt");
        const concatContent = segmentsToMerge
          .map((s) => `file '${s.path}'`)
          .join("\n");
        await fs.writeFile(concatTxtPath, concatContent);

        const concatArgs = [
          "-y",
          "-f", "concat",
          "-safe", "0",
          "-i", concatTxtPath,
          "-c", "copy",
          "-movflags", "+faststart",
          videoFile,
        ];

        await new Promise((resolve) => {
          const proc = spawn(config.ffmpegBin, concatArgs, { stdio: "ignore" });
          proc.on("close", resolve);
        });
      } else {
        console.warn(`[Event Recording] No segments in HLS found within clip time window for ${eventId}`);
      }
    }

    // 6. Send Telegram Notification
    if (!ignored && enableNotifications && settings.telegramBotToken && settings.telegramChatId) {
      await sendTelegramAlert(settings.telegramBotToken, settings.telegramChatId, {
        cameraName,
        site,
        type: classifiedMode,
        snapshotFile,
      });
    }
  } catch (err) {
    console.error(`[Event Recording] Error processing event ${eventId}:`, err);
  } finally {
    await fs.rm(tempWorkspace, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Fallback to direct RTSP/stream recording if HLS stream is not active.
 */
async function processFallbackEventRecording({
  eventId,
  camera,
  snapshotFile,
  videoFile,
  enableRecording,
  enableNotifications,
  settings,
  type,
}) {
  try {
    const sourceUrl = buildSourceUrl(camera);
    const isRtsp = camera.sourceType === "RTSP" || camera.sourceType === "RTSP+ONVIF";
    const transport = ["tcp", "udp", "auto"].includes(camera.rtspTransport) ? camera.rtspTransport : "tcp";

    // 1. Capture snapshot via FFmpeg
    const snapArgs = [
      "-y",
      ...(isRtsp && transport !== "auto" ? ["-rtsp_transport", transport] : []),
      "-i", sourceUrl,
      "-vframes", "1",
      "-q:v", "2",
      snapshotFile
    ];

    const snapProcess = spawn(config.ffmpegBin, snapArgs, { stdio: "ignore" });
    const snapSuccess = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        snapProcess.kill("SIGKILL");
        resolve(false);
      }, 10000);
      snapProcess.on("close", (code) => {
        clearTimeout(timeout);
        resolve(code === 0);
      });
    });

    if (!snapSuccess) return;

    // Check if the event matches the camera's detection modes
    const detectionModes = camera?.detectionModes || ["pixel", "human", "pet"];
    if (type === "motion" && !detectionModes.includes("pixel")) {
      console.log(`[Fallback Event] Event ${eventId} ignored. Camera only allows '${detectionModes.join(", ")}' but fallback does not support classification.`);
      return;
    }

    // 2. Start Video Recording in background (if enabled)
    if (enableRecording) {
      const videoArgs = [
        "-y",
        ...(isRtsp && transport !== "auto" ? ["-rtsp_transport", transport] : []),
        "-i", sourceUrl,
        "-t", "15",
        "-c", "copy",
        videoFile
      ];

      await new Promise((resolve) => {
        const videoProcess = spawn(config.ffmpegBin, videoArgs, { stdio: "ignore" });
        videoProcess.on("close", (code) => {
          if (code !== 0) {
            // Fallback to recording without audio copy
            const noAudioArgs = [
              "-y",
              ...(isRtsp && transport !== "auto" ? ["-rtsp_transport", transport] : []),
              "-i", sourceUrl,
              "-t", "15",
              "-c:v", "copy",
              "-an",
              videoFile
            ];
            const fallbackProc = spawn(config.ffmpegBin, noAudioArgs, { stdio: "ignore" });
            fallbackProc.on("close", resolve);
          } else {
            resolve();
          }
        });
      });
    }

    // 3. Send Telegram Notification
    if (enableNotifications && settings.telegramBotToken && settings.telegramChatId) {
      await sendTelegramAlert(settings.telegramBotToken, settings.telegramChatId, {
        cameraName: camera.name,
        site: camera.site,
        type,
        snapshotFile,
      });
    }

    // 4. Save Event to DB
    const eventRecord = {
      id: eventId,
      cameraId: camera.id,
      cameraName: camera.name,
      site: camera.site,
      ts: new Date().toISOString(),
      type,
      snapshotPath: `/api/events/snapshot/${eventId}`,
      videoPath: enableRecording ? `/api/events/video/${eventId}` : "",
      typeDescription: type === "motion" ? "Deteksi Gerakan" : "Deteksi Suara",
      classification: type === "motion" ? "pixel" : undefined,
    };
    await eventStore.update((events) => {
      return [eventRecord, ...events].slice(0, 1000);
    });
  } catch (err) {
    console.error(`[Fallback Recording] Error processing event ${eventId}:`, err);
  }
}

/**
 * Sends photo snapshot to Telegram.
 */
async function sendTelegramAlert(token, chatId, { cameraName, site, type, snapshotFile }) {
  let emoji = "⚠️🏃";
  let typeLabel = "Gerakan";
  if (type === "sound") {
    emoji = "🔊";
    typeLabel = "Suara Bising";
  } else if (type === "human") {
    emoji = "⚠️🚶‍♂️";
    typeLabel = "Manusia Terdeteksi";
  } else if (type === "pet") {
    emoji = "⚠️🐕";
    typeLabel = "Hewan/Lainnya Terdeteksi";
  } else if (type === "pixel") {
    emoji = "⚠️📷";
    typeLabel = "Perubahan Gambar";
  }
  const caption = `${emoji} *Smart CCTV Alert*\n\n*Kamera:* ${cameraName}\n*Lokasi:* ${site}\n*Tipe:* ${typeLabel}\n*Waktu:* ${new Date().toLocaleString("id-ID")}`;

  try {
    const fileData = await fs.readFile(snapshotFile);
    const blob = new Blob([fileData], { type: "image/jpeg" });

    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("photo", blob, "snapshot.jpg");
    formData.append("caption", caption);
    formData.append("parse_mode", "Markdown");

    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Telegram API responded with ${res.status}: ${errText}`);
    }
  } catch (err) {
    console.error("Error sending Telegram snapshot photo:", err.message);
  }
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

    const fileInfos = [];

    // 1. Scan events directory
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

    // 2. Scan HLS streams directory for .ts files
    const hlsBaseDir = path.join(config.storageDir, "hls");
    if (fsSync.existsSync(hlsBaseDir)) {
      const events = await listEvents();
      const eventsByCamera = new Map();
      for (const evt of events) {
        if (evt.type !== "motion") continue;
        const tsSec = Math.floor(new Date(evt.ts).getTime() / 1000);
        if (!eventsByCamera.has(evt.cameraId)) {
          eventsByCamera.set(evt.cameraId, []);
        }
        eventsByCamera.get(evt.cameraId).push(tsSec);
      }
      const pre = settings.preMotionSeconds || 15;
      const post = settings.postMotionSeconds || 15;
      
      const cameras = await listCameras({ revealSecret: true });
      const cameraMap = new Map(cameras.map((c) => [c.id, c]));

      const isSegmentActive = (cameraId, segTsSec) => {
        const camera = cameraMap.get(cameraId);
        if (!camera || !camera.enableRecording) return false;
        if (camera.recordingMode !== "event") return true;
        
        const camEvents = eventsByCamera.get(cameraId) || [];
        for (const evtTs of camEvents) {
          if (segTsSec >= evtTs - pre && segTsSec <= evtTs + post) return true;
        }
        return false;
      };

      const cameraDirs = await fs.readdir(hlsBaseDir);
      for (const cameraId of cameraDirs) {
        const camDir = path.join(hlsBaseDir, cameraId);
        const subdirs = ["hls_stable", "hls_low_latency"];
        for (const subdir of subdirs) {
          const dirPath = path.join(camDir, subdir);
          if (!fsSync.existsSync(dirPath)) continue;

          const files = await fs.readdir(dirPath);
          for (const file of files) {
            if (!file.endsWith(".ts")) continue;
            const match = file.match(/seg_(\d+)\.ts/);
            if (!match) continue;
            const timestampSec = parseInt(match[1], 10);
            const timestamp = timestampSec * 1000; // in ms
            const filePath = path.join(dirPath, file);

            const camera = cameraMap.get(cameraId);
            const recordingEnabled = camera?.enableRecording ?? false;
            const isEventMode = camera?.recordingMode === "event";

            // Delete segment if recording is disabled, or if event mode is active and segment is outside motion window
            if (!recordingEnabled || (isEventMode && !isSegmentActive(cameraId, timestampSec))) {
              await fs.unlink(filePath).catch(() => {});
              continue;
            }

            try {
              const stats = await fs.stat(filePath);
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

    // Sort oldest first
    fileInfos.sort((a, b) => a.time - b.time);

    let totalSize = fileInfos.reduce((sum, f) => sum + f.size, 0);
    const deletedEventIds = new Set();

    for (const fileInfo of fileInfos) {
      const isExpired = (now - fileInfo.time) > retentionMs;
      const isOverQuota = totalSize > maxSizeBytes;

      if (isExpired || isOverQuota) {
        await fs.unlink(fileInfo.path).catch(() => {});
        totalSize -= fileInfo.size;

        if (fileInfo.type === "event") {
          // Extract event ID from filename to purge from DB
          const match = fileInfo.name.match(/^(evt_[a-z0-9_]+)\.(jpg|mp4)$/i);
          if (match) {
            deletedEventIds.add(match[1]);
          }
        }
      }
    }

    if (deletedEventIds.size > 0) {
      await eventStore.update((events) => {
        return events.filter((e) => !deletedEventIds.has(e.id));
      });
      console.log(`[Storage Cleanup] Cleaned up ${deletedEventIds.size} event records.`);
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

  const hlsBaseDir = path.join(config.storageDir, "hls", cameraId);
  const subdirs = ["hls_stable", "hls_low_latency"];
  let deletedCount = 0;

  for (const subdir of subdirs) {
    const dirPath = path.join(hlsBaseDir, subdir);
    if (!fsSync.existsSync(dirPath)) continue;

    const files = await fs.readdir(dirPath);
    for (const file of files) {
      if (!file.endsWith(".ts")) continue;
      const match = file.match(/seg_(\d+)\.ts/);
      if (!match) continue;
      const ts = parseInt(match[1], 10);
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
  return deletedCount;
}

export async function deleteAllRecordings(cameraId) {
  const hlsBaseDir = path.join(config.storageDir, "hls", cameraId);
  if (fsSync.existsSync(hlsBaseDir)) {
    await fs.rm(hlsBaseDir, { recursive: true, force: true }).catch(() => {});
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
