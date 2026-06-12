export type Role = "admin" | "teknisi" | "guest";
export type StreamType = "HLS Stable" | "HLS Low Latency" | "MJPEG";
export type RtspTransport = "tcp" | "udp" | "auto";
export type HlsMode = "copy" | "transcode";
export type Brand = "Universal" | "Bardi" | "EZVIZ" | "Hikvision";
export type SourceType = "RTSP" | "RTSP+ONVIF" | "MJPEG" | "HLS";
export type CameraStatus = "online" | "offline" | "starting";

export const SOURCE_SUPPORTS_PTZ: Record<SourceType, boolean> = {
  RTSP: false,
  "RTSP+ONVIF": true,
  MJPEG: false,
  HLS: false,
};

export interface Camera {
  id: string;
  name: string;
  site: string;
  ip: string;
  brand: Brand;
  /** Runtime status. Jangan diisi manual dari form; backend update dari probe/stream. */
  status: CameraStatus;
  /** Konfigurasi aktif/nonaktif kamera. Kamera disabled tidak akan start stream/FFmpeg. */
  enabled: boolean;
  sourceType: SourceType;
  streamType: StreamType;
  /** Transport RTSP untuk FFmpeg: tcp paling stabil, udp lebih rendah latency, auto mengikuti default FFmpeg. */
  rtspTransport?: RtspTransport;
  /** copy = ringan sesuai command manual; transcode = lebih kompatibel browser tapi CPU lebih berat. */
  hlsMode?: HlsMode;
  rtspPort?: number;
  onvifPort?: number;
  httpPort?: number;
  sourcePath?: string;
  rtspUrl: string; // computed / cached full source URL
  username?: string;
  password?: string;
  hasPassword: boolean;
  enableAudio: boolean;
  enablePTZ: boolean;
  lastSeen: string; // ISO
  viewerCount: number;
  bandwidthKbps: number;
  pullBandwidthKbps?: number;
  outBytesPerSec?: number;
  pullBytesPerSec?: number;
  latencyMs: number;
  qualityProfile: "Low" | "Medium" | "High" | "4K";
  streamQuality: "Auto" | "1080p" | "720p" | "480p" | "360p" | "144p";
  errorHistory?: Array<{ timestamp: string; message: string }>;
}

export interface CameraInput extends Partial<Omit<Camera, "password" | "hasPassword">> {
  name: string;
  site: string;
  ip: string;
  password?: string;
  clearPassword?: boolean;
}

export interface UserPermissions {
  canAddCamera: boolean;
  canEditCamera: boolean;
  canDeleteCamera: boolean;
  canRestartStream: boolean;
  canViewManagement: boolean;
}

export interface UserSummary {
  id: string;
  username: string;
  role: Role;
  active: boolean;
  permissions: UserPermissions;
  allowedGroups: string[];
  preferences: {
    pinnedCameraIds: string[];
  };
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: Role;
  active: boolean;
  permissions?: Partial<UserPermissions>;
  allowedGroups?: string[];
}

export interface UpdateUserInput {
  username?: string;
  password?: string;
  role?: Role;
  active?: boolean;
  permissions?: Partial<UserPermissions>;
  allowedGroups?: string[];
}

export type User = UserSummary;

export type AuditOutcome = "success" | "warning" | "failure";

export interface AuditRecord {
  id: string;
  ts: number;
  actor: {
    id: string | null;
    username: string;
    role: Role | null;
  };
  action: string;
  outcome: AuditOutcome;
  target: {
    type: string;
    id: string | null;
    label: string | null;
  } | null;
  ip: string | null;
  userAgent: string | null;
  details: Record<string, unknown>;
}
