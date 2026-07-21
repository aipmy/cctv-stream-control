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
      if (file.startsWith("seg_") && file.endsWith(".ts")) {
        const ts = parseInt(file.slice(4, -3), 10);
        if (ts >= startUnix && ts <= endUnix) {
          segments.push({ ts });
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
      if (!file.endsWith(".ts")) continue;
      const match = file.match(/seg_(\d+)\.ts/);
      if (!match) continue;
      const ts = parseInt(match[1], 10);
      if (ts >= startUnix && ts <= endUnix) {
        segments.push({ file, ts });
      }
    }

    if (segments.length === 0) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.type("application/vnd.apple.mpegurl");
      return res.send("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-ENDLIST\n");
    }

    segments.sort((a, b) => a.ts - b.ts);

    const lines = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-PLAYLIST-TYPE:VOD",
      `#EXT-X-TARGETDURATION:30`, // Must be >= max EXTINF which is 30
      "#EXT-X-MEDIA-SEQUENCE:0",
    ];

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
      }
      
      lines.push(`#EXTINF:${duration.toFixed(6)},`);
      lines.push(appendQuery(current.file, q));
    }
    lines.push("#EXT-X-ENDLIST");

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
      if (!file.endsWith(".ts")) continue;
      const match = file.match(/seg_(\d+)\.ts/);
      if (!match) continue;
      const ts = parseInt(match[1], 10);
      segments.push({ file, path: path.join(dir, file), ts });
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

streamRoutes.get("/:id/download", requirePermission("canViewPlayback"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const startUnix = parseInt(req.query.start, 10);
    const endUnix = parseInt(req.query.end, 10);

    if (isNaN(startUnix) || isNaN(endUnix)) {
      return res.status(400).send("Valid start and end Unix timestamps are required");
    }

    const dir = path.join(config.storageDir, "record_hls", id);
    if (!dir || !fs.existsSync(dir)) {
      return res.status(404).send("Stream directory not found");
    }

    const files = await fs.promises.readdir(dir);
    const segments = [];
    for (const file of files) {
      if (!file.endsWith(".ts")) continue;
      const match = file.match(/seg_(\d+)\.ts/);
      if (!match) continue;
      const ts = parseInt(match[1], 10);
      if (ts >= startUnix && ts <= endUnix) {
        segments.push({
          file,
          path: path.join(dir, file),
          ts,
        });
      }
    }

    if (segments.length === 0) {
      return res.status(404).send("No recorded video segments found in this time range");
    }

    segments.sort((a, b) => a.ts - b.ts);

    // Create temp concat file and output MP4 file
    const tempDir = path.join(config.storageDir, "temp_downloads");
    await fs.promises.mkdir(tempDir, { recursive: true });
    
    const randomSuffix = Math.random().toString(36).slice(2, 6);
    const concatTxtPath = path.join(tempDir, `concat_${id}_${randomSuffix}.txt`);
    const tempMp4Path = path.join(tempDir, `clip_${id}_${randomSuffix}.mp4`);

    const concatContent = segments.map((s) => `file '${s.path}'`).join("\n");
    await fs.promises.writeFile(concatTxtPath, concatContent);

    // Run FFmpeg to merge segments into standard MP4
    const concatArgs = [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatTxtPath,
      "-c", "copy",
      "-movflags", "+faststart",
      tempMp4Path,
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn(config.ffmpegBin, concatArgs, { stdio: "ignore" });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}`));
      });
      proc.on("error", reject);
    });

    // Send the compiled MP4 file to user
    res.download(tempMp4Path, `cctv_${id}_${startUnix}_${endUnix}.mp4`, async (err) => {
      // Clean up temp files after transfer completed/aborted
      await fs.promises.unlink(concatTxtPath).catch(() => {});
      await fs.promises.unlink(tempMp4Path).catch(() => {});
    });
  } catch (err) {
    next(err);
  }
});

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
