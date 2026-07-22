import { listCameras } from "./cameraService.js";
import { startAiStream, startRecordingOnly } from "../stream/streamManager.js";

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
      if (!camera.enabled) continue;

      const needsSmartDetection = camera.enableSmartDetection && (camera.enableRecording || camera.enableNotifications);
      const needsRecordingOnly = !camera.enableSmartDetection && camera.enableRecording;

      if (needsSmartDetection) {
        // Camera needs AI/motion detection + recording → start full AI stream (MJPEG capture + recording)
        try {
          const session = await startAiStream(camera.id);
          if (session) {
            session.keepAlive = true;
          }
        } catch (err) {
          console.error(`[Motion Detection] AI stream failed to start for ${camera.name} (${camera.id}):`, err.message);
        }
      } else if (needsRecordingOnly) {
        // Camera only needs recording, NO smart detection → start lightweight recording (no MJPEG/AI overhead)
        try {
          await startRecordingOnly(camera);
        } catch (err) {
          console.error(`[Motion Detection] Recording failed to start for ${camera.name} (${camera.id}):`, err.message);
        }
      }
    }
  } catch (err) {
    console.error("[Motion Detection] Error in smart camera check loop:", err);
  }
}
