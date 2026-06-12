import crypto from "node:crypto";
import { config } from "./config.js";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(value) {
  return crypto.createHmac("sha256", config.authSecret).update(value).digest("base64url");
}

export function createToken(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = sign(body);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(fromBase64url(body));
    if (!payload?.username || !payload?.role) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  if (req.query?.token) return String(req.query.token);
  return "";
}
