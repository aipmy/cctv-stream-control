import path from "node:path";
import { buildSourceUrl } from "../core/cctv.js";

// ============================================================================
// UNIVERSAL TRANSCODE ENGINE
// ============================================================================
// All cameras are forced to: TCP transport, H264 (libx264) video, AAC audio.
// This eliminates all codec compatibility issues and makes the system
// completely automatic — users never need to configure codecs manually.
// ============================================================================

export function normalizeRtspTransport() {
  // Always use TCP — more reliable over WiFi/routed networks
  return "tcp";
}

export function normalizeHlsMode() {
  // Always transcode — fixes timestamp issues, codec incompatibility,
  // and produces clean H264+AAC output universally
  return "transcode";
}

export function normalizeRtspTimeoutOption(value, options = {}) {
  const normalized = String(value || options.rtspTimeoutOption || "none").toLowerCase();
  return ["none", "rw_timeout", "stimeout", "timeout"].includes(normalized)
    ? normalized
    : "none";
}

export function buildRtspInputArgs(camera, options = {}) {
  if (camera.sourceType !== "RTSP" && camera.sourceType !== "RTSP+ONVIF") return [];

  const args = [
    "-rtsp_transport", "tcp",
    "-use_wallclock_as_timestamps", "1",
    // Give slow cameras more time to respond before giving up
    "-analyzeduration", "5000000",
    "-probesize", "5000000",
  ];

  // Timeout for reading from the RTSP source
  const timeoutOption = normalizeRtspTimeoutOption(camera.rtspTimeoutOption, options);
  const timeoutUs = Number(camera.streamReadTimeoutUs || options.streamReadTimeoutUs || 0);
  if (timeoutOption !== "none" && timeoutUs > 0) {
    args.push(`-${timeoutOption}`, String(timeoutUs));
  }

  return args;
}

function isAudioEnabled(camera, audioFallback) {
  if (camera.audioMode === "Disable") return false;
  if (camera.audioMode === "Auto" && audioFallback) return false;
  return true;
}

export function buildHlsArgs({ camera, output, dir, recordDir, options = {}, audioFallback = false }) {
  const source = buildSourceUrl(camera);
  const lowLatency = output === "HLS Low Latency";
  const hlsTime = lowLatency ? "1" : "2";
  const isSubStream = camera.sourcePath && (camera.sourcePath.includes("102") || camera.sourcePath.includes("sub"));

  // Video settings - optimized bitrates to prevent network congestion & freezing
  const fps = lowLatency ? "15" : "15";
  const gop = String(Number(fps) * Number(hlsTime));
  
  // Reduce bitrates (1080p main stream uses 1500k instead of 4000k)
  const bitrate = isSubStream ? "600k" : "1500k";
  const maxrate = isSubStream ? "800k" : "2000k";
  const bufsize = isSubStream ? "1200k" : "3000k";

  // Detection settings
  const detectFps = (camera.detectFps !== undefined && camera.detectFps > 0) ? camera.detectFps : (options.mjpegFps || 8);
  const resMap = { "1080p": 1920, "720p": 1280, "480p": 854, "360p": 640, "144p": 256 };
  const detectWidth = (camera.detectResolution && camera.detectResolution !== "Auto" && resMap[camera.detectResolution]) ? resMap[camera.detectResolution] : (options.mjpegWidth || 640);
  const detectFilter = `fps=${detectFps},scale=${detectWidth}:-2`;

  // HLS flags - live stream should always delete old segments to save disk space and stay fresh
  const streamFlags = ["omit_endlist", "independent_segments", "temp_file", "delete_segments"];

  // Encoder args (always libx264)
  const encoderArgs = [
    "-c:v", "libx264",
    "-preset", lowLatency ? "ultrafast" : "veryfast",
    "-tune", "zerolatency",
    "-profile:v", "baseline",
    "-pix_fmt", "yuv420p",
    "-g", gop,
    "-keyint_min", gop,
    "-sc_threshold", "0",
    "-force_key_frames", `expr:gte(t,n_forced*${hlsTime})`,
    "-b:v", bitrate,
    "-maxrate", maxrate,
    "-bufsize", bufsize,
  ];

  // Audio configuration: Copy AAC streams directly to prevent decoding crashes on bad headers
  let audioEnabled = isAudioEnabled(camera, audioFallback);
  if (camera.metadata && camera.metadata.hasAudio === false) audioEnabled = false;

  const audioArgs = audioEnabled
    ? (camera.metadata && camera.metadata.audioCodec === "aac"
        ? ["-map", "0:a?", "-c:a", "copy"]
        : ["-map", "0:a?", "-c:a", "aac", "-ar", "44100", "-b:a", "128k", "-ac", "2", "-async", "1"])
    : ["-an"];

  // ========== Build the full command ==========
  const args = [
    "-hide_banner", "-nostdin",
    // Input options for maximum stability
    "-fflags", "+genpts+discardcorrupt",
    "-flags", "low_delay",
    "-loglevel", options.ffmpegLogLevel || "warning",
    "-err_detect", "ignore_err",
    ...buildRtspInputArgs(camera, options),
    "-i", source,
  ];

  // Filter complex — always transcode with split
  if (recordDir) {
    const streamFilter = `fps=${fps}`;
    const recordFilter = `fps=${fps}`;
    args.push("-filter_complex",
      `[0:v:0]split=3[vhls][vrec][vdet];[vhls]${streamFilter}[vhlsout];[vrec]${recordFilter}[vrecout];[vdet]${detectFilter}[vdetout]`
    );
  } else {
    const streamFilter = `fps=${fps}`;
    args.push("-filter_complex",
      `[0:v:0]split=2[vhls][vdet];[vhls]${streamFilter}[vhlsout];[vdet]${detectFilter}[vdetout]`
    );
  }

  // 1. Live Stream Output (always transcode to H264)
  args.push("-map", "[vhlsout]", ...encoderArgs);
  args.push(...audioArgs);
  args.push(
    "-f", "hls",
    "-hls_time", hlsTime,
    "-hls_list_size", lowLatency ? "6" : "8",
    "-hls_delete_threshold", "1",
    "-hls_flags", streamFlags.join("+"),
    "-hls_allow_cache", "0",
    "-hls_segment_type", "mpegts",
    "-hls_segment_filename", path.join(dir, "seg_%06d.ts"),
    path.join(dir, "index.m3u8")
  );

  // 2. Record HLS Output (also transcode to H264 for consistency)
  if (recordDir) {
    args.push("-map", "[vrecout]", ...encoderArgs);
    args.push(...audioArgs);
    args.push(
      "-f", "hls",
      "-hls_time", "60",
      "-hls_segment_type", "mpegts",
      "-hls_flags", "split_by_time+append_list",
      "-hls_list_size", "5",
      "-strftime", "1",
      "-strftime_mkdir", "1",
      "-hls_segment_filename", path.join(recordDir, "%Y/%m/%d/%H/%M_%S.ts"),
      path.join(recordDir, "live.m3u8")
    );
  }

  // 3. Motion Detection Output (MJPEG pipe)
  args.push(
    "-map", "[vdetout]",
    "-an",
    "-vcodec", "mjpeg",
    "-q:v", String(options.mjpegQuality || 7),
    "-f", "image2pipe",
    "pipe:1"
  );

  return args;
}
