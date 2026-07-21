import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";
import { Router } from "express";
import { config } from "../core/config.js";
import { getCamera, markCameraStatus } from "../services/cameraService.js";
import { startAiStream, motionEmitter } from "../stream/streamManager.js";
import { classifyStreamError } from "../stream/streamError.js";
import { requirePermission } from "../middleware/authMiddleware.js";

export const streamRoutes = Router();
const diskUsageCache = new Map(); // cameraId -> { size, ts }

export function parseTimestamp(val) {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val === "number") {
    if (isNaN(val) || !isFinite(val) || val <= 0) return null;
    return val > 1e11 ? val / 1000 : val;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (!isNaN(num)) {
      if (num <= 0 || !isFinite(num)) return null;
      return num > 1e11 ? num / 1000 : num;
    }
    const ms = Date.parse(trimmed);
    if (isNaN(ms) || ms <= 0) return null;
    return ms / 1000;
  }
  return null;
}

// Validate camera access by user's allowedGroups/sites
streamRoutes.param("id", async (req, res, next, id) => {
  try {
    if (!config.requireAuth) return next();
    if (req.auth?.role === "admin") return next();

    const camera = await getCamera(id);
    if (!camera) return next(); // Let downstream routes handle 404

    if (Array.isArray(req.auth?.allowedGroups)) {
      if (req.auth.allowedGroups.length > 0 && !req.auth.allowedGroups.includes(camera.site)) {
        return res.status(403).json({ error: "Aksi tidak diizinkan untuk akun Anda" });
      }
    }
    return next();
  } catch (err) {
    next(err);
  }
});

