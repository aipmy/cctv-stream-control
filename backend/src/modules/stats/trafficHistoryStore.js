import fs from "node:fs/promises";
import path from "node:path";

const RANGE_MS = {
  "1m": 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

const RATE_FIELDS = [
  "seconds",
  "apiKbps",
  "webKbps",
  "cctvPullKbps",
  "cctvOutKbps",
  "totalKbps",
  "apiBytesPerSec",
  "webBytesPerSec",
  "cctvPullBytesPerSec",
  "cctvOutBytesPerSec",
  "totalBytesPerSec",
  "viewers",
  "activeProcesses",
  "activeCameras",
];

function downsample(points, rangeMs, maxPoints) {
  if (points.length <= maxPoints) return points.map((point) => ({ ...point }));
  const bucketMs = Math.max(1000, Math.ceil(rangeMs / maxPoints / 1000) * 1000);
  const buckets = new Map();

  for (const point of points) {
    const key = Math.floor(point.ts / bucketMs) * bucketMs;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { ts: key, count: 0 };
      for (const field of RATE_FIELDS) bucket[field] = 0;
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    for (const field of RATE_FIELDS) bucket[field] += Number(point[field] || 0);
  }

  return [...buckets.values()].map(({ count, ...bucket }) => {
    for (const field of RATE_FIELDS) bucket[field] /= count;
    return bucket;
  });
}

export function createTrafficHistoryStore({
  filePath,
  now = Date.now,
  retentionMs = 24 * 60 * 60_000,
  maxQueryPoints = 1440,
}) {
  let points = [];
  let writesSinceCompact = 0;
  let writeLock = Promise.resolve();

  function prune(reference = now()) {
    const cutoff = reference - retentionMs;
    points = points.filter((point) => Number(point?.ts) >= cutoff);
  }

  function queueWrite(operation) {
    const current = writeLock.then(operation);
    writeLock = current.then(() => undefined, () => undefined);
    return current;
  }

  async function compact() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const content = points.map((point) => JSON.stringify(point)).join("\n");
    await fs.writeFile(filePath, content ? `${content}\n` : "", "utf8");
    writesSinceCompact = 0;
  }

  return {
    async load() {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      try {
        const raw = await fs.readFile(filePath, "utf8");
        points = raw
          .split(/\r?\n/)
          .filter(Boolean)
          .flatMap((line) => {
            try {
              const parsed = JSON.parse(line);
              return Number.isFinite(Number(parsed?.ts)) ? [parsed] : [];
            } catch {
              return [];
            }
          })
          .sort((a, b) => a.ts - b.ts);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        points = [];
      }
      prune();
      await compact();
    },

    add(point) {
      const normalized = { ...point, ts: Number(point.ts || now()) };
      points.push(normalized);
      prune(normalized.ts);
      writesSinceCompact += 1;
      return queueWrite(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        if (writesSinceCompact >= 3600) {
          await compact();
          return;
        }
        await fs.appendFile(filePath, `${JSON.stringify(normalized)}\n`, "utf8");
      });
    },

    latest() {
      return points.length ? { ...points[points.length - 1] } : null;
    },

    query(range = "1h") {
      const selectedRange = RANGE_MS[range] ? range : "1h";
      const rangeMs = RANGE_MS[selectedRange];
      const generatedAt = points.at(-1)?.ts ?? now();
      const selected = points.filter((point) => point.ts >= generatedAt - rangeMs);
      return {
        range: selectedRange,
        generatedAt,
        points: downsample(selected, rangeMs, maxQueryPoints),
      };
    },

    async flush() {
      await writeLock;
    },
  };
}
