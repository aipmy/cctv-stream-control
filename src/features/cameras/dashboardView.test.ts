import { describe, expect, test } from "vitest";
import type { Camera } from "@/types";
import {
  filterDashboardCameras,
  gridClassFor,
  paginateCameras,
} from "./dashboardView";

function camera(patch: Partial<Camera>): Camera {
  return {
    id: "cam-1",
    name: "Gerbang Utama",
    site: "Gedung A",
    ip: "10.0.0.1",
    brand: "Universal",
    status: "online",
    enabled: true,
    sourceType: "RTSP+ONVIF",
    streamType: "HLS Stable",
    rtspUrl: "",
    hasPassword: true,
    enableAudio: false,
    enablePTZ: true,
    lastSeen: new Date(0).toISOString(),
    viewerCount: 0,
    bandwidthKbps: 0,
    latencyMs: 0,
    qualityProfile: "Medium",
    ...patch,
  };
}

const cameras = [
  camera({ id: "online", name: "Gerbang", site: "Utara", status: "online" }),
  camera({ id: "offline", name: "Gudang", site: "Selatan", status: "offline" }),
  camera({ id: "disabled", name: "Lobby", site: "Utara", enabled: false, status: "offline" }),
];

test("dashboard search includes name, site, and runtime/config status", () => {
  expect(filterDashboardCameras(cameras, { query: "selatan" }).map((item) => item.id))
    .toEqual(["offline"]);
  expect(filterDashboardCameras(cameras, { query: "online" }).map((item) => item.id))
    .toEqual(["online"]);
  expect(filterDashboardCameras(cameras, { query: "nonaktif" }).map((item) => item.id))
    .toEqual(["disabled"]);
});

test("site/status filters and pinned-only mode compose deterministically", () => {
  const result = filterDashboardCameras(cameras, {
    site: "Utara",
    status: "all",
    pinnedOnly: true,
    pinnedCameraIds: ["disabled", "online"],
  });

  expect(result.map((item) => item.id)).toEqual(["online", "disabled"]);
});

test("pagination clamps page and supports one through six cameras", () => {
  const result = paginateCameras(cameras, 9, 2);
  expect(result.page).toBe(2);
  expect(result.totalPages).toBe(2);
  expect(result.items.map((item) => item.id)).toEqual(["disabled"]);
});

describe("gridClassFor", () => {
  test.each([1, 2, 3, 4, 5, 6] as const)("supports %i columns", (columns) => {
    expect(gridClassFor(columns)).toContain(`grid-cols-${columns}`);
  });
});
