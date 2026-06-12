import type { Camera, SourceType, StreamType } from "@/types";

export const DEFAULT_PORTS: Record<SourceType, { primary: number; onvif?: number }> = {
  RTSP: { primary: 554 },
  "RTSP+ONVIF": { primary: 554, onvif: 80 },
  MJPEG: { primary: 80 },
  HLS: { primary: 443 },
};

export function defaultPath(sourceType: SourceType): string {
  switch (sourceType) {
    case "RTSP":
    case "RTSP+ONVIF":
      return "/Streaming/Channels/101";
    case "MJPEG":
      return "/mjpg/video.mjpg";
    case "HLS":
      return "/live/index.m3u8";
  }
}

export function normalizePath(p?: string): string {
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

interface UrlOpts {
  maskPassword?: boolean;
  includeAuth?: boolean;
}

export function buildSourceUrl(
  c: Pick<Camera, "ip" | "sourceType" | "rtspPort" | "httpPort" | "sourcePath" | "username"> & {
    password?: string;
  },
  opts: UrlOpts = {}
): string {
  const { maskPassword = false, includeAuth = true } = opts;
  const path = normalizePath(c.sourcePath);
  const auth =
    includeAuth && c.username
      ? `${c.username}:${maskPassword ? "••••••" : encodeURIComponent(c.password || "")}@`
      : "";
  const host = c.ip || "0.0.0.0";

  switch (c.sourceType) {
    case "RTSP":
    case "RTSP+ONVIF": {
      const port = c.rtspPort ?? DEFAULT_PORTS[c.sourceType].primary;
      return `rtsp://${auth}${host}:${port}${path}`;
    }
    case "MJPEG": {
      const port = c.httpPort ?? DEFAULT_PORTS.MJPEG.primary;
      return `http://${auth}${host}:${port}${path}`;
    }
    case "HLS": {
      const port = c.httpPort ?? DEFAULT_PORTS.HLS.primary;
      const proto = port === 443 ? "https" : "http";
      return `${proto}://${auth}${host}:${port}${path}`;
    }
  }
}

export function buildOnvifUrl(c: Pick<Camera, "ip" | "onvifPort">): string {
  const port = c.onvifPort ?? 80;
  return `http://${c.ip || "0.0.0.0"}:${port}/onvif/device_service`;
}

export function buildRestreamUrl(c: Pick<Camera, "id" | "streamType">, origin?: string): string {
  const defaultOrigin = typeof window === "undefined"
    ? "http://localhost:4200"
    : ["5173", "5174", "8080"].includes(window.location.port)
      ? `${window.location.protocol}//${window.location.hostname}:4200`
      : window.location.origin;
  const base = `${origin ?? defaultOrigin}/api/streams/${c.id}`;
  return c.streamType === "MJPEG" ? `${base}/video.mjpg` : `${base}/index.m3u8?output=${encodeURIComponent(c.streamType)}`;
}

export function restreamLabel(s: StreamType): string {
  return s === "MJPEG" ? "MJPEG Proxy" : s;
}
