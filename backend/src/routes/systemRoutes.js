import { Router } from "express";
import { requireRole } from "../middleware/authMiddleware.js";
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

systemRoutes.get("/disks", requireRole("admin"), async (_req, res, next) => {
  try {
    const child = spawn("df", ["-hP"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => { out += c.toString(); });
    child.on("close", (code) => {
      if (code !== 0) return res.status(500).json({ error: "Failed to read disks" });
      const lines = out.trim().split("\n").slice(1); // skip header
      const disks = lines.map(line => {
        const parts = line.trim().split(/\s+/);
        // Filesystem, Size, Used, Avail, Use%, Mounted on
        return {
          filesystem: parts[0],
          size: parts[1],
          used: parts[2],
          avail: parts[3],
          usePercentage: parts[4],
          mountPoint: parts.slice(5).join(" "),
        };
      }).filter(d => {
        const fs = d.filesystem;
        const mp = d.mountPoint;
        // Keep real disks, ignore virtual mounts like snap, boot, docker overlaps
        if (fs === "tmpfs" || fs === "devtmpfs" || fs === "overlay" || fs.startsWith("shm")) return false;
        if (mp.startsWith("/run") || mp.startsWith("/sys") || mp.startsWith("/dev") || mp.startsWith("/var/lib/docker") || mp.startsWith("/snap")) return false;
        if (!fs.startsWith("/dev/") && fs !== "c:/") return false;
        return true;
      });
      res.json(disks);
    });
  } catch (err) {
    next(err);
  }
});

systemRoutes.get("/folders", requireRole("admin"), async (req, res, next) => {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const targetPath = req.query.path ? String(req.query.path) : "/";
    
    const entries = await fs.readdir(targetPath, { withFileTypes: true }).catch(() => []);
    const folders = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        folders.push({
          name: entry.name,
          path: path.join(targetPath, entry.name),
        });
      }
    }
    // Sort alphabetically
    folders.sort((a, b) => a.name.localeCompare(b.name));
    
    // Add parent dir option if not at root
    const result = [];
    if (targetPath !== "/" && targetPath !== "") {
      result.push({
        name: "..",
        path: path.dirname(targetPath),
      });
    }
    result.push(...folders);
    
    res.json(result);
  } catch (err) {
    next(err);
  }
});
