import { Router } from "express";
import onvif from "node-onvif";
import { createCamera, deleteCamera, getCamera, listCameras, probeAll, probeCamera, probeTransientCamera, replaceCameras, updateCamera } from "../services/cameraService.js";
import { stopCameraStreams } from "../stream/streamManager.js";
import { clearPtzCache, sendPtzCommand, testPtzConnection } from "../services/ptzService.js";
import { requireRole, requirePermission } from "../middleware/authMiddleware.js";
import { auditRequest, changedFields } from "../modules/audit/auditService.js";
import { probeCameraStream } from "../stream/ffprobeService.js";

export const cameraRoutes = Router();

cameraRoutes.get("/", async (req, res, next) => {
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
    res.json(cameras);
  } catch (err) { next(err); }
});

cameraRoutes.get("/bulk/export", requirePermission("canEditCamera"), async (_req, res, next) => {
  try {
    const cameras = await listCameras({ revealSecret: true });
    res.setHeader("Content-Disposition", `attachment; filename=cameras-${Date.now()}.json`);
    res.json({ exportedAt: new Date().toISOString(), cameras });
  } catch (err) { next(err); }
});

cameraRoutes.post("/bulk/import", requirePermission("canAddCamera"), async (req, res, next) => {
  try {
    const payload = Array.isArray(req.body) ? req.body : req.body?.cameras;
    const mode = req.body?.mode === "append" ? "append" : "replace";
    res.json(await replaceCameras(payload, { mode }));
  } catch (err) { next(err); }
});

cameraRoutes.post("/", requirePermission("canAddCamera"), async (req, res, next) => {
  try {
    if (req.auth?.role !== "admin" && Array.isArray(req.auth?.allowedGroups)) {
      if (!req.auth.allowedGroups.includes(req.body?.site)) {
        return res.status(403).json({ error: "Anda tidak memiliki izin untuk menambah kamera di group ini" });
      }
    }
    const camera = await createCamera(req.body, { revealSecret: true });
    await auditRequest(req, {
      action: "camera.create",
      outcome: "success",
      target: { type: "camera", id: camera.id, label: camera.name },
      details: { site: camera.site, sourceType: camera.sourceType },
    });
    res.status(201).json(camera);

    // Auto-probe in background to populate Smart Profile
    probeCameraStream(camera).then((metadata) => {
      metadata.profileVersion = 1;
      updateCamera(camera.id, { metadata }, { revealSecret: true }).catch(() => {});
    }).catch(() => {});

  } catch (err) {
    await auditRequest(req, {
      action: "camera.create",
      outcome: "failure",
      target: { type: "camera", label: String(req.body?.name || "") },
      details: { error: err?.message || "Gagal membuat kamera" },
    });
    next(err);
  }
});

