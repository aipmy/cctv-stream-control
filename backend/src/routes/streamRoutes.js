import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";
import { Router } from "express";
import { config } from "../core/config.js";
import { getCamera, markCameraStatus } from "../services/cameraService.js";
import { getHlsFilePath, serveMjpeg, startHls, startMjpeg, stopCameraStreams, streamStatus, waitForPlaylist, waitForMjpegFrame, recordViewer, recordCameraTraffic, isChildAlive, motionEmitter } from "../stream/streamManager.js";
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
    await startHls(id);
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

async function getCameraOutput(id) {
  const camera = await getCamera(id);
  if (!camera) return "HLS Stable";
  const q = camera.streamType;
  if (q === "MJPEG" || q === "mjpeg") return "MJPEG";
  return q === "HLS Low Latency" || q === "ll" ? "HLS Low Latency" : "HLS Stable";
}

function viewerId(req) {
  return String(req.query.vid || req.headers["x-cctv-viewer-id"] || `${req.ip}:${req.get("user-agent") || "ua"}`);
}

function getClientIp(req) {
  const cfIp = req.headers["cf-connecting-ip"];
  if (cfIp) return cfIp;
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (xForwardedFor) {
    const parts = xForwardedFor.split(",");
    return parts[0].trim();
  }
  const xRealIp = req.headers["x-real-ip"];
  if (xRealIp) return xRealIp;
  return req.ip || req.socket.remoteAddress || "";
}

function viewerDetails(req) {
  return {
    username: req.auth?.username || "anonymous",
    ip: getClientIp(req),
    userAgent: req.get("user-agent") || ""
  };
}

function segmentQuery(req, output) {
  const params = new URLSearchParams({ output });
  if (req.authToken) params.set("token", req.authToken);
  params.set("vid", viewerId(req));
  return params.toString();
}

function appendQuery(line, query) {
  const sep = line.includes("?") ? "&" : "?";
  return `${line}${sep}${query}`;
}

streamRoutes.get("/status", (_req, res) => res.json(streamStatus()));

streamRoutes.get("/:id/poster", async (req, res, next) => {
  try {
    const id = req.params.id;
    const thumbnailDir = path.join(config.storageDir, "thumbnails");
    await fs.promises.mkdir(thumbnailDir, { recursive: true });
    const thumbnailPath = path.join(thumbnailDir, `${id}.jpg`);

    // Latar belakang (Fire & Forget): Ambil frame baru dari Go2RTC dan selalu timpa file lokal
    fetch(`http://127.0.0.1:1984/api/frame.jpeg?src=${id}`)
      .then(r => {
        if (r.ok) return r.arrayBuffer();
        throw new Error("HTTP " + r.status);
      })
      .then(buf => fs.promises.writeFile(thumbnailPath, Buffer.from(buf)))
      .catch(() => {}); // Abaikan error jika kamera offline

    // LAZY LOAD: Jika file sudah ada, langsung kirim ke user tanpa menunggu Go2RTC!
    if (fs.existsSync(thumbnailPath)) {
      res.setHeader("Cache-Control", "no-cache");
      res.type("image/jpeg");
      return res.sendFile(thumbnailPath);
    }

    // Jika file belum ada sama sekali, kita coba tunggu maks 2 detik untuk frame pertama
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const go2rtcRes = await fetch(`http://127.0.0.1:1984/api/frame.jpeg?src=${id}`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (go2rtcRes.ok) {
        const buffer = Buffer.from(await go2rtcRes.arrayBuffer());
        fs.promises.writeFile(thumbnailPath, buffer).catch(() => {});
        res.setHeader("Cache-Control", "no-cache");
        res.type("image/jpeg");
        return res.send(buffer);
      }
    } catch (err) {}

    res.status(404).json({ error: "Poster tidak ditemukan" });
  } catch (err) { next(err); }
});

streamRoutes.post("/:id/start", async (req, res, next) => {
  try {
    const output = await getCameraOutput(req.params.id);
    if (output === "MJPEG") {
      const session = await startMjpeg(req.params.id);
      if (!session) return res.status(404).json({ error: "Camera not found" });
      const ready = await waitForMjpegFrame(session);
      if (!ready) {
        const msg = classifyStreamError(session.rawError)?.message
          || "Kamera tidak mengirim frame sebelum batas waktu. Periksa IP, port, path, dan jaringan kamera.";
        await markCameraStatus(req.params.id, { status: "offline" });
        await stopCameraStreams(req.params.id);
        return res.status(504).json({ error: msg });
      }
      return res.json({ ok: true, ready: true, streamUrl: `/api/streams/${req.params.id}/video.mjpg?${segmentQuery(req, output)}`, pid: session.pid });
    }
    recordViewer(req.params.id, viewerId(req), output, viewerDetails(req));
    const session = await startHls(req.params.id, output);
    if (!session) return res.status(404).json({ error: "Camera not found" });
    const q = segmentQuery(req, output);
    const isReady = fs.existsSync(session.playlist) && session.status !== "starting";
    res.json({ ok: true, ready: isReady, streamUrl: `/api/streams/${req.params.id}/index.m3u8?${q}`, pid: session.pid });
  } catch (err) { next(err); }
});

