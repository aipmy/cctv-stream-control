import fs from "node:fs";
import { Jimp } from "jimp";
import net from "node:net";
import http from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { config, corsAllowAnyOrigin } from "./core/config.js";
import { authRoutes } from "./routes/authRoutes.js";
import { setupRoutes } from "./routes/setupRoutes.js";
import { cameraRoutes } from "./routes/cameraRoutes.js";
import { userRoutes } from "./routes/userRoutes.js";
import { streamRoutes } from "./routes/streamRoutes.js";
import { stopAllStreams } from "./stream/streamManager.js";
import { statRoutes } from "./routes/statRoutes.js";
import { systemRoutes } from "./routes/systemRoutes.js";
import { auditRoutes } from "./routes/auditRoutes.js";
import { eventRoutes } from "./routes/eventRoutes.js";
import { runStorageCleanup } from "./services/recordingService.js";
import { startMotionDetectionWorker, stopMotionDetectionWorker } from "./services/motionDetectionService.js";
import { requireAuth } from "./middleware/authMiddleware.js";
import { trafficMiddleware } from "./core/traffic.js";
import { redactError, sanitizeRequestUrl } from "./core/redact.js";
import { startTrafficHistory, stopTrafficHistory } from "./modules/stats/trafficHistoryService.js";
import { closeAudit, initializeAudit } from "./modules/audit/auditService.js";
import { initializeBlacklist, stopBlacklist } from "./core/tokenBlacklist.js";
import { listCameras, getGlobalMetrics } from "./services/cameraService.js";
import { syncGo2rtc } from "./services/go2rtcSync.js";

const GO2RTC_HOST = "127.0.0.1";
const GO2RTC_PORT = 1984;

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (corsAllowAnyOrigin || config.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Range", "Cache-Control", "Pragma"],
  exposedHeaders: ["Content-Length", "Content-Range", "Accept-Ranges", "Content-Type"],
  maxAge: 86400,
};

app.use(helmet({
  // Agar HLS/MJPEG/video chunk tidak kena policy browser yang terlalu ketat,
  // terutama saat dashboard dibuka via IP/VPN/tunnel berbeda.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false,
}));
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use((req, res, next) => {
  res.setHeader("X-CCTV-Dashboard", "cctv-monitoring-lite");
  next();
});
app.use(trafficMiddleware);
app.use(express.json({ limit: "10mb" }));
app.use(morgan((tokens, req, res) => [
  `[${tokens["remote-addr"](req, res)}]`,
  tokens.method(req, res),
  sanitizeRequestUrl(tokens.url(req, res)),
  tokens.status(req, res),
  `${tokens["response-time"](req, res)} ms`,
].join(" ")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "CCTV Monitoring Lite Backend", port: config.port, auth: config.requireAuth, time: new Date().toISOString() });
});

