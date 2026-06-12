import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { useAuth } from "@/features/auth/store";

function json(payload: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

describe("application bootstrap", () => {
  const requests: string[] = [];

  beforeEach(() => {
    localStorage.clear();
    requests.length = 0;
    useAuth.setState({ user: null, token: null, hasHydrated: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows first-admin setup before loading protected data", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/api/setup/status")) return json({ required: true });
      return json({ error: "unexpected request" }, 500);
    }));

    render(<App />);

    expect(await screen.findByRole("heading", { name: /buat akun administrator/i })).toBeInTheDocument();
    expect(requests.some((url) => url.includes("/api/cameras"))).toBe(false);
    expect(requests.some((url) => url.includes("/api/users"))).toBe(false);
  });

  it("loads a technician session without users API or dummy stream requests", async () => {
    useAuth.getState().setSession(
      { id: "u-tech", username: "teknisi", role: "teknisi", active: true },
      "session-token",
    );
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/api/setup/status")) return json({ required: false });
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { id: "u-tech", username: "teknisi", role: "teknisi", active: true } });
      }
      if (url.endsWith("/api/cameras")) return json([]);
      if (url.endsWith("/api/stats")) {
        return json({ cameras: [], totals: {}, traffic: {} });
      }
      if (url.endsWith("/api/stats/traffic")) return json({});
      return json({ error: "unexpected request" }, 500);
    }));

    render(<App />);

    expect(await screen.findByRole("heading", { name: /dashboard monitoring/i })).toBeInTheDocument();
    await waitFor(() => expect(requests.some((url) => url.includes("/api/cameras"))).toBe(true));
    expect(requests.some((url) => url.includes("/api/users"))).toBe(false);
    expect(requests.some((url) => /\/api\/streams\/c-[1-8]\//.test(url))).toBe(false);
  });
});
