import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { CameraFormDialog } from "./CameraFormDialog";

vi.mock("@/features/cameras/queries", () => ({
  useCamerasQuery: () => ({ data: [] }),
  useCameraActions: () => ({
    addCamera: vi.fn(),
    updateCamera: vi.fn(),
  }),
}));

test("camera dialog keeps actions outside its scrollable form body", () => {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <CameraFormDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );

  expect(screen.getByTestId("camera-form-scroll")).toHaveClass("overflow-y-auto");
  expect(screen.getByTestId("camera-form-footer")).not.toBe(
    screen.getByTestId("camera-form-scroll"),
  );
  expect(screen.getByRole("button", { name: /tambah|add/i })).toBeVisible();
});
