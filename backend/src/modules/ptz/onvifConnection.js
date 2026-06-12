function profileToken(cam) {
  return cam?.activeSource?.profileToken
    || cam?.profiles?.[0]?.token
    || cam?.profiles?.[0]?.$?.token
    || cam?.profiles?.[0]?.profileToken
    || undefined;
}

function cameraOptions(camera, extra = {}) {
  return {
    hostname: camera.ip,
    username: camera.username || "admin",
    password: camera.password || "",
    port: Number(camera.onvifPort || 80),
    timeout: Math.max(2500, Math.min(15000, Number(process.env.PTZ_SOCKET_TIMEOUT_MS || 5000))),
    preserveAddress: true,
    ...extra,
  };
}

function callbackCall(target, method, ...args) {
  return new Promise((resolve, reject) => {
    if (typeof target?.[method] !== "function") {
      reject(new Error(`ONVIF method ${method} tidak tersedia`));
      return;
    }
    target[method](...args, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

async function initializeWithServerClock(cam) {
  try {
    await callbackCall(cam, "getServices", true);
  } catch {
    await callbackCall(cam, "getCapabilities");
  }

  const tasks = [];
  if (typeof cam.getProfiles === "function") tasks.push(callbackCall(cam, "getProfiles"));
  if (typeof cam.getVideoSources === "function") tasks.push(callbackCall(cam, "getVideoSources"));
  await Promise.all(tasks);
  if (typeof cam.getActiveSources === "function") cam.getActiveSources();
}

export function createOnvifConnector({
  Cam,
  now = Date.now,
  uptime = process.uptime,
  connectTimeoutMs = Number(process.env.PTZ_CONNECT_TIMEOUT_MS || 9000),
}) {
  async function standard(camera) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("ONVIF connection timeout"));
      }, Math.max(3000, Math.min(20000, Number(connectTimeoutMs))));
      timer.unref?.();

      try {
        new Cam(cameraOptions(camera), function onReady(error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(this);
        });
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async function authenticatedClock(camera) {
    const cam = new Cam(cameraOptions(camera, { autoconnect: false }));
    cam.timeShift = now() - (uptime() * 1000);
    await initializeWithServerClock(cam);
    return cam;
  }

  return {
    async connect(camera) {
      if (!Cam) throw new Error("Dependency ONVIF belum terinstall");
      if (!camera?.ip) throw new Error("IP kamera belum diisi");

      try {
        const cam = await standard(camera);
        return {
          cam,
          mode: "standard",
          profileToken: profileToken(cam) || null,
          profiles: cam.profiles?.length || 0,
        };
      } catch (standardError) {
        try {
          const cam = await authenticatedClock(camera);
          return {
            cam,
            mode: "ws-security-time-shift",
            profileToken: profileToken(cam) || null,
            profiles: cam.profiles?.length || 0,
            standardError: standardError?.message || String(standardError),
          };
        } catch (fallbackError) {
          fallbackError.cause = standardError;
          throw fallbackError;
        }
      }
    },
  };
}

function connectionKey(camera) {
  return [
    camera.id,
    camera.ip,
    camera.onvifPort || 80,
    camera.username || "admin",
    camera.password || "",
  ].join(":");
}

export function createOnvifConnectionManager({
  connect,
  ttlMs = Number(process.env.PTZ_CLIENT_CACHE_MS || 10 * 60_000),
}) {
  const cache = new Map();

  return {
    get(camera) {
      const key = connectionKey(camera);
      const cached = cache.get(key);
      const maxAge = Math.max(60_000, Number(ttlMs));
      if (cached && Date.now() - cached.createdAt < maxAge) return cached.promise;
      if (cached) cache.delete(key);

      const promise = Promise.resolve()
        .then(() => connect(camera))
        .catch((error) => {
          if (cache.get(key)?.promise === promise) cache.delete(key);
          throw error;
        });
      cache.set(key, { promise, createdAt: Date.now(), cameraId: camera.id });
      return promise;
    },

    clear(cameraId = "") {
      if (!cameraId) {
        cache.clear();
        return;
      }
      for (const [key, value] of cache) {
        if (value.cameraId === cameraId) cache.delete(key);
      }
    },
  };
}