streamRoutes.post("/:id/stop", async (req, res, next) => {
  try { res.json({ stopped: await stopCameraStreams(req.params.id) }); } catch (err) { next(err); }
});

streamRoutes.post("/:id/ping", async (req, res) => {
  try {
    const output = await getCameraOutput(req.params.id);
    recordViewer(req.params.id, viewerId(req), output, viewerDetails(req));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

streamRoutes.post("/:id/leave", async (req, res) => {
  try {
    const { removeViewer } = await import("../stream/streamManager.js");
    removeViewer(req.params.id, viewerId(req));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

streamRoutes.post("/:id/fallback", async (req, res, next) => {
  try {
    const { updateCamera } = await import("../services/cameraService.js");
    await updateCamera(req.params.id, { hlsMode: "transcode" });
    await stopCameraStreams(req.params.id);
    res.json({ ok: true, fallback: "transcode" });
  } catch (err) { next(err); }
});

streamRoutes.get("/:id/video.mjpg", async (req, res, next) => {
  try { await serveMjpeg(req.params.id, res); } catch (err) { next(err); }
});

streamRoutes.get("/:id/index.m3u8", async (req, res, next) => {
  try {
    const output = await getCameraOutput(req.params.id);
    recordViewer(req.params.id, viewerId(req), output, viewerDetails(req));
    const session = await startHls(req.params.id, output);
    if (!session) return res.status(404).send("Camera not found");
    const ready = await waitForPlaylist(session);
    if (!ready) {
      if (!isChildAlive(session.child)) {
        const msg = classifyStreamError(session.rawError)?.message
          || "Gagal memulai stream kamera. Periksa koneksi dan konfigurasi.";
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        return res.status(504).json({ error: msg });
      }
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.type("application/vnd.apple.mpegurl").send("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n");
    }
    await markCameraStatus(req.params.id, { status: "online", lastSeen: new Date().toISOString() });
    if (session.status !== "running") session.status = "running";
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.type("application/vnd.apple.mpegurl");
    const raw = await fs.promises.readFile(session.playlist, "utf8");
    const q = segmentQuery(req, output);
    const rewritten = raw.split("\n").map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      return appendQuery(trimmed, q);
    }).join("\n");
    res.send(rewritten);
  } catch (err) { next(err); }
});

streamRoutes.get("/:id/info", async (req, res, next) => {
  try {
    const camera = await getCamera(req.params.id);
    if (!camera) return res.status(404).json({ error: "Camera not found" });
    res.json({ camera, streams: streamStatus().filter((s) => s.id === req.params.id) });
  } catch (err) { next(err); }
});

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

    const output = await getCameraOutput(id);
    
    // Determine the correct recording directory (unified under record_hls/<id>/)
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
      if (!file.endsWith(".ts")) continue;
      const match = file.match(/seg_(\d+)\.ts/);
      if (!match) continue;
      const ts = parseInt(match[1], 10);
      if (ts >= startUnix && ts <= endUnix) {
        segments.push({ ts });
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
        let duration = targetDuration;
        let isContiguous = false;
        if (i < segments.length - 1) {
          const diff = segments[i + 1].ts - seg.ts;
          if (diff > 0 && diff <= 5) {
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

    const { getSettings } = await import("../services/recordingService.js");
    const settings = await getSettings();
    const segDur = settings.segmentDuration || 5;
    const targetDuration = Math.max(segDur, 6);

    const output = await getCameraOutput(id);
    
    // Determine the correct recording directory (now always in record_hls without output subfolder)
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
      `#EXT-X-TARGETDURATION:${targetDuration}`,
      "#EXT-X-MEDIA-SEQUENCE:0",
    ];

    const q = segmentQuery(req, output);
    for (let i = 0; i < segments.length; i++) {
      const current = segments[i];
      let duration = segDur;
      if (i < segments.length - 1) {
        const diff = segments[i + 1].ts - current.ts;
        if (diff > 0 && diff <= segDur + 1) {
          duration = diff;
        }
      }
      
      if (i > 0 && current.ts - segments[i - 1].ts > segDur + 1) {
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

    const output = await getCameraOutput(id);
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
    const output = await getCameraOutput(req.params.id);
    recordViewer(req.params.id, viewerId(req), output, viewerDetails(req));
    let filePath = getHlsFilePath(req.params.id, output, req.params.file);
    if (!filePath || !fs.existsSync(filePath)) {
      // Fallback to record_hls directory for playback segments
      const recordFilePath = path.join(config.storageDir, "record_hls", req.params.id, req.params.file);
      if (fs.existsSync(recordFilePath) && !req.params.file.includes("..")) {
        filePath = recordFilePath;
      } else {
        return res.status(404).send("Segment not found");
      }
    }
    try {
      const st = fs.statSync(filePath);
      if (st.isFile()) {
        recordCameraTraffic(req.params.id, "out", st.size);
      }
    } catch { /* counted by response middleware if stat unavailable */ }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(filePath);
  } catch (err) { next(err); }
});
