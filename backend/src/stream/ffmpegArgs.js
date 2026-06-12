import path from "node:path";
import { buildSourceUrl } from "../core/cctv.js";

export function normalizeRtspTransport(value, options = {}) {
  const normalized = String(value || options.rtspTransport || "tcp").toLowerCase();
  return ["tcp", "udp", "auto"].includes(normalized) ? normalized : "tcp";
}

export function normalizeHlsMode(value, options = {}) {
  const normalized = String(value || options.streamProfile || "copy").toLowerCase();
  return normalized === "transcode" ? "transcode" : "copy";
}

export function normalizeRtspTimeoutOption(value, options = {}) {
  const normalized = String(value || options.rtspTimeoutOption || "none").toLowerCase();
  return ["none", "rw_timeout", "stimeout", "timeout"].includes(normalized)
    ? normalized
    : "none";
}

export function buildRtspInputArgs(camera, options = {}) {
  if (camera.sourceType !== "RTSP" && camera.sourceType !== "RTSP+ONVIF") return [];
  const transport = normalizeRtspTransport(camera.rtspTransport, options);
  const args = [];
  if (transport !== "auto") args.push("-rtsp_transport", transport);

  const timeoutOption = normalizeRtspTimeoutOption(camera.rtspTimeoutOption, options);
  const timeoutUs = Number(camera.streamReadTimeoutUs || options.streamReadTimeoutUs || 0);
  if (timeoutOption !== "none" && timeoutUs > 0) {
    args.push(`-${timeoutOption}`, String(timeoutUs));
  }
  return args;
}

function audioArgs(camera) {
  return camera.enableAudio
    ? ["-map", "0:a?", "-c:a", "aac", "-ar", "44100", "-b:a", "96k", "-ac", "1"]
    : ["-an"];
}

function copyHlsArgs(camera, output, dir, options) {
  const source = buildSourceUrl(camera);
  const isRtsp = camera.sourceType === "RTSP" || camera.sourceType === "RTSP+ONVIF";
  return [
    "-hide_banner", "-nostdin",
    "-fflags", "nobuffer+genpts+discardcorrupt",
    "-loglevel", options.ffmpegLogLevel || "warning",
    ...(isRtsp ? ["-use_wallclock_as_timestamps", "1"] : []),
    ...buildRtspInputArgs(camera, options),
    "-i", source,
    "-map", "0:v:0",
    "-vsync", "0",
    "-vcodec", "copy",
    ...audioArgs(camera),
    "-hls_flags", "delete_segments+omit_endlist+independent_segments+temp_file",
    "-f", "hls",
    "-hls_time", "1",
    "-hls_list_size", "3",
    "-hls_segment_type", "mpegts",
    "-hls_segment_filename", path.join(dir, "%d.ts"),
    path.join(dir, "index.m3u8"),
  ];
}

function transcodeHlsArgs(camera, output, dir, options) {
  const source = buildSourceUrl(camera);
  const lowLatency = output === "HLS Low Latency";
  const hlsTime = lowLatency ? "1" : "2";
  const hlsListSize = lowLatency ? "4" : "8";
  const fps = lowLatency ? "12" : "10";
  const gop = String(Number(fps) * Number(hlsTime));
  const isRtsp = camera.sourceType === "RTSP" || camera.sourceType === "RTSP+ONVIF";

  return [
    "-hide_banner", "-nostdin",
    "-fflags", "nobuffer+genpts+discardcorrupt",
    "-flags", "low_delay",
    "-loglevel", options.ffmpegLogLevel || "warning",
    ...(isRtsp ? ["-use_wallclock_as_timestamps", "1"] : []),
    ...buildRtspInputArgs(camera, options),
    "-i", source,
    "-map", "0:v:0",
    "-c:v", "libx264",
    "-preset", lowLatency ? "ultrafast" : "veryfast",
    "-tune", "zerolatency",
    "-profile:v", "baseline",
    "-pix_fmt", "yuv420p",
    "-r", fps,
    "-g", gop,
    "-keyint_min", gop,
    "-sc_threshold", "0",
    "-b:v", lowLatency ? "1100k" : "900k",
    "-maxrate", lowLatency ? "1400k" : "1200k",
    "-bufsize", lowLatency ? "2200k" : "1800k",
    ...audioArgs(camera),
    "-f", "hls",
    "-hls_time", hlsTime,
    "-hls_list_size", hlsListSize,
    "-hls_delete_threshold", "2",
    "-hls_flags", "delete_segments+omit_endlist+program_date_time+independent_segments+temp_file",
    "-hls_allow_cache", "0",
    "-hls_segment_type", "mpegts",
    "-hls_segment_filename", path.join(dir, "seg_%06d.ts"),
    path.join(dir, "index.m3u8"),
  ];
}

export function buildHlsArgs({ camera, output, dir, options = {} }) {
  return normalizeHlsMode(camera.hlsMode, options) === "transcode"
    ? transcodeHlsArgs(camera, output, dir, options)
    : copyHlsArgs(camera, output, dir, options);
}
