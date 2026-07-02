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
  
  // SELALU gunakan wallclock untuk memperbaiki timestamp PTS yang rusak dari kamera (time=-27:30 dsb)
  // Ini mencegah HLS player menolak memutar stream karena timestamp negatif
  args.push("-use_wallclock_as_timestamps", "1");

  const timeoutOption = normalizeRtspTimeoutOption(camera.rtspTimeoutOption, options);
  const timeoutUs = Number(camera.streamReadTimeoutUs || options.streamReadTimeoutUs || 0);
  if (timeoutOption !== "none" && timeoutUs > 0) {
    args.push(`-${timeoutOption}`, String(timeoutUs));
  }
  return args;
}

function audioArgs(camera, audioFallback) {
  if (camera.audioMode === "Disable") return ["-an"];
  if (camera.audioMode === "Auto" && audioFallback) return ["-an"];
  // Transcode to AAC if possible, or fallback to -an if Auto and failed
  // Menambahkan volume=3.0 untuk mengamplifikasi suara mikrofon CCTV yang aslinya sangat kecil
  return ["-map", "0:a?", "-c:a", "aac", "-ar", "44100", "-b:a", "128k", "-ac", "2", "-af", "volume=3.0,aresample=async=1"];
}

function copyHlsArgs(camera, output, dir, options, audioFallback) {
  const source = buildSourceUrl(camera);
  const isRtsp = camera.sourceType === "RTSP" || camera.sourceType === "RTSP+ONVIF";
  const flags = ["omit_endlist", "independent_segments", "temp_file"];
  if (!camera.enableRecording) {
    flags.push("delete_segments");
  }

  const detectFps = options.mjpegFps || 8;
  const detectWidth = options.mjpegWidth || 640;
  const detectFilter = `fps=${detectFps},scale=${detectWidth}:-2`;

  return [
    "-hide_banner", "-nostdin",
    "-fflags", "nobuffer+genpts",
    "-loglevel", options.ffmpegLogLevel || "warning",

    ...buildRtspInputArgs(camera, options),
    "-i", source,
    "-filter_complex", `[0:v:0]${detectFilter}[vdetout]`,
    "-map", "0:v:0",
    "-vsync", "0",
    "-vcodec", "copy",
    ...audioArgs(camera, audioFallback),
    "-hls_flags", flags.join("+"),
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "20",
    "-hls_delete_threshold", "3",
    "-hls_segment_type", "mpegts",
    ...(camera.enableRecording ? ["-strftime", "1", "-hls_segment_filename", path.join(dir, "seg_%s.ts")] : ["-hls_segment_filename", path.join(dir, "%d.ts")]),
    path.join(dir, "index.m3u8"),
    "-map", "[vdetout]",
    "-an",
    "-vcodec", "mjpeg",
    "-q:v", String(options.mjpegQuality || 7),
    "-f", "image2pipe",
    "pipe:1",
  ];
}

function videoScaleArgs(camera) {
  if (!camera.streamQuality || camera.streamQuality === "Auto") return [];
  const match = camera.streamQuality.match(/^(\d+)p$/);
  if (match) {
    return ["-vf", `scale=-2:${match[1]}`];
  }
  return [];
}

