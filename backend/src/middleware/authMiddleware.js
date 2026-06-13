import { getBearerToken, verifyToken } from "../core/auth.js";
import { config } from "../core/config.js";
import { getUserById } from "../services/userService.js";

export async function requireAuth(req, res, next) {
  try {
    if (!config.requireAuth) return next();
    const token = getBearerToken(req);
    const user = verifyToken(token);
    if (!user) return res.status(401).json({ error: "Unauthorized. Login ulang atau sertakan token stream." });
    
    const dbUser = await getUserById(user.sub);
    if (!dbUser || !dbUser.active) return res.status(401).json({ error: "Sesi tidak valid" });
    
    req.auth = {
      ...user,
      allowedGroups: dbUser.allowedGroups || [],
      role: dbUser.role,
    };
    req.authToken = token;
    return next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!config.requireAuth) return next();
    if (!req.auth) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.auth.role)) return res.status(403).json({ error: "Role tidak diizinkan" });
    return next();
  };
}
