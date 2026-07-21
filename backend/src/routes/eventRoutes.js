import { Router } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../core/config.js";
import { getOngoingEventIds } from "../stream/streamManager.js";

const execAsync = promisify(exec);
import {
  listEvents,
  triggerEvent,
  deleteEvent,
  clearAllEvents,
  getSettings,
  updateSettings,
  runStorageCleanup,
  deleteSnapshotFile,
} from "../services/recordingService.js";
import { requirePermission } from "../middleware/authMiddleware.js";

export const eventRoutes = Router();

// Validate event access by user's allowedGroups/sites
eventRoutes.param("id", async (req, res, next, id) => {
  try {
    if (!config.requireAuth) return next();
    if (req.auth?.role === "admin") return next();

    const events = await listEvents();
    const event = events.find(e => e.id === id);
    if (!event) return next(); // Let the route handle 404

    if (Array.isArray(req.auth?.allowedGroups)) {
      if (req.auth.allowedGroups.length > 0 && !req.auth.allowedGroups.includes(event.site)) {
        return res.status(403).json({ error: "Aksi tidak diizinkan untuk akun Anda" });
      }
    }
    return next();
  } catch (err) {
    next(err);
  }
});

// Get settings
eventRoutes.get("/settings", async (req, res, next) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// Update settings
eventRoutes.post("/settings", async (req, res, next) => {
  try {
    const updated = await updateSettings(req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// List events
eventRoutes.get("/", requirePermission("canViewEvents"), async (req, res, next) => {
  try {
    let events = await listEvents();
    if (req.auth?.role !== "admin" && Array.isArray(req.auth?.allowedGroups)) {
      if (req.auth.allowedGroups.length > 0) {
        events = events.filter((evt) => req.auth.allowedGroups.includes(evt.site));
      }
    }
    
    // Add isOngoing flag
    const ongoingIds = new Set(getOngoingEventIds());
    const eventsWithStatus = events.map(evt => ({
      ...evt,
      isOngoing: ongoingIds.has(evt.id)
    }));

    res.json(eventsWithStatus);
  } catch (err) {
    next(err);
  }
});

// Trigger a mock motion or sound event
eventRoutes.post("/trigger", async (req, res, next) => {
  try {
    const { cameraId, type } = req.body;
    if (!cameraId || !type) {
      return res.status(400).json({ error: "cameraId and type are required" });
    }
    if (type !== "motion" && type !== "sound") {
      return res.status(400).json({ error: "type must be 'motion' or 'sound'" });
    }
    const event = await triggerEvent(cameraId, type, { req });
    res.status(201).json(event);
  } catch (err) {
    next(err);
  }
});

// Delete specific event
eventRoutes.delete("/:id", requirePermission("canViewEvents"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await deleteEvent(id);
    if (!deleted) {
      return res.status(404).json({ error: "Event not found" });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Clear all events
eventRoutes.post("/clear", requirePermission("canViewEvents"), async (req, res, next) => {
  try {
    await clearAllEvents();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Serve Snapshot JPG
eventRoutes.get("/snapshot/:id", requirePermission("canViewEvents"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const filePath = path.join(config.storageDir, "events", `${id}.jpg`);
    // Ensure file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: "Snapshot file not found" });
    }
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

// Serve Video MP4 (Supports range requests automatically)
eventRoutes.get("/video/:id", requirePermission("canViewEvents"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const filePath = path.join(config.storageDir, "events", `${id}.mp4`);
    // Ensure file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: "Video file not found" });
    }
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

// Storage Status
// ─── Background storage-status cache ───────────────────────────────
// Precompute heavy stats in background so API responds instantly.
let _storageStatusCache = null;
let _storageStatusUpdating = false;

async function _updateStorageStatusCache() {
  if (_storageStatusUpdating) return;
  _storageStatusUpdating = true;
  try {
    const settings = await getSettings();
    const eventsDir = path.join(config.storageDir, "events");
    const hlsDir = path.join(config.storageDir, "hls");
    const recordHlsDir = path.join(config.storageDir, "record_hls");

    // Use statfs for total storage size — instant, no disk scan
    let diskTotal = 0;
    let diskAvailable = 0;
    try {
      const diskStats = await fs.statfs(config.storageDir);
      diskTotal = diskStats.blocks * diskStats.bsize;
      diskAvailable = diskStats.bavail * diskStats.bsize;
    } catch (_) {}

    // Fast dir size: walk files and sum stat.size (avoids spawning du process)
    async function fastDirSize(dirPath) {
      let total = 0;
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            total += await fastDirSize(fullPath);
          } else {
            try {
              const stat = await fs.stat(fullPath);
              total += stat.size;
            } catch (_) {}
          }
        }
      } catch (_) {}
      return total;
    }

    const [eventsSize, hlsSize, recordHlsSize] = await Promise.all([
      fastDirSize(eventsDir),
      fastDirSize(hlsDir),
      fastDirSize(recordHlsDir),
    ]);
    const usedBytes = eventsSize + hlsSize + recordHlsSize;
    const maxBytes = (settings.maxStorageGb || 5) * 1024 * 1024 * 1024;

    // CPU & RAM — lightweight, no shell commands
    const numCpus = os.cpus().length || 1;
    const loadPercentage = Math.round((os.loadavg()[0] / numCpus) * 100);
    const cpuUsage = Math.min(Math.max(loadPercentage, 3), 98);

    const ramTotal = os.totalmem();
    let freeMem = os.freemem();
    try {
      if (process.platform === "linux") {
        const meminfo = await fs.readFile("/proc/meminfo", "utf8");
        const lines = meminfo.split("\n");
        let memAvailable = 0;
        for (const line of lines) {
          if (line.startsWith("MemAvailable:")) {
            memAvailable = parseInt(line.match(/\d+/)[0], 10) * 1024;
            break;
          }
        }
        if (memAvailable > 0) {
          freeMem = memAvailable;
        } else {
          let memFree = 0, buffers = 0, cached = 0, reclaimable = 0;
          for (const line of lines) {
            if (line.startsWith("MemFree:")) memFree = parseInt(line.match(/\d+/)[0], 10) * 1024;
            else if (line.startsWith("Buffers:")) buffers = parseInt(line.match(/\d+/)[0], 10) * 1024;
            else if (line.startsWith("Cached:")) cached = parseInt(line.match(/\d+/)[0], 10) * 1024;
            else if (line.startsWith("SReclaimable:")) reclaimable = parseInt(line.match(/\d+/)[0], 10) * 1024;
          }
          freeMem = memFree + buffers + cached + reclaimable;
        }
      }
    } catch (_) {}

    const ramFree = freeMem;
    const ramUsed = ramTotal - ramFree;
    const ramUsage = Math.round((ramUsed / ramTotal) * 100);

    _storageStatusCache = {
      usedBytes,
      maxBytes,
      recordingMode: settings.recordingMode || "continuous",
      maxStorageGb: settings.maxStorageGb || 5,
      retentionDays: settings.retentionDays || 7,
      diskTotal,
      diskAvailable,
      cpuUsage,
      ramUsage,
      ramTotal,
      ramFree,
      ramUsed,
      diskReadMb: 0,
      diskWriteMb: 0,
      _ts: Date.now(),
    };
  } catch (err) {
    console.error("[StorageStatus] Background update error:", err.message);
  } finally {
    _storageStatusUpdating = false;
  }
}

// Kick off initial computation + refresh every 30 seconds
void _updateStorageStatusCache();
setInterval(() => void _updateStorageStatusCache(), 30_000);

eventRoutes.get("/storage-status", requirePermission("canViewEvents"), async (req, res, next) => {
  try {
    // If cache not ready yet, compute on-the-fly (only first request)
    if (!_storageStatusCache) {
      await _updateStorageStatusCache();
    }
    res.json(_storageStatusCache || {});
  } catch (err) {
    next(err);
  }
});

// Run storage cleanup manually
eventRoutes.post("/cleanup", async (req, res, next) => {
  try {
    await runStorageCleanup();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Delete specific event snapshot file only
eventRoutes.delete("/:id/snapshot", async (req, res, next) => {
  try {
    const { id } = req.params;
    await deleteSnapshotFile(id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

