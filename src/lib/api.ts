import type {
  Camera,
  CameraInput,
  AuditOutcome,
  AuditRecord,
  CreateUserInput,
  StreamType,
  UpdateUserInput,
  UserSummary,
  SmartEvent,
} from "@/types";

function devApiBaseFromBrowser() {
  if (typeof window === "undefined") return "http://localhost:4200";
  // Penting: jangan hardcode localhost. Kalau dashboard dibuka dari laptop lain
  // via http://IP_SERVER:8080, maka localhost berarti laptop client, bukan server.
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4200`;
}

export const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== "undefined" && ["5173", "5174", "8080"].includes(window.location.port) ? devApiBaseFromBrowser() : "");

interface ApiOptions extends RequestInit {
  json?: unknown;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getApiToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("cctv-lite-token") || "";
}

export function setApiToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("cctv-lite-token", token);
  else localStorage.removeItem("cctv-lite-token");
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getApiToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  let body = options.body;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const payload = await res.json();
      message = payload.error || message;
    } catch {
      // ignore
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const cameraApi = {
  list: () => api<Camera[]>("/api/cameras"),
  create: (payload: CameraInput) => api<Camera>("/api/cameras", { method: "POST", json: payload }),
  update: (id: string, payload: Partial<CameraInput>) => api<Camera>(`/api/cameras/${encodeURIComponent(id)}`, { method: "PUT", json: payload }),
  remove: (id: string) => api<void>(`/api/cameras/${encodeURIComponent(id)}`, { method: "DELETE" }),
  restart: (id: string, output?: Camera["streamType"]) => api<{ ok: boolean }>(`/api/cameras/${encodeURIComponent(id)}/restart`, { method: "POST", json: { output } }),
  ptz: (id: string, action: "up" | "down" | "left" | "right" | "home" | "zoomIn" | "zoomOut" | "stop") =>
    api<PtzResult>(`/api/cameras/${encodeURIComponent(id)}/ptz`, { method: "POST", json: { action } }),
  testPtz: (id: string) =>
    api<PtzResult>(`/api/cameras/${encodeURIComponent(id)}/ptz/test`, { method: "POST" }),
  probe: (id: string, deep = false) => api<{ camera: Camera; probe: unknown }>(`/api/cameras/${encodeURIComponent(id)}/probe?deep=${deep ? "1" : "0"}`, { method: "POST" }),
  probeAll: (deep = false) => api<Array<{ camera: Camera; probe: unknown }>>(`/api/cameras/probe-all?deep=${deep ? "1" : "0"}`, { method: "POST" }),
  probeTest: (payload: Partial<CameraInput>) => api<{ camera: Camera; probe: { ok: boolean; info?: { streams?: Array<{ codec_type: string; codec_name?: string; [key: string]: unknown }>; [key: string]: unknown }; error?: string } }>("/api/cameras/probe-test", { method: "POST", json: payload }),
  exportAll: () => api<{ exportedAt: string; cameras: Camera[] }>("/api/cameras/bulk/export"),
  importAll: (cameras: CameraInput[], mode: "replace" | "append" = "replace") => api<Camera[]>("/api/cameras/bulk/import", { method: "POST", json: { cameras, mode } }),
};

export const userApi = {
  list: () => api<UserSummary[]>("/api/users"),
  create: (payload: CreateUserInput) => api<UserSummary>("/api/users", { method: "POST", json: payload }),
  update: (id: string, payload: UpdateUserInput) => api<UserSummary>(`/api/users/${encodeURIComponent(id)}`, { method: "PUT", json: payload }),
  remove: (id: string) => api<void>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const authApi = {
  login: (username: string, password: string) =>
    api<{ user: UserSummary; token: string }>("/api/auth/login", { method: "POST", json: { username, password } }),
  me: () => api<{ user: UserSummary }>("/api/auth/me"),
  updatePreferences: (pinnedCameraIds: string[]) =>
    api<{ user: UserSummary }>("/api/auth/preferences", {
      method: "PATCH",
      json: { pinnedCameraIds },
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ user: UserSummary }>("/api/auth/password", {
      method: "POST",
      json: { currentPassword, newPassword },
    }),
  logout: () => api<void>("/api/auth/logout", { method: "POST" }),
};

export const setupApi = {
  status: () => api<{ required: boolean }>("/api/setup/status"),
  createAdmin: (username: string, password: string) =>
    api<{ user: UserSummary; token: string }>("/api/setup/admin", {
      method: "POST",
      json: { username, password },
    }),
};

export interface PtzResult {
  ok: boolean;
  message?: string;
  mode?: "standard" | "ws-security-time-shift";
  profileToken?: string | null;
  profiles?: number;
  warning?: { code: string; message: string } | null;
}

export interface TrafficRates {
  ts: number;
  seconds: number;
  apiKbps: number;
  webKbps: number;
  cctvPullKbps: number;
  cctvOutKbps: number;
  totalKbps: number;
  apiBytesPerSec?: number;
  webBytesPerSec?: number;
  cctvPullBytesPerSec?: number;
  cctvOutBytesPerSec?: number;
  totalBytesPerSec?: number;
  viewers?: number;
  activeProcesses?: number;
  activeCameras?: number;
}

export interface TrafficHistoryResponse {
  range: "1m" | "1h" | "24h";
  generatedAt: number;
  points: TrafficRates[];
}

export const statsApi = {
  get: () => api<{ cameras: Camera[]; totals: Record<string, number>; traffic?: TrafficRates }>("/api/stats"),
  traffic: () => api<TrafficRates>("/api/stats/traffic"),
  trafficHistory: (range: TrafficHistoryResponse["range"]) =>
    api<TrafficHistoryResponse>(`/api/stats/traffic/history?range=${encodeURIComponent(range)}`),
};

export const systemApi = {
  status: () => api<Record<string, unknown>>("/api/system/status"),
  getDisks: () => api<DiskInfo[]>("/api/system/disks"),
  getFolders: (path: string = "/") => api<FolderInfo[]>(`/api/system/folders?path=${encodeURIComponent(path)}`),
  createFolder: (targetPath: string, folderName: string) => api<{ ok: boolean; path: string }>("/api/system/folders", {
    method: "POST",
    body: JSON.stringify({ targetPath, folderName }),
  }),
  formatDisk: (mountPoint: string) => api<{ ok: boolean }>("/api/system/disks/format", {
    method: "POST",
    body: JSON.stringify({ mountPoint }),
  }),
};

export interface AuditQuery {
  limit?: number;
  cursor?: string;
  actor?: string;
  action?: string;
  outcome?: AuditOutcome | "all";
}

export interface AuditPage {
  items: AuditRecord[];
  nextCursor: string | null;
}

export const auditApi = {
  list: (query: AuditQuery = {}) => {
    const params = new URLSearchParams();
    if (query.limit) params.set("limit", String(query.limit));
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.actor) params.set("actor", query.actor);
    if (query.action) params.set("action", query.action);
    if (query.outcome && query.outcome !== "all") params.set("outcome", query.outcome);
    const suffix = params.toString();
    return api<AuditPage>(`/api/audit${suffix ? `?${suffix}` : ""}`);
  },
  clear: () => api<{ ok: boolean }>("/api/audit/clear", { method: "POST" }),
  exportUrl: () => withToken(`${API_BASE}/api/audit/export`),
};

export interface StreamStatus {
  id: string;
  output: StreamType | "MJPEG";
  status: string;
  error?: {
    code: string;
    message: string;
  } | null;
}

export interface ServerSettings {
  retentionDays: number;
  maxStorageGb: number;
  telegramBotToken: string;
  telegramChatId: string;
  recordingMode?: string;
  preMotionSeconds?: number;
  postMotionSeconds?: number;
  segmentDuration?: number;
  enableAudioRecording?: boolean;
  customStorageDir?: string;
}

export const streamApi = {
  start: (id: string, output?: StreamType) => api<{ ok: boolean; ready: boolean; streamUrl: string }>(`/api/streams/${encodeURIComponent(id)}/start?vid=${encodeURIComponent(getViewerId())}`, { method: "POST", json: { output } }),
  stop: (id: string, output?: StreamType) => api<{ stopped: string[] }>(`/api/streams/${encodeURIComponent(id)}/stop`, { method: "POST", json: { output } }),
  ping: (id: string) => api<{ ok: boolean }>(`/api/streams/${encodeURIComponent(id)}/ping?vid=${encodeURIComponent(getViewerId())}`, { method: "POST" }),
  leave: (id: string) => api<{ ok: boolean }>(`/api/streams/${encodeURIComponent(id)}/leave?vid=${encodeURIComponent(getViewerId())}`, { method: "POST" }),
  fallback: (id: string) => api<{ ok: boolean; fallback: string }>(`/api/streams/${encodeURIComponent(id)}/fallback`, { method: "POST" }),
  status: () => api<StreamStatus[]>("/api/streams/status"),
  playbackInfo: (id: string, date: string, start?: number, end?: number) => {
    let url = `/api/streams/${encodeURIComponent(id)}/playback-info?date=${encodeURIComponent(date)}`;
    if (start !== undefined) url += `&start=${start}`;
    if (end !== undefined) url += `&end=${end}`;
    return api<{ 
      hasRecording: boolean; 
      firstSegmentUnixTime?: number; 
      lastSegmentUnixTime?: number;
      segmentMappings?: Array<{ ts: number; offset: number; duration: number }>;
    }>(url);
  },
  deleteTodayRecordings: (id: string, date: string) => api<{ ok: boolean; deletedCount: number }>(`/api/streams/${encodeURIComponent(id)}/recordings/today?date=${encodeURIComponent(date)}`, { method: "DELETE" }),
  deleteAllRecordings: (id: string) => api<{ ok: boolean }>(`/api/streams/${encodeURIComponent(id)}/recordings/all`, { method: "DELETE" }),
};

function getViewerId() {
  if (typeof window === "undefined") return "server";
  const key = "cctv-lite-viewer-id-v1";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function withToken(url: string) {
  const params: string[] = [];
  const token = getApiToken();
  if (token) params.push(`token=${encodeURIComponent(token)}`);
  params.push(`vid=${encodeURIComponent(getViewerId())}`);
  if (!params.length) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${params.join("&")}`;
}

