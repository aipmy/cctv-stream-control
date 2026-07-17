export const DEFAULT_PORTS = {
  ONVIF: 80,
  RTSP: 554,
  DVRIP: 34567,
  HomeAssistant: 0,
  Custom: 0,
};

export function buildStreamUrl(camera, opts = {}) {
  const includeAuth = opts.includeAuth !== false;
  const maskPassword = Boolean(opts.maskPassword);
  const sourceType = camera.sourceType || "ONVIF";
  const host = camera.ip || "0.0.0.0";
  const port = Number(camera.port || DEFAULT_PORTS[sourceType] || 80);
  const username = camera.username || "";
  const auth = includeAuth && username
    ? `${encodeURIComponent(username)}:${maskPassword ? "••••••" : encodeURIComponent(camera.password || "")}@`
    : "";

  switch (sourceType) {
    case "ONVIF": {
      return `onvif://${auth}${host}:${port}`;
    }
    case "RTSP": {
      const path = camera.streamPath || "/Streaming/Channels/101";
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      return `rtsp://${auth}${host}:${port}${normalizedPath}`;
    }
    case "DVRIP": {
      return `dvrip://${auth}${host}:${port}`;
    }
    case "HomeAssistant": {
      return `homeassistant://${auth}${host}`;
    }
    case "Custom": {
      return camera.customUrl || "";
    }
    default: {
      return `rtsp://${auth}${host}:${port}`;
    }
  }
}

export function buildOnvifUrl(camera) {
  const port = Number(camera.port || 80);
  return `http://${camera.ip || "0.0.0.0"}:${port}/onvif/device_service`;
}

/**
 * Migrate old sourceType to new sourceType.
 */
function migrateSourceType(oldType) {
  switch (oldType) {
    case "RTSP+ONVIF": return "ONVIF";
    case "RTSP": return "RTSP";
    case "MJPEG": return "Custom";
    case "HLS": return "Custom";
    case "GO2RTC": return "Custom";
    case "ONVIF": return "ONVIF";
    case "DVRIP": return "DVRIP";
    case "HomeAssistant": return "HomeAssistant";
    case "Custom": return "Custom";
    default: return "ONVIF";
  }
}

/**
 * Determine port from old camera data during migration.
 */
function migratePort(camera) {
  const st = camera.sourceType;
  if (st === "RTSP+ONVIF" || st === "ONVIF") {
    return Number(camera.onvifPort || camera.port || 80);
  }
  if (st === "RTSP") {
    return Number(camera.rtspPort || camera.port || 554);
  }
  if (st === "DVRIP") {
    return Number(camera.port || 34567);
  }
  return Number(camera.httpPort || camera.port || 80);
}