// ─── go2rtc HTTP proxy (BEFORE auth) ───────────────────────────────
// Proxy /api/ws and /video-rtc.js to go2rtc running on port 1984.
// Uses native http.request — http-proxy-middleware v3 silently fails with ESM.
function proxyToGo2rtc(req, res) {
  // If it's the websocket endpoint, hijack the socket from Express
  // Cloudflare sometimes drops Connection: Upgrade so it hits Express instead of server.on('upgrade')
  if (req.originalUrl.startsWith("/api/ws")) {
    const proxySocket = net.connect(GO2RTC_PORT, GO2RTC_HOST, () => {
      let rawReq = `${req.method} ${req.originalUrl} HTTP/1.1\r\n`;
      const headers = { ...req.headers };
      // Force explicitly to ensure Gorilla WS accepts it
      headers.connection = "Upgrade";
      headers.upgrade = "websocket";
      headers["x-forwarded-for"] = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
      
      for (const [key, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
          value.forEach(v => { rawReq += `${key}: ${v}\r\n`; });
        } else {
          rawReq += `${key}: ${value}\r\n`;
        }
      }
      rawReq += "\r\n";
      
      proxySocket.write(rawReq);
      proxySocket.pipe(req.socket);
      req.socket.pipe(proxySocket);
    });
    
    proxySocket.on("error", (err) => {
      console.error("[go2rtc express-ws-proxy] error:", err.message);
      req.socket.destroy();
    });
    req.socket.on("error", () => proxySocket.destroy());
    return;
  }

  // Standard HTTP proxy for /video-rtc.js or other routes
  const proxyReq = http.request({
    hostname: GO2RTC_HOST,
    port: GO2RTC_PORT,
    path: req.originalUrl,
    method: req.method,
    headers: { ...req.headers, host: `${GO2RTC_HOST}:${GO2RTC_PORT}` },
  }, (proxyRes) => {
    const headers = { ...proxyRes.headers };
    if (req.originalUrl.endsWith(".js") && !headers["content-type"]) {
      headers["content-type"] = "application/javascript; charset=utf-8";
    }
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on("error", (err) => {
    console.error("[go2rtc proxy] HTTP error:", err.message);
    if (!res.headersSent) res.status(502).json({ error: "go2rtc unavailable" });
  });
  req.pipe(proxyReq, { end: true });
}

app.use("/api/ws", proxyToGo2rtc);
app.use("/video-rtc.js", proxyToGo2rtc);

// Proxy any other direct Go2RTC API endpoints (e.g., /api/stream.mp4, /stream.html)
app.use("/api/go2rtc", (req, res) => {
  const targetPath = req.originalUrl.replace("/api/go2rtc", "");
  const proxyReq = http.request({
    hostname: GO2RTC_HOST,
    port: GO2RTC_PORT,
    path: targetPath || "/",
    method: req.method,
    headers: { ...req.headers, host: `${GO2RTC_HOST}:${GO2RTC_PORT}` },
  }, (proxyRes) => {
    // Forward the response exactly as it is (including content-type, cache-control, etc)
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on("error", (err) => {
    console.error("[go2rtc proxy direct] HTTP error:", err.message);
    if (!res.headersSent) res.status(502).json({ error: "go2rtc unavailable" });
  });
  req.pipe(proxyReq, { end: true });
});

app.use("/api/setup", setupRoutes);
app.use("/api/auth", authRoutes);

// Poster endpoint harus sebelum requireAuth karena CSS background-image tidak bisa mengirim token
app.get("/api/streams/:id/poster", async (req, res, next) => {
  try {
    const id = req.params.id;
    const thumbnailDir = path.join(config.storageDir, "thumbnails");
    await fs.promises.mkdir(thumbnailDir, { recursive: true });
    const thumbnailPath = path.join(thumbnailDir, `${id}.jpg`);

    // Fire & Forget: ambil frame terbaru dari Go2RTC, kompres dengan Jimp, lalu simpan
    fetch(`http://127.0.0.1:1984/api/frame.jpeg?src=${id}`)
      .then(r => { if (r.ok) return r.arrayBuffer(); throw new Error("fail"); })
      .then(buf => Jimp.read(Buffer.from(buf)))
      .then(img => {
        if (img.bitmap.width > 800) img.resize({ w: 800 });
        return img.getBuffer("image/jpeg", { quality: 50 });
      })
      .then(outBuf => fs.promises.writeFile(thumbnailPath, outBuf))
      .catch((e) => { console.error("[Poster] Compress error:", e.message); });

    // Lazy load: jika file sudah ada, kirim langsung tanpa menunggu Go2RTC
    if (fs.existsSync(thumbnailPath)) {
      res.setHeader("Cache-Control", "no-cache");
      res.type("image/jpeg");
      return res.sendFile(thumbnailPath);
    }

    // Pertama kali: tunggu maks 2 detik
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 2000);
      const r = await fetch(`http://127.0.0.1:1984/api/frame.jpeg?src=${id}`, { signal: controller.signal });
      clearTimeout(tid);
      if (r.ok) {
        const buffer = Buffer.from(await r.arrayBuffer());
        fs.promises.writeFile(thumbnailPath, buffer).catch(() => {});
        res.setHeader("Cache-Control", "no-cache");
        res.type("image/jpeg");
        return res.send(buffer);
      }
    } catch (_) {}

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#0f172a"/><text x="400" y="225" font-family="sans-serif" font-size="20" fill="#475569" text-anchor="middle">No Snapshot Available</text></svg>`;
    res.setHeader("Cache-Control", "no-cache");
    res.type("image/svg+xml");
    return res.send(svg);
  } catch (err) { next(err); }
});

app.use("/api", requireAuth);
app.use("/api/cameras", cameraRoutes);
app.use("/api/users", userRoutes);
app.use("/api/streams", streamRoutes);
app.use("/api/stats", statRoutes);
app.use("/api/system", systemRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/events", eventRoutes);

if (fs.existsSync(config.frontendDist)) {
  app.use(express.static(config.frontendDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(config.frontendDist, "index.html"));
  });
}

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  const message = redactError(err?.message || "Internal server error");
  console.error(redactError(err));
  res.status(err.status || 500).json({ error: message });
});

