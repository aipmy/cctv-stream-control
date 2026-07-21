import { config } from "../core/config.js";

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
  // Selalu tarik dari go2rtc (sebagai proxy lokal) agar kamera hanya menerima 1 koneksi
  return [
    "-rtsp_transport", "tcp",
    "-stimeout", "5000000",
    "-i", `rtsp://127.0.0.1:${config.go2rtcRtspPort || 8554}/${camera.id}`
  ];
}

export function buildHlsArgs(camera, outputType) {
  return [
    "-c:v", "copy",
    "-c:a", "copy",
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "3",
    "-hls_flags", "delete_segments"
  ];
}