export function normalizeCamera(input, existing = {}) {
  const id = existing.id || input.id || `cam_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  // Migrate sourceType from old schema
  const rawSourceType = input.sourceType || existing.sourceType || "ONVIF";
  const sourceType = migrateSourceType(rawSourceType);

  // Migrate port from old schema
  const port = input.port !== undefined
    ? Number(input.port)
    : existing.port !== undefined
      ? Number(existing.port)
      : migratePort({ ...existing, ...input, sourceType: rawSourceType });

  const password = input.clearPassword === true
    ? ""
    : typeof input.password === "string" && input.password.length > 0
      ? input.password
      : existing.password ?? "";

  // For Custom sourceType, use customUrl; for old GO2RTC/MJPEG/HLS migrations, use sourcePath
  let customUrl = input.customUrl ?? existing.customUrl ?? "";
  if (!customUrl && sourceType === "Custom") {
    // Migrate from old schema: sourcePath or rtspUrl might contain the custom URL
    customUrl = input.sourcePath ?? existing.sourcePath ?? existing.rtspUrl ?? "";
  }

  // For RTSP, keep streamPath
  let streamPath = input.streamPath ?? existing.streamPath ?? "";
  if (!streamPath && sourceType === "RTSP") {
    streamPath = input.sourcePath ?? existing.sourcePath ?? "/Streaming/Channels/101";
  }

  const camera = {
    id,
    name: String(input.name ?? existing.name ?? "Camera Baru").trim(),
    site: String(input.site ?? existing.site ?? "Default").trim(),
    ip: String(input.ip ?? existing.ip ?? "").trim(),
    port,
    brand: input.brand || existing.brand || "Universal",
    enabled: Boolean(input.enabled ?? existing.enabled ?? true),
    status: ["online", "offline", "starting"].includes(String(input.status ?? existing.status ?? "offline"))
      ? String(input.status ?? existing.status ?? "offline")
      : "offline",
    sourceType,
    streamType: input.streamType || existing.streamType || "mse",
    streamPath: sourceType === "RTSP" ? streamPath : undefined,
    customUrl: sourceType === "Custom" ? customUrl : undefined,
    username: input.username ?? existing.username ?? "",
    password,
    audioMode: ["Auto", "Enable", "Disable"].includes(input.audioMode ?? existing.audioMode)
      ? (input.audioMode ?? existing.audioMode)
      : (input.enableAudio ?? existing.enableAudio) ? "Enable" : "Auto",
    enablePTZ: Boolean(input.enablePTZ ?? existing.enablePTZ ?? false),
    enableRecording: Boolean(input.enableRecording ?? existing.enableRecording ?? false),
    enableNotifications: Boolean(input.enableNotifications ?? existing.enableNotifications ?? false),
    enableSmartDetection: input.enableSmartDetection ?? existing.enableSmartDetection ?? undefined,
    enableSoundDetection: Boolean(input.enableSoundDetection ?? existing.enableSoundDetection ?? false),
    motionSensitivity: input.motionSensitivity !== undefined
      ? Number(input.motionSensitivity)
      : existing.motionSensitivity !== undefined
        ? Number(existing.motionSensitivity)
        : 50,
    detectResolution: ["Auto", "1080p", "720p", "480p", "360p", "144p"].includes(input.detectResolution || existing.detectResolution)
      ? (input.detectResolution || existing.detectResolution)
      : "480p",
    detectFps: input.detectFps !== undefined ? Number(input.detectFps) : (existing.detectFps !== undefined ? Number(existing.detectFps) : 6),
    recordingMode: String(input.recordingMode ?? existing.recordingMode ?? "continuous").toLowerCase() === "event" ? "event" : "continuous",
    recordMode: String(input.recordMode ?? existing.recordMode ?? "").toLowerCase() === "transcode" ? "transcode" : (String(input.recordMode ?? existing.recordMode ?? "") === "copy" ? "copy" : ""),
    recordResolution: ["Auto", "1080p", "720p", "480p", "360p", "144p"].includes(input.recordResolution || existing.recordResolution)
      ? (input.recordResolution || existing.recordResolution)
      : "Auto",
    motionArea: input.motionArea !== undefined
      ? (input.motionArea && typeof input.motionArea === "object"
        ? {
            x: Number(input.motionArea.x ?? 0),
            y: Number(input.motionArea.y ?? 0),
            w: Number(input.motionArea.w ?? 1),
            h: Number(input.motionArea.h ?? 1),
          }
        : null)
      : (existing.motionArea ?? null),
    lastSeen: input.lastSeen || existing.lastSeen || now,
    viewerCount: Number(input.viewerCount ?? existing.viewerCount ?? 0),
    bandwidthKbps: Number(input.bandwidthKbps ?? existing.bandwidthKbps ?? 0),
    latencyMs: Number(input.latencyMs ?? existing.latencyMs ?? 0),
    errorHistory: Array.isArray(input.errorHistory) ? input.errorHistory : Array.isArray(existing.errorHistory) ? existing.errorHistory : [],
    excludeAreas: Array.isArray(input.excludeAreas)
      ? input.excludeAreas.map((area) => {
          if (area.type === "polygon") {
            return {
              type: "polygon",
              points: Array.isArray(area.points)
                ? area.points.map((p) => ({ x: Number(p.x ?? 0), y: Number(p.y ?? 0) }))
                : [],
              enabled: area.enabled !== false,
              name: String(area.name || "Polygon"),
            };
          }
          return {
            type: "rect",
            x: Number(area.x ?? 0),
            y: Number(area.y ?? 0),
            w: Number(area.w ?? 1),
            h: Number(area.h ?? 1),
            enabled: area.enabled !== false,
            name: String(area.name || "Kotak"),
          };
        })
      : Array.isArray(existing.excludeAreas)
        ? existing.excludeAreas
        : [],
    detectionModes: Array.isArray(input.detectionModes)
      ? input.detectionModes.map(String)
      : Array.isArray(existing.detectionModes)
        ? existing.detectionModes
        : ["pixel", "human", "pet"],
    aiSensitivity: input.aiSensitivity !== undefined
      ? Number(input.aiSensitivity)
      : existing.aiSensitivity !== undefined
        ? Number(existing.aiSensitivity)
        : 50,
  };

  if (!camera.enabled) camera.status = "offline";

  // Build the final go2rtc stream URL
  camera.streamUrl = buildStreamUrl(camera);
  return camera;
}

export function publicCamera(camera) {
  const { password, ...safe } = camera;
  return {
    ...safe,
    hasPassword: Boolean(password),
    streamUrl: buildStreamUrl(camera, { maskPassword: true }),
  };
}
