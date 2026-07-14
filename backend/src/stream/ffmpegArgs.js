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
  args.push("-use_wallclock_as_timestamps", "1");
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

// Audio args untuk record output (tanpa filter_complex — pakai direct map)
function audioArgsRecord(camera, audioFallback) {
  if (!isAudioEnabled(camera, audioFallback)) return ["-an"];
  return ["-map", "[arecout]", "-c:a", "aac", "-ar", "44100", "-b:a", "128k", "-ac", "2"];
}

export function buildHlsArgs({ camera, output, dir, recordDir, options = {}, audioFallback = false }) {
  const source = buildSourceUrl(camera);
  const lowLatency = output === "HLS Low Latency";
  const hlsTime = lowLatency ? "1" : "2";
  
  const streamMode = normalizeHlsMode(camera.hlsMode, options);
  const streamResolution = camera.streamQuality === "Auto" ? null : (camera.streamQuality || null);
  
  const recordMode = camera.recordMode || streamMode;
  const recordResolution = camera.recordResolution === "Auto" ? null : (camera.recordResolution || null);

  const isSubStream = camera.sourcePath && (camera.sourcePath.includes("102") || camera.sourcePath.includes("sub"));
  const fps = streamResolution ? (lowLatency ? "15" : "12") : "20";
  const gop = String(Number(fps) * Number(hlsTime));
  
  const detectFps = (camera.detectFps !== undefined && camera.detectFps > 0) ? camera.detectFps : (options.mjpegFps || 8);
  const resMap = { "1080p": 1920, "720p": 1280, "480p": 854, "360p": 640, "144p": 256 };
  const detectWidth = (camera.detectResolution && camera.detectResolution !== "Auto" && resMap[camera.detectResolution]) ? resMap[camera.detectResolution] : (options.mjpegWidth || 640);
  const detectFilter = `fps=${detectFps},scale=${detectWidth}:-2`;

  const streamFlags = ["omit_endlist", "independent_segments", "temp_file"];
  if (!camera.enableRecording) streamFlags.push("delete_segments");

  const recordFlags = ["omit_endlist", "independent_segments", "temp_file"];

  const buildTranscodeArgs = (resolution, isLowLatency) => {
    const scaleFilter = resolution ? `,scale=-2:${resolution.replace("p", "")}` : "";
    const filter = `fps=${fps}${scaleFilter}`;
    const autoBitrate = isSubStream ? "1000k" : "5000k";
    const autoMaxrate = isSubStream ? "1500k" : "6000k";
    const autoBufsize = isSubStream ? "2000k" : "12000k";
    const bitrate = resolution ? (isLowLatency ? "2500k" : "3000k") : autoBitrate;
    const maxrate = resolution ? (isLowLatency ? "3500k" : "4000k") : autoMaxrate;
    const bufsize = resolution ? (isLowLatency ? "5000k" : "8000k") : autoBufsize;

    return {
      filter,
      args: [
        "-c:v", options.videoEncoder || "libx264",
        ...(((options.videoEncoder || "libx264") === "libx264") ? [
          "-preset", isLowLatency ? "ultrafast" : "veryfast",
          "-tune", "zerolatency",
          "-profile:v", "baseline",
          "-pix_fmt", "yuv420p",
        ] : (options.videoEncoder || "").includes("v4l2m2m") ? [
          "-pix_fmt", "yuv420p",
        ] : [
          "-profile:v", isSubStream ? "main" : "high",
          "-pix_fmt", "yuv420p",
        ]),
        "-g", gop,
        "-keyint_min", gop,
        "-sc_threshold", "0",
        "-force_key_frames", `expr:gte(t,n_forced*${hlsTime})`,
        "-b:v", bitrate,
        "-maxrate", maxrate,
        "-bufsize", bufsize,
      ]
    };
  };

  const args = [
    "-hide_banner", "-nostdin",
    "-fflags", "nobuffer+genpts",
    "-loglevel", options.ffmpegLogLevel || "warning",
    ...buildRtspInputArgs(camera, options),
    "-i", source,
  ];

  const audioEnabled = isAudioEnabled(camera, audioFallback);

  // Audio filter masuk ke dalam filter_complex untuk menghindari konflik -af vs -filter_complex
  // (FFmpeg 7+ tidak mengizinkan -af bersamaan dengan -filter_complex)
  let audioFilterChain = "";
  if (audioEnabled) {
    if (recordDir) {
      audioFilterChain = ";[0:a]asplit=2[ain1][ain2];[ain1]volume=3.0,aresample=async=1,asetpts=N/SR/TB[aout];[ain2]aresample=async=1,asetpts=N/SR/TB[arecout]";
    } else {
      audioFilterChain = ";[0:a]volume=3.0,aresample=async=1,asetpts=N/SR/TB[aout]";
    }
  }

  let filterComplex = "";
  if (streamMode === "transcode" && recordDir && recordMode === "transcode") {
    const streamTc = buildTranscodeArgs(streamResolution, lowLatency);
    const recordTc = buildTranscodeArgs(recordResolution, false);
    filterComplex = `[0:v:0]split=3[vhls][vrec][vdet];[vhls]${streamTc.filter}[vhlsout];[vrec]${recordTc.filter}[vrecout];[vdet]${detectFilter}[vdetout]${audioFilterChain}`;
  } else if (streamMode === "transcode") {
    const streamTc = buildTranscodeArgs(streamResolution, lowLatency);
    filterComplex = `[0:v:0]split=2[vhls][vdet];[vhls]${streamTc.filter}[vhlsout];[vdet]${detectFilter}[vdetout]${audioFilterChain}`;
  } else if (recordDir && recordMode === "transcode") {
    const recordTc = buildTranscodeArgs(recordResolution, false);
    filterComplex = `[0:v:0]split=2[vrec][vdet];[vrec]${recordTc.filter}[vrecout];[vdet]${detectFilter}[vdetout]${audioFilterChain}`;
  } else {
    filterComplex = `[0:v:0]${detectFilter}[vdetout]${audioFilterChain}`;
  }

  args.push("-filter_complex", filterComplex);

  // 1. Live Stream Output
  if (streamMode === "transcode") {
    const streamTc = buildTranscodeArgs(streamResolution, lowLatency);
    args.push("-map", "[vhlsout]", ...streamTc.args);
  } else {
    args.push("-map", "0:v:0", "-vsync", "0", "-vcodec", "copy");
  }

  // Audio: gunakan [aout] dari filter_complex jika audio enabled, atau -an jika disabled
  if (audioEnabled) {
    args.push("-map", "[aout]", "-c:a", "aac", "-ar", "44100", "-b:a", "128k", "-ac", "2");
  } else {
    args.push("-an");
  }

  args.push(
    "-f", "hls",
    "-hls_time", hlsTime,
    "-hls_list_size", lowLatency ? "20" : "15",
    "-hls_delete_threshold", "2",
    "-hls_flags", streamFlags.join("+"),
    "-hls_allow_cache", "0",
    "-hls_segment_type", "mpegts",
    "-hls_segment_filename", path.join(dir, "seg_%06d.ts"),
    path.join(dir, "index.m3u8")
  );

  // 2. Record HLS Output
  if (recordDir) {
    if (recordMode === "transcode") {
      const recordTc = buildTranscodeArgs(recordResolution, false);
      args.push("-map", "[vrecout]", ...recordTc.args);
    } else {
      args.push("-map", "0:v:0", "-vsync", "0", "-vcodec", "copy");
    }

    // Record audio: direct map dari input (tidak perlu volume boost)
    args.push(
      ...audioArgsRecord(camera, audioFallback),
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

  // 3. Motion Detection Output
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
