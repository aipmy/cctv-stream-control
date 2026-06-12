import { getBearerToken, verifyToken } from "../core/auth.js";
import { config } from "../core/config.js";

export function requireAuth(req, res, next) {
  if (!config.requireAuth) return next();
  const token = getBearerToken(req);
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: "Unauthorized. Login ulang atau sertakan token stream." });
  req.auth = user;
  req.authToken = token;
  return next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!config.requireAuth) return next();
    if (!req.auth) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.auth.role)) return res.status(403).json({ error: "Role tidak diizinkan" });
    return next();
  };
}
