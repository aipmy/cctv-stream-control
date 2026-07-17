import type { Camera, SourceType, StreamType } from "@/types";
import { DEFAULT_PORTS } from "@/types";

export { DEFAULT_PORTS };

/**
 * Build the final go2rtc stream URL from camera config.
 */
export function buildStreamUrl(
  c: Pick<Camera, "ip" | "sourceType" | "port" | "username" | "audioMode"> & {
    password?: string;
    streamPath?: string;
    customUrl?: string;
  },
  opts: { maskPassword?: boolean; includeAuth?: boolean } = {}
): string {
  const { maskPassword = false, includeAuth = true } = opts;
  const host = c.ip || "0.0.0.0";
  const port = c.port || DEFAULT_PORTS[c.sourceType] || 80;
  const auth =
    includeAuth && c.username
      ? `${c.username}:${maskPassword ? "••••••" : encodeURIComponent(c.password || "")}@`
      : "";

  switch (c.sourceType) {
    case "ONVIF": {
      let url = `onvif://${auth}${host}:${port}`;
      if (c.audioMode === "Enable" || c.audioMode === "Auto") {
        url += "#backchannel=1#audio=opus";
      }
      return url;
    }
    case "RTSP": {
      const path = c.streamPath || "/Streaming/Channels/101";
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      return `rtsp://${auth}${host}:${port}${normalizedPath}`;
    }
    case "DVRIP": {
      return `dvrip://${auth}${host}:${port}`;
    }
    case "HomeAssistant": {
      return `homeassistant://${auth}${host}`;
    }
    case "Custom": {
      return c.customUrl || "";
    }
  }
}

export function buildOnvifUrl(c: Pick<Camera, "ip" | "port">): string {
  const port = c.port ?? 80;
  return `http://${c.ip || "0.0.0.0"}:${port}/onvif/device_service`;
}

export function buildRestreamUrl(c: Pick<Camera, "id" | "streamType">, origin?: string): string {
  const defaultOrigin = typeof window === "undefined"
    ? "http://localhost:4200"
    : ["5173", "5174", "8080", "8081"].includes(window.location.port)
      ? `${window.location.protocol}//${window.location.hostname}:4200`
      : window.location.origin;
  const base = `${origin ?? defaultOrigin}/api/streams/${c.id}`;
  return c.streamType === "MJPEG" ? `${base}/video.mjpg` : `${base}/index.m3u8?output=${encodeURIComponent(c.streamType)}`;
}

export function restreamLabel(s: StreamType): string {
  return s === "MJPEG" ? "MJPEG Proxy" : s;
}

export function defaultPath(sourceType: SourceType): string {
  switch (sourceType) {
    case "RTSP":
      return "/Streaming/Channels/101";
    default:
      return "";
  }
}
