import { getCamera, listCameras } from "./cameraService.js";

let OnvifCam = null;
try {
  const mod = await import("onvif");
  OnvifCam = mod.Cam || mod.default?.Cam;
} catch {
  OnvifCam = null;
}

export async function syncCameraDateAndTime(camera) {
  if (!OnvifCam) {
    return { success: false, error: "ONVIF module not installed" };
  }

  const host = camera.ip;
  if (!host) {
    return { success: false, error: "Camera IP missing" };
  }

  const port = Number(camera.onvifPort || camera.port || 80);
  const username = camera.username || "admin";
  const password = camera.password || "";

  return new Promise((resolve) => {
    let timeoutTimer;

    const finish = (result) => {
      clearTimeout(timeoutTimer);
      resolve(result);
    };

    timeoutTimer = setTimeout(() => {
      finish({ success: false, error: `ONVIF timeout connecting to ${host}:${port}` });
    }, 6000);

    try {
      const cam = new OnvifCam({
        hostname: host,
        port,
        username,
        password,
        timeout: 5000,
      }, function(err) {
        if (err) {
          return finish({ success: false, error: err.message || "Failed to initialize ONVIF" });
        }

        cam.getSystemDateAndTime((err, date) => {
          if (err || !date) {
            return finish({ success: false, error: err?.message || "Failed to get camera date/time" });
          }

          const camTime = new Date(date).getTime();
          const serverTime = Date.now();
          const driftSeconds = Math.round(Math.abs(serverTime - camTime) / 1000);

          // If drift is less than 3 seconds, camera is already synced
          if (driftSeconds < 3) {
            return finish({ success: true, driftSeconds, synced: false, message: "Camera clock is already in sync" });
          }

          const now = new Date();
          const timeParams = {
            dateTimeType: "Manual",
            daylightSavings: false,
            timeZone: { tz: "WIB-7" },
            dateTime: {
              utcDateTime: {
                date: {
                  year: now.getUTCFullYear(),
                  month: now.getUTCMonth() + 1,
                  day: now.getUTCDate(),
                },
                time: {
                  hour: now.getUTCHours(),
                  minute: now.getUTCMinutes(),
                  second: now.getUTCSeconds(),
                },
              },
            },
          };

          if (typeof cam.setSystemDateAndTime === "function") {
            cam.setSystemDateAndTime(timeParams, (err) => {
              if (err) {
                // Return drift info even if camera rejects SetSystemDateAndTime (some cameras restrict manual set)
                finish({ success: true, driftSeconds, synced: false, message: `Drift: ${driftSeconds}s (Camera restricted SetDateAndTime)` });
              } else {
                finish({ success: true, driftSeconds, synced: true, message: `Successfully synchronized camera clock (Drifted ${driftSeconds}s)` });
              }
            });
          } else {
            finish({ success: true, driftSeconds, synced: false, message: `Drift: ${driftSeconds}s` });
          }
        });
      });
    } catch (err) {
      finish({ success: false, error: err.message });
    }
  });
}

export async function syncAllCamerasTime() {
  const cameras = await listCameras({ revealSecret: true });
  const results = {};
  for (const cam of cameras) {
    if (cam.enabled && (cam.sourceType === "ONVIF" || cam.sourceType === "RTSP+ONVIF")) {
      results[cam.id] = await syncCameraDateAndTime(cam);
    }
  }
  return results;
}