cameraRoutes.put("/:id", requirePermission("canEditCamera"), async (req, res, next) => {
  try {
    if (req.auth?.role !== "admin" && Array.isArray(req.auth?.allowedGroups)) {
      const existing = await getCamera(req.params.id);
      if (existing && !req.auth.allowedGroups.includes(existing.site)) {
        return res.status(403).json({ error: "Anda tidak memiliki izin untuk mengedit kamera ini" });
      }
      if (req.body?.site && !req.auth.allowedGroups.includes(req.body.site)) {
        return res.status(403).json({ error: "Anda tidak memiliki izin untuk memindahkan kamera ke group ini" });
      }
    }
    const oldCamera = await getCamera(req.params.id, { revealSecret: true });
    const camera = await updateCamera(req.params.id, req.body, { revealSecret: true });
    if (!camera) return res.status(404).json({ error: "Camera not found" });
    clearPtzCache(req.params.id);

    // Determine if stream needs restart based on changed fields
    const streamFields = [
      "streamType", "hlsMode", "streamQuality", "audioMode", "sourcePath",
      "ip", "rtspPort", "rtspTransport", "sourceType", "username", "password",
      "excludeAreas", "smartZones", "motionSensitivity", "aiSensitivity", "motionArea", "detectionModes",
      "enableNotifications", "enableRecording", "detectResolution", "enableSmartDetection"
    ];
    const needsRestart = camera.enabled && oldCamera && streamFields.some(
      (f) => JSON.stringify(oldCamera[f]) !== JSON.stringify(camera[f])
    );

    if (camera.enabled === false) {
      await stopCameraStreams(req.params.id);
    } else if (needsRestart) {
      // Stop and let the next viewer request auto-start with new settings
      await stopCameraStreams(req.params.id);
    }

    await auditRequest(req, {
      action: "camera.update",
      outcome: "success",
      target: { type: "camera", id: camera.id, label: camera.name },
      details: {
        changedFields: changedFields(req.body, [
          "name", "site", "ip", "brand", "enabled", "sourceType", "streamType",
          "rtspTransport", "hlsMode", "rtspPort", "onvifPort", "httpPort",
          "sourcePath", "username", "password", "clearPassword", "enableAudio", "enablePTZ",
        ]),
        streamRestarted: needsRestart || false,
      },
    });
    res.json(camera);

    // Auto-probe in background if RTSP settings likely changed
    if (needsRestart) {
      probeCameraStream(camera).then((metadata) => {
        metadata.profileVersion = (camera.metadata?.profileVersion || 0) + 1;
        updateCamera(camera.id, { metadata }, { revealSecret: true }).catch(() => {});
      }).catch(() => {});
    }

  } catch (err) {
    await auditRequest(req, {
      action: "camera.update",
      outcome: "failure",
      target: { type: "camera", id: req.params.id },
      details: { error: err?.message || "Gagal memperbarui kamera" },
    });
    next(err);
  }
});

cameraRoutes.post("/:id/sync-profile", requirePermission("canEditCamera"), async (req, res, next) => {
  try {
    const camera = await getCamera(req.params.id, { revealSecret: true });
    if (!camera) return res.status(404).json({ error: "Camera not found" });

    // Ensure ffprobeService is imported at the top, we'll do that next
    const { probeCameraStream } = await import("../stream/ffprobeService.js");
    
    const metadata = await probeCameraStream(camera);
    const newVersion = (camera.metadata?.profileVersion || 0) + 1;
    metadata.profileVersion = newVersion;

    const updatedCamera = await updateCamera(req.params.id, { metadata }, { revealSecret: true });
    
    // Stop the stream so the next request spins it up with the new profile
    await stopCameraStreams(req.params.id);

    await auditRequest(req, {
      action: "camera.sync",
      outcome: "success",
      target: { type: "camera", id: camera.id, label: camera.name },
      details: { metadata },
    });

    res.json(updatedCamera);
  } catch (err) {
    await auditRequest(req, {
      action: "camera.sync",
      outcome: "failure",
      target: { type: "camera", id: req.params.id },
      details: { error: err?.message || "Gagal melakukan probing" },
    });
    next(err);
  }
});

cameraRoutes.delete("/:id", requirePermission("canDeleteCamera"), async (req, res, next) => {
  try {
    const camera = await getCamera(req.params.id);
    await stopCameraStreams(req.params.id);
    clearPtzCache(req.params.id);
    const ok = await deleteCamera(req.params.id);
    if (!ok) return res.status(404).json({ error: "Camera not found" });
    await auditRequest(req, {
      action: "camera.delete",
      outcome: "success",
      target: { type: "camera", id: req.params.id, label: camera?.name || null },
    });
    res.status(204).end();
  } catch (err) {
    await auditRequest(req, {
      action: "camera.delete",
      outcome: "failure",
      target: { type: "camera", id: req.params.id },
      details: { error: err?.message || "Gagal menghapus kamera" },
    });
    next(err);
  }
});

