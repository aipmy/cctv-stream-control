import fs from "node:fs";
import { Router } from "express";
import { getCamera, markCameraStatus } from "../services/cameraService.js";
import { getHlsFilePath, serveMjpeg, startHls, startMjpeg, stopCameraStreams, streamStatus, waitForPlaylist, waitForMjpegFrame, recordHlsViewer, recordCameraTraffic, isChildAlive } from "../stream/streamManager.js";
import { classifyStreamError } from "../stream/streamError.js";

export const streamRoutes = Router();

function normalizeOutput(q) {
  if (q === "MJPEG" || q === "mjpeg") return "MJPEG";
  return q === "HLS Low Latency" || q === "ll" ? "HLS Low Latency" : "HLS Stable";
}

function viewerId(req) {
  return String(req.query.vid || req.headers["x-cctv-viewer-id"] || `${req.ip}:${req.get("user-agent") || "ua"}`);
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

streamRoutes.post("/:id/start", async (req, res, next) => {
  try {
    const output = normalizeOutput(req.body?.output || req.query.output);
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
    recordHlsViewer(req.params.id, viewerId(req), output);
    const session = await startHls(req.params.id, output);
    if (!session) return res.status(404).json({ error: "Camera not found" });
    // Jangan tahan response sampai playlist ready. Dulu UI langsung menganggap error
    // saat HLS belum sempat membuat segmen, padahal FFmpeg masih warming up.
    const q = segmentQuery(req, output);
    res.json({ ok: true, ready: false, streamUrl: `/api/streams/${req.params.id}/index.m3u8?${q}`, pid: session.pid });
  } catch (err) { next(err); }
});

streamRoutes.post("/:id/stop", async (req, res, next) => {
  try { res.json({ stopped: await stopCameraStreams(req.params.id) }); } catch (err) { next(err); }
});

streamRoutes.get("/:id/video.mjpg", async (req, res, next) => {
  try { await serveMjpeg(req.params.id, res); } catch (err) { next(err); }
});

streamRoutes.get("/:id/index.m3u8", async (req, res, next) => {
  try {
    const output = normalizeOutput(req.query.output);
    recordHlsViewer(req.params.id, viewerId(req), output);
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

streamRoutes.get("/:id/:file", async (req, res, next) => {
  try {
    const output = normalizeOutput(req.query.output);
    recordHlsViewer(req.params.id, viewerId(req), output);
    const filePath = getHlsFilePath(req.params.id, output, req.params.file);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).send("Segment not found");
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

streamRoutes.get("/:id/info", async (req, res, next) => {
  try {
    const camera = await getCamera(req.params.id);
    if (!camera) return res.status(404).json({ error: "Camera not found" });
    res.json({ camera, streams: streamStatus().filter((s) => s.id === req.params.id) });
  } catch (err) { next(err); }
});