await initializeAudit();
await initializeBlacklist();
await startTrafficHistory(() => getGlobalMetrics());

// Start automatic storage cleanup task (runs every 2 minutes)
void runStorageCleanup();
const cleanupInterval = setInterval(() => void runStorageCleanup(), 2 * 60 * 1000);

// Start background motion detection worker
startMotionDetectionWorker();

// Initial sync to go2rtc
const initialCameras = await listCameras({ revealSecret: true });
await syncGo2rtc(initialCameras);

const server = app.listen(config.port, config.host, () => {
  console.log(`CCTV Monitoring Lite backend running on http://${config.host}:${config.port}`);
  console.log(`Auth required: ${config.requireAuth}`);
  console.log(`CORS origins: ${config.corsOriginRaw}`);
  console.log(`Data dir: ${config.dataDir}`);
  console.log(`Storage dir: ${config.storageDir}`);
});

// ─── go2rtc WebSocket upgrade handler ──────────────────────────────
// Handle HTTP→WS upgrade for /api/ws paths by piping raw sockets to go2rtc.

server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/api/ws")) return;

  const proxySocket = net.connect(GO2RTC_PORT, GO2RTC_HOST, () => {
    // Build raw HTTP request to bypass Node's http module stripping hop-by-hop headers
    let rawReq = `${req.method} ${req.url} HTTP/1.1\r\n`;
    
    const headers = { ...req.headers };
    // Force explicitly to ensure Gorilla WS accepts it
    headers.connection = "Upgrade";
    headers.upgrade = "websocket";
    headers["x-forwarded-for"] = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        value.forEach(v => { rawReq += `${key}: ${v}\r\n`; });
      } else {
        rawReq += `${key}: ${value}\r\n`;
      }
    }
    rawReq += "\r\n";
    
    console.log("--- RAW WS REQUEST TO GO2RTC ---");
    console.log(rawReq);
    console.log("--------------------------------");
    
    proxySocket.write(rawReq);
    if (head && head.length) proxySocket.write(head);
    
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxySocket.on("error", (err) => {
    console.error("[go2rtc proxy] Raw WS error:", err.message);
    socket.destroy();
  });

  socket.on("error", () => proxySocket.destroy());
});


async function shutdown(signal) {
  console.log(`Received ${signal}, stopping streams...`);
  clearInterval(cleanupInterval);
  stopMotionDetectionWorker();
  try { await closeAudit(); } catch (err) { console.error(err); }
  try { await stopBlacklist(); } catch (err) { console.error(err); }
  try { await stopTrafficHistory(); } catch (err) { console.error(err); }
  try { await stopAllStreams(); } catch (err) { console.error(err); }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
