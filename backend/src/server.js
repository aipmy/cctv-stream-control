import fs from "node:fs";
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
import { stopAllStreams, streamSystemMetrics } from "./stream/streamManager.js";
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
  tokens.method(req, res),
  sanitizeRequestUrl(tokens.url(req, res)),
  tokens.status(req, res),
  `${tokens["response-time"](req, res)} ms`,
].join(" ")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "CCTV Monitoring Lite Backend", port: config.port, auth: config.requireAuth, time: new Date().toISOString() });
});

app.use("/api/setup", setupRoutes);
app.use("/api/auth", authRoutes);
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
await startTrafficHistory(() => streamSystemMetrics());

// Start automatic storage cleanup task (runs every 2 minutes)
void runStorageCleanup();
const cleanupInterval = setInterval(() => void runStorageCleanup(), 2 * 60 * 1000);

// Start background motion detection worker
startMotionDetectionWorker();

const server = app.listen(config.port, config.host, () => {
  console.log(`CCTV Monitoring Lite backend running on http://${config.host}:${config.port}`);
  console.log(`Auth required: ${config.requireAuth}`);
  console.log(`CORS origins: ${config.corsOriginRaw}`);
  console.log(`Data dir: ${config.dataDir}`);
  console.log(`Storage dir: ${config.storageDir}`);
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
