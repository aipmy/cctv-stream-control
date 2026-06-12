import { Router } from "express";
import { spawn } from "node:child_process";
import { config } from "../core/config.js";
import { streamStatus } from "../stream/streamManager.js";

export const systemRoutes = Router();

function binVersion(bin, args = ["-version"], timeoutMs = 2500) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c) => { out += c.toString(); });
    child.stderr.on("data", (c) => { err += c.toString(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const firstLine = (out || err).split("\n").find(Boolean) || "";
      resolve({ ok: code === 0, bin, code, version: firstLine });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, bin, error: error.message });
    });
  });
}

systemRoutes.get("/status", async (_req, res, next) => {
  try {
    const [ffmpeg, ffprobe] = await Promise.all([
      binVersion(config.ffmpegBin),
      binVersion(config.ffprobeBin),
    ]);
    res.json({
      ok: true,
      app: "CCTV Monitoring Lite",
      env: config.env,
      auth: config.requireAuth,
      streamProfile: config.streamProfile,
      hlsStartTimeoutMs: config.hlsStartTimeoutMs,
      streamIdleMs: config.streamIdleMs,
      activeStreams: streamStatus(),
      dataDir: config.dataDir,
      storageDir: config.storageDir,
      ffmpeg,
      ffprobe,
      time: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
