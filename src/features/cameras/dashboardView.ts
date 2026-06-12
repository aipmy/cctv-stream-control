import type { Camera } from "@/types";

export interface DashboardCameraFilters {
  query?: string;
  site?: string;
  status?: string;
  stream?: string;
  pinnedOnly?: boolean;
  pinnedCameraIds?: string[];
}

function searchableCameraText(camera: Camera) {
  const configurationStatus = camera.enabled ? "aktif enabled" : "nonaktif disabled";
  return [
    camera.name,
    camera.site,
    camera.brand,
    camera.ip,
    camera.status,
    configurationStatus,
  ].join(" ").toLowerCase();
}

export function filterDashboardCameras(
  cameras: Camera[],
  filters: DashboardCameraFilters = {},
) {
  const query = String(filters.query || "").trim().toLowerCase();
  const pinned = new Set(filters.pinnedCameraIds || []);
  return cameras.filter((camera) => {
    if (filters.site && filters.site !== "all" && camera.site !== filters.site) return false;
    if (filters.status === "enabled" && !camera.enabled) return false;
    if (filters.status === "disabled" && camera.enabled) return false;
    if (filters.status === "online" && (!camera.enabled || camera.status !== "online")) return false;
    if (filters.status === "starting" && (!camera.enabled || camera.status !== "starting")) return false;
    if (filters.status === "offline" && (!camera.enabled || camera.status !== "offline")) return false;
    if (filters.stream && filters.stream !== "all" && camera.streamType !== filters.stream) return false;
    if (filters.pinnedOnly && !pinned.has(camera.id)) return false;
    return !query || searchableCameraText(camera).includes(query);
  });
}

export function paginateCameras(cameras: Camera[], requestedPage: number, requestedSize: number) {
  const pageSize = Math.max(1, Math.min(6, Math.floor(Number(requestedSize) || 4)));
  const totalPages = Math.max(1, Math.ceil(cameras.length / pageSize));
  const page = Math.max(1, Math.min(totalPages, Math.floor(Number(requestedPage) || 1)));
  const start = (page - 1) * pageSize;
  return {
    items: cameras.slice(start, start + pageSize),
    page,
    pageSize,
    totalPages,
    totalItems: cameras.length,
  };
}

export function gridClassFor(columns: 1 | 2 | 3 | 4 | 5 | 6) {
  return {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    5: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
    6: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
  }[columns];
}
