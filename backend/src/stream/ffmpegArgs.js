export function normalizeRtspTransport(t) {
  return "tcp";
}

export function normalizeRtspTimeoutOption(st) {
  return "-stimeout";
}

export function normalizeHlsMode(m) {
  return "copy";
}

export function buildRtspInputArgs(camera) {
  return [
    "-rtsp_transport", "tcp",
    "-stimeout", "5000000",
    "-i", camera.streamUrl || `rtsp://127.0.0.1:8554/${camera.id}`
  ];
}

export function buildHlsArgs(camera, outputType) {
  return [
    "-c:v", "copy",
    "-c:a", "aac",
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "3",
    "-hls_flags", "delete_segments"
  ];
}
