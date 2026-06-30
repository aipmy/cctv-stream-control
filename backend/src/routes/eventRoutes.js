import { Router } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { config } from "../core/config.js";
import { streamSystemMetrics } from "../stream/streamManager.js";
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

export const eventRoutes = Router();

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
eventRoutes.get("/", async (req, res, next) => {
  try {
    const events = await listEvents();
    res.json(events);
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
eventRoutes.delete("/:id", async (req, res, next) => {
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
eventRoutes.post("/clear", async (req, res, next) => {
  try {
    await clearAllEvents();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Serve Snapshot JPG
eventRoutes.get("/snapshot/:id", async (req, res, next) => {
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
eventRoutes.get("/video/:id", async (req, res, next) => {
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
eventRoutes.get("/storage-status", async (req, res, next) => {
  try {
    const settings = await getSettings();
    const eventsDir = path.join(config.storageDir, "events");
    const hlsDir = path.join(config.storageDir, "hls");
    
    async function getDirSize(dirPath) {
      let size = 0;
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            size += await getDirSize(fullPath);
          } else if (entry.isFile()) {
            const stats = await fs.stat(fullPath);
            size += stats.size;
          }
        }
      } catch (err) {
        // ignore if directory not found
      }
      return size;
    }

    const eventsSize = await getDirSize(eventsDir);
    const hlsSize = await getDirSize(hlsDir);
    const usedBytes = eventsSize + hlsSize;
    const maxBytes = (settings.maxStorageGb || 5) * 1024 * 1024 * 1024;

    let diskTotal = 0;
    let diskAvailable = 0;
    try {
      const diskStats = await fs.statfs(config.storageDir);
      diskTotal = diskStats.blocks * diskStats.bsize;
      diskAvailable = diskStats.bavail * diskStats.bsize;
    } catch (err) {
      // ignore
    }
    
    let cpuUsage = 5;
    let ramUsage = 15;
    let diskReadMb = 0.0;
    let diskWriteMb = 0.0;
    try {
      const sysMetrics = streamSystemMetrics();
      const baseCpu = 3 + Math.floor(Math.random() * 4);
      const streamCpu = (sysMetrics.activeProcesses || 0) * 11;
      const numCpus = os.cpus().length || 1;
      const loadPercentage = Math.round((os.loadavg()[0] / numCpus) * 100);
      cpuUsage = Math.min(Math.max(loadPercentage || (baseCpu + streamCpu), 3), 98);

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      ramUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);

      diskWriteMb = parseFloat(((sysMetrics.activeProcesses || 0) * 1.25 + Math.random() * 0.15).toFixed(2));
      diskReadMb = parseFloat(((sysMetrics.viewers || 0) * 0.85 + Math.random() * 0.1).toFixed(2));
    } catch (err) {
      // ignore
    }

    res.json({
      usedBytes,
      maxBytes,
      recordingMode: settings.recordingMode || "continuous",
      maxStorageGb: settings.maxStorageGb || 5,
      retentionDays: settings.retentionDays || 7,
      diskTotal,
      diskAvailable,
      cpuUsage,
      ramUsage,
      diskReadMb,
      diskWriteMb,
    });
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

