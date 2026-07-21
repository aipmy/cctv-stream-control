import { Router } from "express";
import { listCameras } from "../services/cameraService.js";
import { getLatestTraffic, getTrafficHistory } from "../modules/stats/trafficHistoryService.js";

export const statRoutes = Router();

function enrichCameras(cameras) {
  return cameras.map((camera) => {
    return {
      ...camera,
      status: !camera.enabled ? "offline" : camera.status || "offline",
      viewerCount: camera.viewerCount || 0,
      bandwidthKbps: camera.bandwidthKbps || 0,
      pullBandwidthKbps: camera.pullBandwidthKbps || 0,
      outBytesPerSec: (camera.bandwidthKbps || 0) * 1000 / 8,
      pullBytesPerSec: (camera.pullBandwidthKbps || 0) * 1000 / 8,
      latencyMs: camera.latencyMs || 0,
      activeViewers: camera.activeViewers || [],
    };
  });
}

statRoutes.get("/", async (req, res, next) => {
  try {
    const revealSecret = req.auth?.role === "admin" || req.auth?.role === "teknisi";
    let cameras = await listCameras({ revealSecret });
    if (req.auth?.role !== "admin" && Array.isArray(req.auth?.allowedGroups)) {
      if (req.auth.allowedGroups.length > 0) {
        cameras = cameras.filter((cam) => req.auth.allowedGroups.includes(cam.site));
      } else {
        cameras = [];
      }
    }
    const enriched = enrichCameras(cameras);
    const totals = enriched.reduce((acc, c) => {
      acc.total++;
      if (c.enabled) {
        acc.enabled++;
        if (c.status === "online") acc.online++;
        else if (c.status === "starting") acc.starting++;
        else if (c.status === "offline") acc.offline++;
        
        if (c.viewerCount > 0) acc.streaming++;
        
        acc.viewers += (c.viewerCount || 0);
        acc.bandwidthKbps += (c.bandwidthKbps || 0);
        acc.pullBandwidthKbps += (c.pullBandwidthKbps || 0);
      } else {
        acc.disabled++;
      }
      return acc;
    }, {
      total: 0, enabled: 0, disabled: 0, online: 0, starting: 0,
      offline: 0, streaming: 0, viewers: 0, bandwidthKbps: 0, pullBandwidthKbps: 0
    });

    const traffic = getLatestTraffic();
    res.json({
      cameras: enriched,
      traffic,
      totals,
    });
  } catch (err) { next(err); }
});

statRoutes.get("/traffic", async (_req, res, next) => {
  try { res.json(getLatestTraffic()); } catch (err) { next(err); }
});

statRoutes.get("/traffic/history", async (req, res, next) => {
  try { res.json(getTrafficHistory(req.query.range)); } catch (err) { next(err); }
});