export function streamUrl(camera: Pick<Camera, "id" | "streamType">, output = camera.streamType) {
  const id = encodeURIComponent(camera.id);
  const base = output === "MJPEG"
    ? `${API_BASE}/api/streams/${id}/video.mjpg`
    : `${API_BASE}/api/streams/${id}/index.m3u8?output=${encodeURIComponent(output)}`;
  return withToken(base);
}

export function playbackUrl(cameraId: string, date: string, start?: number, end?: number) {
  const id = encodeURIComponent(cameraId);
  let base = `${API_BASE}/api/streams/${id}/playback.m3u8?date=${encodeURIComponent(date)}`;
  if (start !== undefined) base += `&start=${start}`;
  if (end !== undefined) base += `&end=${end}`;
  return withToken(base);
}

export function downloadUrl(cameraId: string, startUnix: number, endUnix: number) {
  const id = encodeURIComponent(cameraId);
  const base = `${API_BASE}/api/streams/${id}/download?start=${startUnix}&end=${endUnix}`;
  return withToken(base);
}

export function streamInfoUrl(cameraId: string) {
  return withToken(`${API_BASE}/api/streams/${encodeURIComponent(cameraId)}/info`);
}

export const eventApi = {
  getSettings: () => api<ServerSettings>("/api/events/settings"),
  updateSettings: (payload: ServerSettings) =>
    api<unknown>("/api/events/settings", { method: "POST", json: payload }),
  list: () => api<SmartEvent[]>("/api/events"),
  trigger: (cameraId: string, type: "motion" | "sound") =>
    api<SmartEvent>("/api/events/trigger", { method: "POST", json: { cameraId, type } }),
  remove: (id: string) => api<void>(`/api/events/${encodeURIComponent(id)}`, { method: "DELETE" }),
  clear: () => api<void>("/api/events/clear", { method: "POST" }),
  videoUrl: (id: string) => withToken(`${API_BASE}/api/events/video/${encodeURIComponent(id)}`),
  snapshotUrl: (id: string) => withToken(`${API_BASE}/api/events/snapshot/${encodeURIComponent(id)}`),
  getStorageStatus: () => api<{
    usedBytes: number;
    maxBytes: number;
    recordingMode: string;
    maxStorageGb: number;
    retentionDays: number;
    diskTotal?: number;
    diskAvailable?: number;
    cpuUsage?: number;
    ramUsage?: number;
    ramTotal?: number;
    ramFree?: number;
    ramUsed?: number;
    diskReadMb?: number;
    diskWriteMb?: number;
  }>("/api/events/storage-status"),
  runStorageCleanup: () => api<{ ok: boolean }>("/api/events/cleanup", { method: "POST" }),
  deleteSnapshot: (id: string) => api<{ ok: boolean }>(`/api/events/${encodeURIComponent(id)}/snapshot`, { method: "DELETE" }),
};
export interface DiskInfo {
  filesystem: string;
  size: string;
  used: string;
  avail: string;
  usePercentage: string;
  mountPoint: string;
  formatType?: string;
  isReadOnly?: boolean;
}

export interface FolderInfo {
  name: string;
  path: string;
}