// ──────────────────── SSE: Real-time Motion Events ────────────────────
streamRoutes.get("/:id/events", async (req, res) => {
  const { id } = req.params;
  const camera = await getCamera(id);
  if (!camera) return res.status(404).json({ error: "Camera not found" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("data: {\"connected\":true}\n\n");

  // Wake up the AI backend loop if it's not running
  try {
    await startAiStream(id);
  } catch (err) {
    console.error(`[SSE] Failed to wake up AI backend for ${id}:`, err.message);
  }

  const eventName = `motion-${id}`;
  const aiEventName = `ai-motion-${id}`;
  
  const handler = (data) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const aiHandler = (data) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify({ type: "ai-motion", ...data })}\n\n`);
  };

  motionEmitter.on(eventName, handler);
  motionEmitter.on(aiEventName, aiHandler);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    if (res.writableEnded) { clearInterval(heartbeat); return; }
    res.write(": heartbeat\n\n");
  }, 15000);

  req.on("close", () => {
    motionEmitter.off(eventName, handler);
    motionEmitter.off(aiEventName, aiHandler);
    clearInterval(heartbeat);
  });
});

function appendQuery(line, query) {
  if (!query) return line;
  const sep = line.includes("?") ? "&" : "?";
  return `${line}${sep}${query}`;
}

streamRoutes.get("/:id/playback-info", requirePermission("canViewPlayback"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).send("Date is required");

    let diskUsageBytes = 0;
    const hlsBaseDir = path.join(config.storageDir, "record_hls", id);
    try {
      if (fs.existsSync(hlsBaseDir)) {
        const cached = diskUsageCache.get(id);
        const now = Date.now();
        if (cached && now - cached.ts < 30000) { // Cache for 30s
          diskUsageBytes = cached.size;
        } else {
          const calculateDirSize = async (dirPath) => {
            let total = 0;
            const list = await fs.promises.readdir(dirPath, { withFileTypes: true });
            for (const item of list) {
              const fullPath = path.join(dirPath, item.name);
              if (item.isDirectory()) {
                total += await calculateDirSize(fullPath);
              } else if (item.isFile()) {
                const stats = await fs.promises.stat(fullPath);
                total += stats.size;
              }
            }
            return total;
          };
          diskUsageBytes = await calculateDirSize(hlsBaseDir);
          diskUsageCache.set(id, { size: diskUsageBytes, ts: now });
        }
      }
    } catch (err) {
      console.error("Error calculating HLS dir size:", err);
    }

    const camera = await getCamera(id);
    const hlsMode = camera?.hlsMode || "copy";
    const streamType = camera?.streamType || "HLS Stable";
    const targetDuration = (hlsMode === "copy" || streamType === "HLS Low Latency") ? 1 : 2;

    const dir = path.join(config.storageDir, "record_hls", id);
    
    if (!dir || !fs.existsSync(dir)) {
      return res.json({ hasRecording: false, diskUsageBytes });
    }

    const startOfDay = new Date(`${date}T00:00:00`);
    const endOfDay = new Date(`${date}T23:59:59.999`);
    const startUnix = req.query.start ? parseInt(req.query.start, 10) : Math.floor(startOfDay.getTime() / 1000);
    const endUnix = req.query.end ? parseInt(req.query.end, 10) : Math.floor(endOfDay.getTime() / 1000);

    const files = await fs.promises.readdir(dir);
    const segments = [];
    for (const file of files) {
      const match = file.match(/^seg_(\d+)\.(ts|mp4|m4s)$/);
      if (match) {
        const ts = parseInt(match[1], 10);
        if (ts >= startUnix && ts <= endUnix) {
          segments.push({ ts, file, type: match[2] });
        }
      }
    }

    if (segments.length === 0) {
      return res.json({ hasRecording: false, diskUsageBytes });
    }

    segments.sort((a, b) => a.ts - b.ts);

    const segmentMappings = [];
    let currentOffset = 0;
    if (segments.length > 0) {
      let activeBlock = null;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        // Default to targetDuration for the last segment before a gap or EOF
        let duration = targetDuration;
        let isContiguous = false;
        
        if (i < segments.length - 1) {
          const diff = segments[i + 1].ts - seg.ts;
          if (diff > 0 && diff <= 30) {
            duration = diff;
            isContiguous = true;
          }
        }
        
        if (!activeBlock) {
          activeBlock = {
            ts: seg.ts,
            offset: currentOffset,
            duration: duration
          };
        } else {
          activeBlock.duration += duration;
        }
        
        if (!isContiguous) {
          segmentMappings.push(activeBlock);
          currentOffset += activeBlock.duration;
          activeBlock = null;
        }
      }
    }

    res.json({
      hasRecording: true,
      firstSegmentUnixTime: segments[0].ts,
      lastSegmentUnixTime: segments[segments.length - 1].ts,
      segmentMappings,
      diskUsageBytes,
    });
  } catch (err) { next(err); }
});

streamRoutes.get("/:id/playback.m3u8", requirePermission("canViewPlayback"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date } = req.query; // format YYYY-MM-DD
    if (!date) return res.status(400).send("Date query parameter is required");

    const camera = await getCamera(id);
    const hlsMode = camera?.hlsMode || "copy";
    const streamType = camera?.streamType || "HLS Stable";
    const targetDuration = (hlsMode === "copy" || streamType === "HLS Low Latency") ? 1 : 2;

    const dir = path.join(config.storageDir, "record_hls", id);
    
    if (!dir || !fs.existsSync(dir)) {
      return res.status(404).send("Playback stream directory not found");
    }

    const startOfDay = new Date(`${date}T00:00:00`);
    const endOfDay = new Date(`${date}T23:59:59.999`);
    const startUnix = req.query.start ? parseInt(req.query.start, 10) : Math.floor(startOfDay.getTime() / 1000);
    const endUnix = req.query.end ? parseInt(req.query.end, 10) : Math.floor(endOfDay.getTime() / 1000);

    const files = await fs.promises.readdir(dir);
    const segments = [];

    for (const file of files) {
      const match = file.match(/^seg_(\d+)\.(ts|mp4|m4s)$/);
      if (!match) continue;
      const ts = parseInt(match[1], 10);
      if (ts >= startUnix && ts <= endUnix) {
        segments.push({ file, ts, type: match[2] });
      }
    }

    if (segments.length === 0) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.type("application/vnd.apple.mpegurl");
      return res.send("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-ENDLIST\n");
    }

    segments.sort((a, b) => a.ts - b.ts);

    const isToday = new Date().toISOString().split("T")[0] === date;
    const playlistType = isToday ? "EVENT" : "VOD";

    const lines = [
      "#EXTM3U",
      "#EXT-X-VERSION:6",
      `#EXT-X-PLAYLIST-TYPE:${playlistType}`,
      `#EXT-X-TARGETDURATION:30`, // Must be >= max EXTINF which is 30
      "#EXT-X-MEDIA-SEQUENCE:0",
    ];

    let currentMap = null;

    const q = req.authToken ? `token=${req.authToken}` : "";
    for (let i = 0; i < segments.length; i++) {
      const current = segments[i];
      // USE targetDuration so it matches segmentMappings EXACTLY!
      let duration = targetDuration;
      if (i < segments.length - 1) {
        const diff = segments[i + 1].ts - current.ts;
        if (diff > 0 && diff <= 30) {
          duration = diff;
        }
      }
      
      if (i > 0 && current.ts - segments[i - 1].ts > 30) {
        lines.push("#EXT-X-DISCONTINUITY");
        currentMap = null;
      }
      
      const isFmp4 = current.type === "m4s" || current.type === "mp4";
      if (isFmp4 && currentMap !== "init.mp4") {
        lines.push(`#EXT-X-MAP:URI="${appendQuery('init.mp4', q)}"`);
        currentMap = "init.mp4";
      } else if (!isFmp4 && currentMap !== null) {
        currentMap = null;
      }

      lines.push(`#EXTINF:${duration.toFixed(6)},`);
      lines.push(appendQuery(current.file, q));
    }
    if (!isToday) {
      lines.push("#EXT-X-ENDLIST");
    }

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.type("application/vnd.apple.mpegurl");
    res.send(lines.join("\n"));
  } catch (err) {
    next(err);
  }
});

