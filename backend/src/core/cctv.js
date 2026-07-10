export const DEFAULT_PORTS = {
  RTSP: { primary: 554 },
  "RTSP+ONVIF": { primary: 554, onvif: 80 },
  MJPEG: { primary: 80 },
  HLS: { primary: 443 },
};

export function defaultPath(sourceType) {
  switch (sourceType) {
    case "RTSP":
    case "RTSP+ONVIF":
      return "/Streaming/Channels/101";
    case "MJPEG":
      return "/mjpg/video.mjpg";
    case "HLS":
      return "/live/index.m3u8";
    default:
      return "/";
  }
}

export function normalizePath(p) {
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

export function buildSourceUrl(camera, opts = {}) {
  const includeAuth = opts.includeAuth !== false;
  const maskPassword = Boolean(opts.maskPassword);
  const sourceType = camera.sourceType || "RTSP";
  const path = normalizePath(camera.sourcePath || defaultPath(sourceType));
  const username = camera.username || "";
  const auth = includeAuth && username
    ? `${encodeURIComponent(username)}:${maskPassword ? "••••••" : encodeURIComponent(camera.password || "")}@`
    : "";
  const host = camera.ip || "0.0.0.0";

  if (sourceType === "RTSP" || sourceType === "RTSP+ONVIF") {
    const port = Number(camera.rtspPort || DEFAULT_PORTS[sourceType].primary);
    return `rtsp://${auth}${host}:${port}${path}`;
  }
  if (sourceType === "MJPEG") {
    const port = Number(camera.httpPort || DEFAULT_PORTS.MJPEG.primary);
    return `http://${auth}${host}:${port}${path}`;
  }
  const port = Number(camera.httpPort || DEFAULT_PORTS.HLS.primary);
  const proto = port === 443 ? "https" : "http";
  return `${proto}://${auth}${host}:${port}${path}`;
}

export function buildOnvifUrl(camera) {
  const port = Number(camera.onvifPort || 80);
  return `http://${camera.ip || "0.0.0.0"}:${port}/onvif/device_service`;
}

export function normalizeCamera(input, existing = {}) {
  const id = existing.id || input.id || `cam_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const sourceType = input.sourceType || existing.sourceType || "RTSP+ONVIF";
  const now = new Date().toISOString();
  const password = input.clearPassword === true
    ? ""
    : typeof input.password === "string" && input.password.length > 0
      ? input.password
      : existing.password ?? "";
  const camera = {
    id,
    name: String(input.name ?? existing.name ?? "Camera Baru").trim(),
    site: String(input.site ?? existing.site ?? "Default").trim(),
    ip: String(input.ip ?? existing.ip ?? "").trim(),
    brand: input.brand || existing.brand || "Universal",
    enabled: Boolean(input.enabled ?? existing.enabled ?? true),
    status: ["online", "offline", "starting"].includes(String(input.status ?? existing.status ?? "offline")) ? String(input.status ?? existing.status ?? "offline") : "offline",
    sourceType,
    streamType: input.streamType || existing.streamType || "HLS Stable",
    streamQuality: input.streamQuality || existing.streamQuality || "Auto",
    rtspTransport: ["tcp", "udp", "auto"].includes(String(input.rtspTransport ?? existing.rtspTransport ?? "tcp").toLowerCase())
      ? String(input.rtspTransport ?? existing.rtspTransport ?? "tcp").toLowerCase()
      : "tcp",
    hlsMode: String(input.hlsMode ?? existing.hlsMode ?? "copy").toLowerCase() === "transcode" ? "transcode" : "copy",
    rtspPort: Number(input.rtspPort ?? existing.rtspPort ?? DEFAULT_PORTS[sourceType]?.primary ?? 554),
    onvifPort: Number(input.onvifPort ?? existing.onvifPort ?? 80),
    httpPort: Number(input.httpPort ?? existing.httpPort ?? (sourceType === "HLS" ? 443 : 80)),
    sourcePath: normalizePath(input.sourcePath ?? existing.sourcePath ?? defaultPath(sourceType)),
    username: input.username ?? existing.username ?? "",
    password,
    audioMode: ["Auto", "Enable", "Disable"].includes(input.audioMode ?? existing.audioMode)
      ? (input.audioMode ?? existing.audioMode)
      : (input.enableAudio ?? existing.enableAudio) ? "Enable" : "Auto",
    enableAudio: Boolean(input.enableAudio ?? existing.enableAudio ?? (input.audioMode ?? existing.audioMode) !== "Disable"),
    enablePTZ: Boolean(input.enablePTZ ?? existing.enablePTZ ?? false),
    enableRecording: Boolean(input.enableRecording ?? existing.enableRecording ?? false),
    enableNotifications: Boolean(input.enableNotifications ?? existing.enableNotifications ?? false),
    enableSoundDetection: Boolean(input.enableSoundDetection ?? existing.enableSoundDetection ?? false),
    motionSensitivity: input.motionSensitivity !== undefined
      ? (isNaN(input.motionSensitivity) ? (String(input.motionSensitivity).toLowerCase() === "high" ? 80 : String(input.motionSensitivity).toLowerCase() === "low" ? 20 : 50) : Number(input.motionSensitivity))
      : (existing.motionSensitivity !== undefined ? (isNaN(existing.motionSensitivity) ? (String(existing.motionSensitivity).toLowerCase() === "high" ? 80 : String(existing.motionSensitivity).toLowerCase() === "low" ? 20 : 50) : Number(existing.motionSensitivity)) : 50),
    detectResolution: ["Auto", "1080p", "720p", "480p", "360p", "144p"].includes(input.detectResolution || existing.detectResolution)
      ? (input.detectResolution || existing.detectResolution)
      : "480p",
    detectFps: input.detectFps !== undefined ? Number(input.detectFps) : (existing.detectFps !== undefined ? Number(existing.detectFps) : 6),
    recordingMode: String(input.recordingMode ?? existing.recordingMode ?? "continuous").toLowerCase() === "event" ? "event" : "continuous",
    recordMode: String(input.recordMode ?? existing.recordMode ?? "").toLowerCase() === "transcode" ? "transcode" : (String(input.recordMode ?? existing.recordMode ?? "") === "copy" ? "copy" : ""),
    recordResolution: ["Auto", "1080p", "720p", "480p", "360p", "144p"].includes(input.recordResolution || existing.recordResolution)
      ? (input.recordResolution || existing.recordResolution)
      : "Auto",
    preMotionSeconds: Number(input.preMotionSeconds ?? existing.preMotionSeconds ?? 15),
    postMotionSeconds: Number(input.postMotionSeconds ?? existing.postMotionSeconds ?? 15),
    segmentDuration: Number(input.segmentDuration ?? existing.segmentDuration ?? 5),
    enableAudioRecording: Boolean(input.enableAudioRecording ?? existing.enableAudioRecording ?? true),
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
    qualityProfile: input.qualityProfile || existing.qualityProfile || "Medium",
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
  camera.rtspUrl = buildSourceUrl(camera);
  return camera;
}

export function publicCamera(camera) {
  const { password, ...safe } = camera;
  return {
    ...safe,
    hasPassword: Boolean(password),
    rtspUrl: buildSourceUrl(camera, { maskPassword: true }),
  };
}
