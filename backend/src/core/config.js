import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(backendRoot, ".env") });

let dynamicStorageDir = null;

function resolveFromBackend(p, fallback) {
  return path.resolve(backendRoot, p || fallback);
}

export const config = {
  backendRoot,
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 4200),
  env: process.env.NODE_ENV || "development",
  frontendDist: resolveFromBackend(process.env.FRONTEND_DIST, "../dist"),
  dataDir: resolveFromBackend(process.env.DATA_DIR, "./data"),
  get storageDir() {
    return dynamicStorageDir || resolveFromBackend(process.env.STORAGE_DIR, "./storage");
  },
  setStorageDir(dir) {
    if (!dir) {
      dynamicStorageDir = null;
    } else {
      dynamicStorageDir = path.isAbsolute(dir) ? dir : path.resolve(backendRoot, dir);
    }
  },
  logDir: resolveFromBackend(process.env.LOG_DIR, "./logs"),
  ffmpegBin: process.env.FFMPEG_BIN || "ffmpeg",
  ffprobeBin: process.env.FFPROBE_BIN || "ffprobe",
  streamProfile: process.env.STREAM_PROFILE || "copy",
  videoEncoder: process.env.VIDEO_ENCODER || "libx264",
  rtspTransport: process.env.RTSP_TRANSPORT || "tcp",
  hlsStartTimeoutMs: Number(process.env.HLS_START_TIMEOUT_MS || 20000),
  streamIdleMs: Number(process.env.STREAM_IDLE_MS || 10000),
  // Default 0: jangan tambahkan opsi timeout FFmpeg.
  // Beberapa build FFmpeg tidak support -rw_timeout; jika butuh, set
  // RTSP_TIMEOUT_OPTION=stimeout|timeout|rw_timeout dan STREAM_READ_TIMEOUT_US.
  streamReadTimeoutUs: Number(process.env.STREAM_READ_TIMEOUT_US || 0),
  rtspTimeoutOption: process.env.RTSP_TIMEOUT_OPTION || "none",
  ffmpegLogLevel: process.env.FFMPEG_LOG_LEVEL || "warning",
  ffmpegLogToConsole: process.env.FFMPEG_LOG_TO_CONSOLE === "true",
  ffmpegLogToFile: process.env.FFMPEG_LOG_TO_FILE === "true",
  streamErrorBytes: Number(process.env.STREAM_ERROR_BYTES || 12000),
  streamErrorRetentionMs: Number(process.env.STREAM_ERROR_RETENTION_MS || 300000),
  mjpegStartTimeoutMs: Number(process.env.MJPEG_START_TIMEOUT_MS || 10000),
  mjpegFps: Number(process.env.MJPEG_FPS || 8),
  mjpegWidth: Number(process.env.MJPEG_WIDTH || 854),
  mjpegQuality: Number(process.env.MJPEG_QUALITY || 7),
  mjpegBandwidthKbps: Number(process.env.MJPEG_BANDWIDTH_KBPS || 850),
  hlsStableBandwidthKbps: Number(process.env.HLS_STABLE_BANDWIDTH_KBPS || 1200),
  hlsLowLatencyBandwidthKbps: Number(process.env.HLS_LL_BANDWIDTH_KBPS || 1500),
  auditRetentionMs: Number(process.env.AUDIT_RETENTION_MS || 90 * 24 * 60 * 60_000),
  auditMaxRecords: Number(process.env.AUDIT_MAX_RECORDS || 100000),
  authSecret: process.env.AUTH_SECRET || "change-this-secret-in-production",
  requireAuth: process.env.REQUIRE_AUTH !== "false",
  corsOriginRaw: process.env.CORS_ORIGIN || "*",
  corsOrigins: (process.env.CORS_ORIGIN || "*")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
  go2rtcApiPort: Number(process.env.GO2RTC_API_PORT || 1984),
  go2rtcRtspPort: Number(process.env.GO2RTC_RTSP_PORT || 8554),
  go2rtcWebrtcPort: Number(process.env.GO2RTC_WEBRTC_PORT || 8555),
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
};

export const corsAllowAnyOrigin = config.corsOrigins.length === 0 || config.corsOrigins.includes("*");
