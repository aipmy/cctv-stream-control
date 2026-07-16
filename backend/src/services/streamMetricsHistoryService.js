import fs from "node:fs";
import path from "node:path";

const METRICS_HISTORY_PATH = path.resolve("data/metrics_history.json");

function ensureFile() {
  const dir = path.dirname(METRICS_HISTORY_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(METRICS_HISTORY_PATH)) {
    fs.writeFileSync(METRICS_HISTORY_PATH, JSON.stringify([], null, 2), "utf8");
  }
}

export function logMetricsToHistory(metricsRecord) {
  try {
    ensureFile();
    const data = JSON.parse(fs.readFileSync(METRICS_HISTORY_PATH, "utf8"));
    
    const record = {
      timestamp: new Date().toISOString(),
      ...metricsRecord
    };

    data.push(record);
    
    if (data.length > 1000) {
      data.shift();
    }

    fs.writeFileSync(METRICS_HISTORY_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[MetricsHistory] Failed to write metrics history:", err);
  }
}

export function getMetricsHistory() {
  try {
    ensureFile();
    return JSON.parse(fs.readFileSync(METRICS_HISTORY_PATH, "utf8"));
  } catch {
    return [];
  }
}
