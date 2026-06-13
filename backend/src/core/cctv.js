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
    lastSeen: input.lastSeen || existing.lastSeen || now,
    viewerCount: Number(input.viewerCount ?? existing.viewerCount ?? 0),
    bandwidthKbps: Number(input.bandwidthKbps ?? existing.bandwidthKbps ?? 0),
    latencyMs: Number(input.latencyMs ?? existing.latencyMs ?? 0),
    qualityProfile: input.qualityProfile || existing.qualityProfile || "Medium",
    errorHistory: Array.isArray(input.errorHistory) ? input.errorHistory : Array.isArray(existing.errorHistory) ? existing.errorHistory : [],
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
