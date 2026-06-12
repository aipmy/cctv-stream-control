const totals = {
  apiBytes: 0,
  webBytes: 0,
  cctvOutBytes: 0,
};

let last = {
  at: Date.now(),
  ...totals,
};

export function recordTraffic(category, bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return;
  if (category === "api") totals.apiBytes += n;
  else if (category === "web") totals.webBytes += n;
  else if (category === "cctvOut") totals.cctvOutBytes += n;
}

export function trafficMiddleware(req, res, next) {
  const category = req.path.startsWith("/api/streams")
    ? "cctvOut"
    : req.path.startsWith("/api")
      ? "api"
      : "web";

  const write = res.write.bind(res);
  const end = res.end.bind(res);

  res.write = (chunk, encoding, cb) => {
    if (chunk) recordTraffic(category, Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), encoding));
    return write(chunk, encoding, cb);
  };

  res.end = (chunk, encoding, cb) => {
    if (chunk) recordTraffic(category, Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), encoding));
    return end(chunk, encoding, cb);
  };

  next();
}

export function sampleTrafficRates(extra = {}, now = Date.now()) {
  const elapsed = Math.max(0.25, (now - last.at) / 1000);
  const apiBytesPerSec = (totals.apiBytes - last.apiBytes) / elapsed;
  const webBytesPerSec = (totals.webBytes - last.webBytes) / elapsed;
  const cctvOutBytesPerSecMeasured = (totals.cctvOutBytes - last.cctvOutBytes) / elapsed;

  last = { at: now, ...totals };

  const cctvPullKbps = Number(extra.cctvPullKbps || 0);
  const cctvOutKbpsEstimated = Number(extra.cctvOutKbps || 0);
  const cctvPullBytesPerSec = (cctvPullKbps * 1000) / 8;
  const cctvOutBytesPerSec = Math.max(cctvOutBytesPerSecMeasured, (cctvOutKbpsEstimated * 1000) / 8);
  const apiKbps = (apiBytesPerSec * 8) / 1000;
  const webKbps = (webBytesPerSec * 8) / 1000;
  const cctvOutKbps = (cctvOutBytesPerSec * 8) / 1000;

  return {
    ts: now,
    seconds: elapsed,
    apiKbps,
    webKbps,
    cctvPullKbps,
    cctvOutKbps,
    totalKbps: apiKbps + webKbps + cctvPullKbps + cctvOutKbps,
    apiBytesPerSec,
    webBytesPerSec,
    cctvPullBytesPerSec,
    cctvOutBytesPerSec,
    totalBytesPerSec: apiBytesPerSec + webBytesPerSec + cctvPullBytesPerSec + cctvOutBytesPerSec,
    viewers: Number(extra.viewers || 0),
    activeProcesses: Number(extra.activeProcesses || 0),
    activeCameras: Number(extra.activeCameras || 0),
  };
}
