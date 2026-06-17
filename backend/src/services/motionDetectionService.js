import { listCameras } from "./cameraService.js";
import { startHls } from "../stream/streamManager.js";

let monitorInterval = null;

export function startMotionDetectionWorker() {
  if (monitorInterval) return;

  // Run the checker loop every 10 seconds
  monitorInterval = setInterval(() => void checkSmartCameras(), 10000);
  void checkSmartCameras();
  console.log("[Motion Detection] Service initialized successfully.");
}

export function stopMotionDetectionWorker() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  console.log("[Motion Detection] Service stopped.");
}

async function checkSmartCameras() {
  try {
    const cameras = await listCameras({ revealSecret: true });

    for (const camera of cameras) {
      const isSmartEnabled = camera.enabled && (camera.enableRecording || camera.enableNotifications);
      if (isSmartEnabled) {
        // 1. Ensure HLS stream is running continuously for pre-recording buffer
        // Note: startHls will return the existing session if it's already active.
        try {
          const session = await startHls(camera.id, camera.streamType);
          if (session) {
            session.keepAlive = true;
          }
        } catch (err) {
          console.error(`[Motion Detection] HLS failed to start for ${camera.name} (${camera.id}):`, err.message);
        }
      }
    }
  } catch (err) {
    console.error("[Motion Detection] Error in smart camera check loop:", err);
  }
}
