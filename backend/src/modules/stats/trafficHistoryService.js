import path from "node:path";
import { config } from "../../core/config.js";
import { sampleTrafficRates } from "../../core/traffic.js";
import { createTrafficHistoryStore } from "./trafficHistoryStore.js";

const store = createTrafficHistoryStore({
  filePath: path.join(config.dataDir, "traffic-history.ndjson"),
});

let timer = null;
let metricsProvider = () => ({});
let sampleLock = Promise.resolve();

function emptyTraffic() {
  return {
    ts: Date.now(),
    seconds: 1,
    apiKbps: 0,
    webKbps: 0,
    cctvPullKbps: 0,
    cctvOutKbps: 0,
    totalKbps: 0,
    apiBytesPerSec: 0,
    webBytesPerSec: 0,
    cctvPullBytesPerSec: 0,
    cctvOutBytesPerSec: 0,
    totalBytesPerSec: 0,
    viewers: 0,
    activeProcesses: 0,
    activeCameras: 0,
  };
}

function sample() {
  const operation = sampleLock.then(async () => {
    const point = sampleTrafficRates(await metricsProvider());
    await store.add(point);
    return point;
  });
  sampleLock = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function startTrafficHistory(provider, intervalMs = 1000) {
  if (timer) return;
  metricsProvider = typeof provider === "function" ? provider : () => ({});
  await store.load();
  await sample();
  timer = setInterval(() => {
    sample().catch(() => undefined);
  }, Math.max(1000, Number(intervalMs)));
  timer.unref?.();
}

export async function stopTrafficHistory() {
  if (timer) clearInterval(timer);
  timer = null;
  await sampleLock;
  await store.flush();
}

export function getLatestTraffic() {
  return store.latest() || emptyTraffic();
}

export function getTrafficHistory(range) {
  return store.query(range);
}
