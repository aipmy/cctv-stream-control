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
    const mountChild = spawn("mount", [], { stdio: ["ignore", "pipe", "pipe"] });
    let mountOut = "";
    mountChild.stdout.on("data", (c) => { mountOut += c.toString(); });
    mountChild.on("close", () => {
      const mountMap = {};
      const mountLines = mountOut.trim().split("\n");
      for (const line of mountLines) {
        // Mac: /dev/disk on / (apfs, sealed, local, read-only)
        // Linux: /dev/root on / type ext4 (rw,relatime)
        const matchLinux = line.match(/^(.+) on (.+) type ([^\s]+) \((.+)\)/);
        const matchMac = line.match(/^(.+) on (.+) \(([^,]+)(.*?)\)/);
        
        if (matchLinux) {
          mountMap[matchLinux[2]] = { 
            type: matchLinux[3].toUpperCase(), 
            isReadOnly: matchLinux[4].includes("ro,") || matchLinux[4].startsWith("ro")
          };
        } else if (matchMac) {
          mountMap[matchMac[2]] = { 
            type: matchMac[3].toUpperCase(), 
            isReadOnly: matchMac[4].includes("read-only")
          };
        }
      }

      const child = spawn("df", ["-Pk"], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (c) => { out += c.toString(); });
      child.on("close", (code) => {
        if (code !== 0) return res.status(500).json({ error: "Failed to read disks" });
      
      const formatSize = (kb) => {
        if (!kb || isNaN(kb)) return "0 B";
        const bytes = parseInt(kb) * 1024;
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
      };

      const lines = out.trim().split("\n").slice(1); // skip header
      const disks = lines.map(line => {
        const parts = line.trim().split(/\s+/);
        const mountPoint = parts.slice(5).join(" ");
        const mountInfo = mountMap[mountPoint] || { type: "UNKNOWN", isReadOnly: false };
        return {
          filesystem: parts[0],
          size: formatSize(parts[1]),
          used: formatSize(parts[2]),
          avail: formatSize(parts[3]),
          usePercentage: parts[4],
          mountPoint: mountPoint,
          formatType: mountInfo.type,
          isReadOnly: mountInfo.isReadOnly,
        };
      }).filter(d => {
        const fs = d.filesystem;
        const mp = d.mountPoint;
        // Keep real disks, ignore virtual mounts like snap, boot, docker overlaps
        if (fs === "tmpfs" || fs === "devtmpfs" || fs === "overlay" || fs.startsWith("shm")) return false;
        if (mp.startsWith("/run") || mp.startsWith("/sys") || mp.startsWith("/dev") || mp.startsWith("/var/lib/docker") || mp.startsWith("/snap")) return false;
        if (mp.startsWith("/System/") || mp === "/private/var/vm") return false; // Hide macOS specific system partitions
        if (!fs.startsWith("/dev/") && fs !== "c:/") return false;
        return true;
      });
      res.json(disks);
    });
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