cameraRoutes.post("/:id/restart", requirePermission("canRestartStream"), async (req, res, next) => {
  try {
    await stopCameraStreams(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});


cameraRoutes.post("/:id/ptz", requirePermission("canControlPTZ"), async (req, res, next) => {
  let camera = null;
  const action = req.body?.action;
  try {
    camera = await getCamera(req.params.id, { revealSecret: true });
    if (!camera) {
      await auditRequest(req, {
        action: "ptz.command",
        outcome: "failure",
        target: { type: "camera", id: req.params.id },
        details: { command: action || null, error: "Camera not found" },
      });
      return res.status(404).json({ error: "Camera not found" });
    }
    const allowed = ["up", "down", "left", "right", "upLeft", "upRight", "downLeft", "downRight", "home", "zoomIn", "zoomOut", "stop"];
    if (!allowed.includes(action)) {
      await auditRequest(req, {
        action: "ptz.command",
        outcome: "failure",
        target: { type: "camera", id: camera.id, label: camera.name },
        details: { command: action || null, error: "PTZ action tidak valid" },
      });
      return res.status(400).json({ error: "PTZ action tidak valid" });
    }
    const result = await sendPtzCommand(camera, action, { speed: req.body?.speed, duration: req.body?.duration });
    await auditRequest(req, {
      action: "ptz.command",
      outcome: result.warning ? "warning" : "success",
      target: { type: "camera", id: camera.id, label: camera.name },
      details: {
        command: action,
        speed: Number(req.body?.speed || camera.ptzSpeed || process.env.PTZ_SPEED || 0.35),
        duration: result.duration || Number(req.body?.duration || 0) || null,
        mode: result.mode || null,
        warningCode: result.warning?.code || null,
      },
    });
    res.json(result);
  } catch (err) {
    await auditRequest(req, {
      action: "ptz.command",
      outcome: "failure",
      target: { type: "camera", id: req.params.id, label: camera?.name || null },
      details: {
        command: action || null,
        error: err?.message || "PTZ gagal",
      },
    });
    next(err);
  }
});



cameraRoutes.post("/:id/ptz/test", requirePermission("canControlPTZ"), async (req, res, next) => {
  try {
    const camera = await getCamera(req.params.id, { revealSecret: true });
    if (!camera) return res.status(404).json({ error: "Camera not found" });
    res.json(await testPtzConnection(camera));
  } catch (err) { next(err); }
});

cameraRoutes.get("/:id/hardware-info", requirePermission("canViewCamera"), async (req, res, next) => {
  try {
    const camera = await getCamera(req.params.id, { revealSecret: true });
    if (!camera) return res.status(404).json({ error: "Camera not found" });
    if (!camera.ip) return res.status(400).json({ error: "Camera IP is not configured" });

    const port = Number(camera.onvifPort || 80);
    const xaddr = `http://${camera.ip}:${port}/onvif/device_service`;

    const device = new onvif.OnvifDevice({
      xaddr,
      user: camera.username || "",
      pass: camera.password || ""
    });

    await device.init();
    const info = device.getInformation();
    
    if (!info) {
      return res.status(404).json({ error: "No hardware information available" });
    }

    res.json(info);
  } catch (err) {
    const errMsg = err?.message || "Unknown error";
    // Send 400 for typical ONVIF connection failures to prevent 500 clutter
    res.status(400).json({ error: `Gagal mengambil info ONVIF: ${errMsg}` });
  }
});

cameraRoutes.post("/:id/probe", requirePermission("canEditCamera"), async (req, res, next) => {
  try {
    const result = await probeCamera(req.params.id, { deep: req.query.deep === "1" });
    if (!result) return res.status(404).json({ error: "Camera not found" });
    res.json(result);
  } catch (err) { next(err); }
});

cameraRoutes.post("/probe-all", requirePermission("canEditCamera"), async (req, res, next) => {
  try { res.json(await probeAll({ deep: req.query.deep === "1" })); } catch (err) { next(err); }
});

cameraRoutes.post("/probe-test", requirePermission("canEditCamera"), async (req, res, next) => {
  try {
    const result = await probeTransientCamera(req.body);
    res.json(result);
  } catch (err) { next(err); }
});
