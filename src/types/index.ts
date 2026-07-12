export type Role = "admin" | "teknisi" | "guest" | "internal" | "external";
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
  audioMode: "Auto" | "Enable" | "Disable";
  enablePTZ: boolean;
  lastSeen: string; // ISO
  viewerCount: number;
  activeViewers?: ActiveViewer[];
  bandwidthKbps: number;
  pullBandwidthKbps?: number;
  outBytesPerSec?: number;
  pullBytesPerSec?: number;
  latencyMs: number;
  qualityProfile: "Low" | "Medium" | "High" | "4K";
  streamQuality: "Auto" | "1080p" | "720p" | "480p" | "360p" | "144p";
  errorHistory?: Array<{ timestamp: string; message: string }>;
  enableRecording?: boolean;
  enableNotifications?: boolean;
  enableSmartDetection?: boolean;
  motionSensitivity?: number;
  motionArea?: MotionArea | null;
  excludeAreas?: MotionArea[] | null;
  detectionModes?: string[] | null;
  detectResolution?: "Auto" | "1080p" | "720p" | "480p" | "360p" | "144p";
  recordingMode?: string;
  recordMode?: "copy" | "transcode" | "";
  recordResolution?: "Auto" | "1080p" | "720p" | "480p" | "360p" | "144p";
  enableSoundDetection?: boolean;
  detectFps?: number;
  aiSensitivity?: number;
  hardwareInfo?: {
    manufacturer: string;
    model: string;
    firmware: string;
  };
}

export interface MotionArea {
  type?: "rect" | "polygon";
  points?: { x: number; y: number }[];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  name?: string;
  enabled?: boolean;
}

export interface CameraInput extends Partial<Omit<Camera, "password" | "hasPassword">> {
  name: string;
  site: string;
  ip: string;
  password?: string;
  clearPassword?: boolean;
  enableRecording?: boolean;
  enableNotifications?: boolean;
  motionSensitivity?: number;
  motionArea?: MotionArea | null;
  excludeAreas?: MotionArea[] | null;
  detectionModes?: string[] | null;
  detectResolution?: "Auto" | "1080p" | "720p" | "480p" | "360p" | "144p";
  recordMode?: "copy" | "transcode" | "";
  recordResolution?: "Auto" | "1080p" | "720p" | "480p" | "360p" | "144p";
  enableSoundDetection?: boolean;
  detectFps?: number;
  aiSensitivity?: number;
}

export interface SmartEvent {
  id: string;
  cameraId: string;
  cameraName: string;
  site: string;
  ts: string; // ISO
  type: string;
  snapshotPath: string; // File name or relative URL path
  videoPath: string; // File name or relative URL path
  typeDescription?: string;
  classification?: "human" | "pet" | "pixel";
  score?: number;
  isOngoing?: boolean;
}


export interface UserPermissions {
  canAddCamera: boolean;
  canEditCamera: boolean;
  canDeleteCamera: boolean;
  canRestartStream: boolean;
  canViewManagement: boolean;
  canPlayAudio?: boolean;
  canViewStats?: boolean;
  canControlPTZ?: boolean;
  canViewPlayback?: boolean;
  canViewEvents?: boolean;
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
  lastLoginAt?: string;
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

export interface ActiveViewer {
  id: string;
  username: string;
  ip: string;
  userAgent?: string;
  output: string;
  lastSeenAgoSeconds: number;
}
