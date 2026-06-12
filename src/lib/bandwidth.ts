export function bytesFromKbps(kbps = 0) {
  return Math.max(0, (Number(kbps) || 0) * 1000 / 8);
}

export function formatByteRateFromBytes(bytesPerSec = 0) {
  const n = Math.max(0, Number(bytesPerSec) || 0);
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB/s`;
  return `${(n / 1024).toFixed(2)} KB/s`;
}

export function formatByteRateFromKbps(kbps = 0) {
  return formatByteRateFromBytes(bytesFromKbps(kbps));
}
