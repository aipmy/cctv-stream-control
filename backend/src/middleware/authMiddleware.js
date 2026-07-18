import { getBearerToken, verifyToken } from "../core/auth.js";
import { config } from "../core/config.js";
import { getUserById } from "../services/userService.js";
import { isTokenRevoked } from "../core/tokenBlacklist.js";

export async function requireAuth(req, res, next) {
  try {
    if (!config.requireAuth) return next();
    const token = getBearerToken(req);
    const user = verifyToken(token);
    if (!user) return res.status(401).json({ error: "Unauthorized. Login ulang atau sertakan token stream." });
    
    if (await isTokenRevoked(user.jti)) {
      return res.status(401).json({ error: "Sesi telah berakhir (Logout)" });
    }
    
    const dbUser = await getUserById(user.sub);
    if (!dbUser || !dbUser.active) return res.status(401).json({ error: "Sesi tidak valid" });
    
    req.auth = {
      ...user,
      allowedGroups: dbUser.allowedGroups || [],
      role: dbUser.role,
      permissions: dbUser.permissions || {},
    };
    req.authToken = token;
    
    // Track IP for Go2RTC viewer mapping
    // Record both direct IP and real public IP from proxy headers
    const clientIp = req.ip || req.connection?.remoteAddress;
    const cfIp = req.headers['cf-connecting-ip'];
    const xffHeader = req.headers['x-forwarded-for'];
    const xRealIp = req.headers['x-real-ip'];
    
    import("../core/userTracker.js").then(({ recordUserIp }) => {
      if (clientIp) recordUserIp(clientIp, dbUser.username);
      if (cfIp) recordUserIp(cfIp, dbUser.username);
      if (xRealIp && xRealIp !== clientIp) recordUserIp(xRealIp, dbUser.username);
      if (xffHeader) {
        // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
        const ips = xffHeader.split(',').map(s => s.trim());
        for (const ip of ips) {
          if (ip && ip !== clientIp) recordUserIp(ip, dbUser.username);
        }
      }
    }).catch(() => {});

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

export function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!config.requireAuth) return next();
    if (!req.auth) return res.status(401).json({ error: "Unauthorized" });
    if (req.auth.role === "admin") return next();
    if (req.auth.permissions?.[permissionKey]) return next();
    return res.status(403).json({ error: "Aksi tidak diizinkan untuk akun Anda" });
  };
}