function transcodeHlsArgs(camera, output, dir, options, audioFallback) {
  const source = buildSourceUrl(camera);
  const lowLatency = output === "HLS Low Latency";
  const hlsTime = lowLatency ? "1" : "2";
  
  // Cek apakah ini sub-stream (resolusi kecil, misal channel 102)
  const isSubStream = camera.sourcePath && (camera.sourcePath.includes("102") || camera.sourcePath.includes("sub"));
  
  // Jika streamQuality = Auto, pertahankan FPS dan bitrate tinggi setara sumber aslinya
  const isAuto = !camera.streamQuality || camera.streamQuality === "Auto";
  const fps = isAuto ? "20" : (lowLatency ? "15" : "12");
  const gop = String(Number(fps) * Number(hlsTime));
  const isRtsp = camera.sourceType === "RTSP" || camera.sourceType === "RTSP+ONVIF";

  const flags = ["omit_endlist", "program_date_time", "independent_segments", "temp_file"];
  if (!camera.enableRecording) {
    flags.push("delete_segments");
  }

  const detectFps = options.mjpegFps || 8;
  const detectWidth = options.mjpegWidth || 640;
  const detectFilter = `fps=${detectFps},scale=${detectWidth}:-2`;
  const scaleFilter = !isAuto
    ? `,scale=-2:${camera.streamQuality.replace("p", "")}`
    : "";
  
  // Jangan turunkan fps jika source asli fpsnya sama, biarkan natural dengan framerate drop filter
  const hlsFilter = `fps=${fps}${scaleFilter}`;

  // Sesuaikan bitrate jika ini sub-stream agar tidak melanggar limit H.264 Level
  const autoBitrate = isSubStream ? "1000k" : "5000k";
  const autoMaxrate = isSubStream ? "1500k" : "6000k";
  const autoBufsize = isSubStream ? "2000k" : "12000k";

  const bitrate = isAuto ? autoBitrate : (lowLatency ? "2500k" : "3000k");
  const maxrate = isAuto ? autoMaxrate : (lowLatency ? "3500k" : "4000k");
  const bufsize = isAuto ? autoBufsize : (lowLatency ? "5000k" : "8000k");

  return [
    "-hide_banner", "-nostdin",
    "-fflags", "nobuffer+genpts",
    ...(lowLatency ? ["-flags", "low_delay"] : []),
    "-loglevel", options.ffmpegLogLevel || "warning",

    ...buildRtspInputArgs(camera, options),
    "-i", source,
    "-filter_complex", `[0:v:0]split=2[vhls][vdet];[vhls]${hlsFilter}[vhlsout];[vdet]${detectFilter}[vdetout]`,
    "-map", "[vhlsout]",
    "-c:v", options.videoEncoder || "libx264",
    ...(((options.videoEncoder || "libx264") === "libx264") ? [
      "-preset", lowLatency ? "ultrafast" : "veryfast",
      "-tune", "zerolatency",
      "-profile:v", "baseline",
      "-pix_fmt", "yuv420p",
    ] : [
      // Hardware encoder optimizations (e.g. h264_videotoolbox)
      "-profile:v", isSubStream ? "main" : "high",
      "-pix_fmt", "yuv420p",
    ]),
    "-vsync", "1",
    "-r", fps,
    "-g", gop,
    "-keyint_min", gop,
    "-sc_threshold", "0",
    "-force_key_frames", `expr:gte(t,n_forced*${hlsTime})`,
    "-b:v", bitrate,
    "-maxrate", maxrate,
    "-bufsize", bufsize,
    ...audioArgs(camera, audioFallback),
    "-f", "hls",
    "-hls_time", hlsTime,
    "-hls_list_size", lowLatency ? "20" : "15",
    "-hls_delete_threshold", "2",
    "-hls_flags", flags.join("+"),
    "-hls_allow_cache", "0",
    "-hls_segment_type", "mpegts",
    ...(camera.enableRecording ? ["-strftime", "1", "-hls_segment_filename", path.join(dir, "seg_%s.ts")] : ["-hls_segment_filename", path.join(dir, "seg_%06d.ts")]),
    path.join(dir, "index.m3u8"),
    "-map", "[vdetout]",
    "-an",
    "-vcodec", "mjpeg",
    "-q:v", String(options.mjpegQuality || 7),
    "-f", "image2pipe",
    "pipe:1",
  ];
}

export function buildHlsArgs({ camera, output, dir, options = {}, audioFallback = false }) {
  const needsTranscode = normalizeHlsMode(camera.hlsMode, options) === "transcode" || 
                         (camera.streamQuality && camera.streamQuality !== "Auto");
  return needsTranscode
    ? transcodeHlsArgs(camera, output, dir, options, audioFallback)
    : copyHlsArgs(camera, output, dir, options, audioFallback);
}
