import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTrafficHistoryStore } from "../src/modules/stats/trafficHistoryStore.js";

function point(ts, totalBytesPerSec) {
  return {
    ts,
    seconds: 1,
    apiKbps: 0,
    webKbps: 0,
    cctvPullKbps: 0,
    cctvOutKbps: (totalBytesPerSec * 8) / 1000,
    totalKbps: (totalBytesPerSec * 8) / 1000,
    apiBytesPerSec: 0,
    webBytesPerSec: 0,
    cctvPullBytesPerSec: 0,
    cctvOutBytesPerSec: totalBytesPerSec,
    totalBytesPerSec,
  };
}

test("traffic history is shared, deterministic, and survives a store reload", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cctv-traffic-"));
  const filePath = path.join(dir, "traffic-history.ndjson");
  let now = 1_700_000_000_000;
  const first = createTrafficHistoryStore({
    filePath,
    now: () => now,
    retentionMs: 24 * 60 * 60_000,
  });
  await first.load();

  await first.add(point(now, 100));
  now += 1000;
  await first.add(point(now, 200));

  const userA = first.query("1h");
  const userB = first.query("1h");
  assert.deepEqual(userA, userB);
  assert.equal(userA.points.length, 2);

  const reloaded = createTrafficHistoryStore({
    filePath,
    now: () => now,
    retentionMs: 24 * 60 * 60_000,
  });
  await reloaded.load();

  assert.deepEqual(reloaded.query("1h"), userA);
});
