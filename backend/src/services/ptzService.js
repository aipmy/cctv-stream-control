import { createRequire } from "node:module";
import { createKeyedCommandQueue } from "../modules/ptz/commandQueue.js";
import {
  createOnvifConnector,
  createOnvifConnectionManager,
} from "../modules/ptz/onvifConnection.js";
import { createPtzController } from "../modules/ptz/ptzController.js";
import { redactError } from "../core/redact.js";

const require = createRequire(import.meta.url);
let OnvifCam = null;
try {
  ({ Cam: OnvifCam } = require("onvif"));
} catch {
  OnvifCam = null;
}

function normalizeOnvifError(error, camera) {
  const raw = redactError(error);
  const lower = raw.toLowerCase();
  if (lower.includes("econnrefused")) {
    return new Error(`ONVIF ditolak oleh kamera. Cek port ${camera.onvifPort || camera.port || 80}.`);
  }
  if (lower.includes("timeout") || lower.includes("etimedout")) {
    return new Error(`ONVIF timeout ke ${camera.ip}:${camera.onvifPort || camera.port || 80}.`);
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("not authorized")) {
    return new Error("ONVIF login gagal. Cek username, password, dan permission PTZ.");
  }
  if (lower.includes("socket hang up") || lower.includes("econnreset")) {
    return new Error("ONVIF socket terputus saat koneksi/discovery kamera.");
  }
  return new Error(raw.split("\n")[0].slice(0, 500));
}

const connector = createOnvifConnector({ Cam: OnvifCam });
const connections = createOnvifConnectionManager({
  connect: (camera) => connector.connect(camera),
});
const controller = createPtzController({
  connections,
  queue: createKeyedCommandQueue(),
});

export async function sendPtzCommand(camera, action = "stop", options = {}) {
  try {
    return await controller.send(camera, action, options);
  } catch (error) {
    const normalized = normalizeOnvifError(error, camera);
    normalized.status = error?.status || 500;
    throw normalized;
  }
}

export async function testPtzConnection(camera) {
  try {
    connections.clear(camera.id);
    return await controller.test(camera);
  } catch (error) {
    const normalized = normalizeOnvifError(error, camera);
    normalized.status = error?.status || 500;
    throw normalized;
  }
}

export function clearPtzCache(cameraId = "") {
  connections.clear(cameraId);
}