streamRoutes.get("/:id/snapshot-at", async (req, res, next) => {
  try {
    const { id } = req.params;
    const timeUnix = parseInt(req.query.time, 10);
    if (isNaN(timeUnix)) return res.status(400).send("Time unix timestamp is required");

    const camera = await getCamera(id);
    if (!camera) return res.status(404).send("Camera not found");

    const output = await getCameraOutput(id);
    const dir = path.join(config.storageDir, "record_hls", id);
    if (!dir || !fs.existsSync(dir)) {
      return res.status(404).send("No HLS recording found");
    }

    const files = await fs.promises.readdir(dir);
    const segments = [];
    for (const file of files) {
      const match = file.match(/^seg_(\d+)\.(ts|mp4|m4s)$/);
      if (!match) continue;
      const ts = parseInt(match[1], 10);
      segments.push({ file, path: path.join(dir, file), ts, type: match[2] });
    }

    if (segments.length === 0) return res.status(404).send("No recording segments found");
    segments.sort((a, b) => a.ts - b.ts);

    let targetSegment = null;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].ts <= timeUnix) {
        targetSegment = segments[i];
        break;
      }
    }

    if (!targetSegment) {
      targetSegment = segments[0];
    }

    const offset = Math.max(0, timeUnix - targetSegment.ts);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=60");

    const args = [
      "-y",
      "-ss", String(offset),
      "-i", targetSegment.path,
      "-vframes", "1",
      "-f", "image2",
      "-q:v", "5",
      "pipe:1"
    ];

    const proc = spawn(config.ffmpegBin, args);
    proc.stdout.pipe(res);
    proc.on("error", (err) => {
      if (!res.headersSent) res.status(500).send("Extraction error");
    });
  } catch (err) { next(err); }
});

streamRoutes.delete("/:id/recordings/today", requirePermission("canViewPlayback"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).send("Date parameter is required");
    const { deleteRecordingsForDate } = await import("../services/recordingService.js");
    const count = await deleteRecordingsForDate(id, date);
    res.json({ ok: true, deletedCount: count });
  } catch (err) { next(err); }
});

