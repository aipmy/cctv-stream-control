import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { BandwidthChart } from "./BandwidthChart";

const { traffic, trafficHistory } = vi.hoisted(() => ({
  traffic: vi.fn(),
  trafficHistory: vi.fn().mockResolvedValue({
    range: "1h",
    generatedAt: 1_700_000_000_000,
    points: [
      {
        ts: 1_700_000_000_000,
        seconds: 1,
        apiKbps: 0,
        webKbps: 0,
        cctvPullKbps: 800,
        cctvOutKbps: 600,
        totalKbps: 1400,
        apiBytesPerSec: 0,
        webBytesPerSec: 0,
        cctvPullBytesPerSec: 100_000,
        cctvOutBytesPerSec: 75_000,
        totalBytesPerSec: 175_000,
      },
    ],
  }),
}));

vi.mock("@/lib/api", () => ({
  statsApi: { traffic, trafficHistory },
}));

vi.mock("@/features/cameras/queries", () => ({
  useCamerasQuery: () => ({ data: [] }),
}));

vi.mock("@/features/settings/store", () => ({
  useSettings: (selector: (state: { settings: { autoRefresh: boolean } }) => unknown) =>
    selector({ settings: { autoRefresh: false } }),
}));

vi.mock("recharts", () => ({
  CartesianGrid: () => null,
  Legend: () => null,
  Line: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

test("loads shared traffic history instead of building browser-local history", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <BandwidthChart />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(trafficHistory).toHaveBeenCalledWith("1h"));
  expect(traffic).not.toHaveBeenCalled();
});
