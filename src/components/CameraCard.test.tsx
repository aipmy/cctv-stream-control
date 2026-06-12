import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { CameraCard } from "./CameraCard";
import { useAuth } from "@/features/auth/store";
import type { Camera } from "@/types";

const { ptz } = vi.hoisted(() => ({
  ptz: vi.fn().mockResolvedValue({ ok: true, action: "home", mode: "standard" }),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, cameraApi: { ...actual.cameraApi, ptz } };
});

vi.mock("@/components/CameraLiveView", () => ({
  CameraLiveView: () => <div>video</div>,
}));

const camera: Camera = {
  id: "cam-1",
  name: "Gate",
  site: "North",
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
  lastSeen: new Date().toISOString(),
  viewerCount: 0,
  bandwidthKbps: 0,
  latencyMs: 0,
  qualityProfile: "Medium",
};

test("PTZ action displays success feedback on the camera card", async () => {
  useAuth.setState({
    user: {
      id: "u-1",
      username: "admin",
      role: "admin",
      active: true,
      preferences: { pinnedCameraIds: [] },
    },
    token: "token",
  });

  render(
    <CameraCard
      camera={camera}
      onRestart={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      pinned={false}
      onTogglePin={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByTitle("PTZ home"));
  await waitFor(() => expect(screen.getByText("Berhasil")).toBeInTheDocument());
  expect(ptz).toHaveBeenCalledWith("cam-1", "home");
});