streamRoutes.delete("/:id/recordings/all", requirePermission("canViewPlayback"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { deleteAllRecordings } = await import("../services/recordingService.js");
    await deleteAllRecordings(id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

const handleClipDownload = async (req, res, next) => {
  let concatTxtPath = null;
  let tempMp4Path = null;
  try {
    const { id } = req.params;

    if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) {
      return res.status(404).json({ error: "Camera not found" });
    }

    const camera = await getCamera(id);
    if (!camera) {
      return res.status(404).json({ error: "Camera not found" });
    }

    const startRaw = req.query.startTime ?? req.query.start;
    const endRaw = req.query.endTime ?? req.query.end;

    const startUnix = parseTimestamp(startRaw);
    const endUnix = parseTimestamp(endRaw);

    if (startUnix === null || endUnix === null) {
      return res.status(400).json({ error: "Invalid start/end timestamp format" });
    }

    if (startUnix >= endUnix) {
      return res.status(400).json({ error: "startTime must be strictly less than endTime" });
    }

    const dir = path.join(config.storageDir, "record_hls", id);
    if (!dir || !fs.existsSync(dir)) {
      return res.status(404).json({ error: "No recorded video segments found in this time range" });
    }

    const files = await fs.promises.readdir(dir);
    const segments = [];
    const segDuration = 5;

    for (const file of files) {
      const match = file.match(/^seg_(\d+)\.(ts|mp4|m4s)$/);
      if (!match) continue;
      let ts = parseInt(match[1], 10);
      if (ts >= (startUnix - 10) && ts < endUnix && (ts + segDuration) > startUnix) {
        segments.push({
          file,
          path: path.join(dir, file),
          ts,
        });
      }
    }

    if (segments.length === 0) {
      return res.status(404).json({ error: "No recorded video segments found in this time range" });
    }

    segments.sort((a, b) => a.ts - b.ts);

    const firstSegTs = segments[0].ts;
    const startOffset = Math.max(0, startUnix - firstSegTs);
    const totalDuration = endUnix - startUnix;

    const tempDir = path.join(config.storageDir, "temp_downloads");
    await fs.promises.mkdir(tempDir, { recursive: true });

    const randomSuffix = Math.random().toString(36).slice(2, 8);
    concatTxtPath = path.join(tempDir, `concat_${id}_${randomSuffix}.txt`);
    tempMp4Path = path.join(tempDir, `clip_${id}_${randomSuffix}.mp4`);

    const concatContent = segments.map((s) => `file '${s.path.replace(/'/g, "'\\''")}'`).join("\n");
    await fs.promises.writeFile(concatTxtPath, concatContent);

    const ffmpegBin = config.ffmpegBin || "ffmpeg";
    const concatArgs = [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatTxtPath,
      "-ss", String(startOffset),
      "-t", String(totalDuration),
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-c:a", "aac",
      "-movflags", "+faststart",
      tempMp4Path,
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegBin, concatArgs, { stdio: "ignore" });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}`));
      });
      proc.on("error", reject);
    });

    if (concatTxtPath) {
      await fs.promises.unlink(concatTxtPath).catch(() => {});
      concatTxtPath = null;
    }

    const filename = `clip_${id}_${Math.floor(startUnix)}_${Math.floor(endUnix)}.mp4`;
    res.setHeader("Content-Type", "video/mp4");
    res.download(tempMp4Path, filename, async (err) => {
      if (tempMp4Path) {
        await fs.promises.unlink(tempMp4Path).catch(() => {});
        tempMp4Path = null;
      }
      if (err && !res.headersSent) {
        next(err);
      }
    });
  } catch (err) {
    if (concatTxtPath) {
      await fs.promises.unlink(concatTxtPath).catch(() => {});
      concatTxtPath = null;
    }
    if (tempMp4Path) {
      await fs.promises.unlink(tempMp4Path).catch(() => {});
      tempMp4Path = null;
    }
    next(err);
  }
};

streamRoutes.get("/:id/download", requirePermission("canViewPlayback"), handleClipDownload);
streamRoutes.get("/:id/clip", requirePermission("canViewPlayback"), handleClipDownload);

streamRoutes.get("/:id/:file", async (req, res, next) => {
  try {
    const recordFilePath = path.join(config.storageDir, "record_hls", req.params.id, req.params.file);
    if (fs.existsSync(recordFilePath) && !req.params.file.includes("..")) {
      res.setHeader("Cache-Control", "no-cache");
      return res.sendFile(recordFilePath);
    }
    return res.status(404).send("Segment not found");
  } catch (err) { next(err); }
});
