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
    const enabled = enriched.filter((c) => c.enabled).length;
    const disabled = enriched.length - enabled;
    const online = enriched.filter((c) => c.enabled && c.status === "online").length;
    const starting = enriched.filter((c) => c.enabled && c.status === "starting").length;
    const traffic = getLatestTraffic();
    res.json({
      cameras: enriched,
      traffic,
      totals: {
        total: enriched.length,
        enabled,
        disabled,
        online,
        starting,
        offline: enriched.filter((c) => c.enabled && c.status === "offline").length,
        streaming: enriched.filter((c) => c.enabled && c.viewerCount > 0).length,
        viewers: enriched.reduce((a, c) => a + c.viewerCount, 0),
        bandwidthKbps: enriched.reduce((a, c) => a + c.bandwidthKbps, 0),
        pullBandwidthKbps: enriched.reduce((a, c) => a + (c.pullBandwidthKbps || 0), 0),
      },
    });
  } catch (err) { next(err); }
});

statRoutes.get("/traffic", async (_req, res, next) => {
  try { res.json(getLatestTraffic()); } catch (err) { next(err); }
});

statRoutes.get("/traffic/history", async (req, res, next) => {
  try { res.json(getTrafficHistory(req.query.range)); } catch (err) { next(err); }
});
