const REDACTED = "[REDACTED]";

export function sanitizeRequestUrl(value) {
  try {
    const url = new URL(String(value || "/"), "http://local");
    for (const key of ["token", "password", "secret"]) {
      if (url.searchParams.has(key)) url.searchParams.set(key, REDACTED);
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return String(value || "").replace(
      /([?&](?:token|password|secret)=)[^&\s]*/gi,
      `$1${REDACTED}`,
    );
  }
}

export function redactError(value) {
  return String(value?.stack || value?.message || value || "")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi, `$1${REDACTED}$3`)
    .replace(/("(?:password|token|secret)"\s*:\s*")[^"]*(")/gi, `$1${REDACTED}$2`)
    .replace(/([?&](?:token|password|secret)=)[^&\s]*/gi, `$1${REDACTED}`)
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, `$1${REDACTED}`);
}
