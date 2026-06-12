function isSoftResponseError(error) {
  const value = String(error?.code || error?.message || error || "").toLowerCase();
  return value.includes("econnreset")
    || value.includes("socket hang up")
    || value.includes("network timeout")
    || value.includes("etimedout");
}

function cleanPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

function velocityFor(action, speed) {
  const value = Math.max(0.05, Math.min(1, Number(speed || 0.35)));
  const values = {
    up: { x: 0, y: value, zoom: 0 },
    down: { x: 0, y: -value, zoom: 0 },
    left: { x: -value, y: 0, zoom: 0 },
    right: { x: value, y: 0, zoom: 0 },
    upLeft: { x: -value, y: value, zoom: 0 },
    upRight: { x: value, y: value, zoom: 0 },
    downLeft: { x: -value, y: -value, zoom: 0 },
    downRight: { x: value, y: -value, zoom: 0 },
    zoomIn: { x: 0, y: 0, zoom: value },
    zoomOut: { x: 0, y: 0, zoom: -value },
  };
  return values[action] || { x: 0, y: 0, zoom: 0 };
}

function invoke(cam, method, payload, { timeoutMs, softenResponse = false } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let dispatched = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error(`${method} timeout`);
      if (softenResponse && dispatched) {
        resolve({
          ok: true,
          warning: { code: "SOFT_RESPONSE_ERROR", message: error.message },
        });
      } else {
        reject(error);
      }
    }, Math.max(500, Number(timeoutMs || 1800)));
    timer.unref?.();

    const done = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        if (softenResponse && dispatched && isSoftResponseError(error)) {
          resolve({
            ok: true,
            warning: {
              code: "SOFT_RESPONSE_ERROR",
              message: error.message || String(error),
            },
          });
        } else {
          reject(error);
        }
        return;
      }
      resolve(result || { ok: true });
    };

    try {
      if (typeof cam?.[method] !== "function") throw new Error(`ONVIF method ${method} tidak tersedia`);
      if (payload === undefined) cam[method](done);
      else cam[method](payload, done);
      dispatched = true;
    } catch (error) {
      clearTimeout(timer);
      settled = true;
      reject(error);
    }
  });
}

function validateCamera(camera) {
  if (!camera?.enabled) {
    const error = new Error("Kamera nonaktif");
    error.status = 409;
    throw error;
  }
  if (!camera.enablePTZ || camera.sourceType !== "RTSP+ONVIF") {
    const error = new Error("PTZ hanya tersedia untuk kamera RTSP+ONVIF dengan PTZ aktif");
    error.status = 400;
    throw error;
  }
}

export function createPtzController({
  connections,
  queue,
  scheduleStop = (callback, delay) => {
    const timer = setTimeout(callback, delay);
    timer.unref?.();
  },
  commandTimeoutMs = Number(process.env.PTZ_COMMAND_TIMEOUT_MS || 1800),
}) {
  async function stop(connection) {
    const payload = cleanPayload({
      profileToken: connection.profileToken,
      panTilt: true,
      zoom: true,
    });
    return invoke(connection.cam, "stop", payload, {
      timeoutMs: commandTimeoutMs,
      softenResponse: true,
    });
  }

  async function execute(camera, action, options = {}) {
    const connection = await connections.get(camera);
    const common = {
      ok: true,
      action,
      mode: connection.mode,
      profileToken: connection.profileToken || null,
      profiles: connection.profiles || 0,
    };

    if (action === "stop") {
      const result = await stop(connection);
      return { ...common, message: "PTZ stop", warning: result.warning || null };
    }

    if (action === "home") {
      const result = await invoke(
        connection.cam,
        "gotoHomePosition",
        cleanPayload({ profileToken: connection.profileToken }),
        { timeoutMs: commandTimeoutMs, softenResponse: true },
      );
      return { ...common, message: "PTZ home", warning: result.warning || null };
    }

    const duration = Math.max(120, Math.min(2500, Number(options.duration || process.env.PTZ_MOVE_DURATION_MS || 650)));
    const velocity = velocityFor(action, options.speed || camera.ptzSpeed || process.env.PTZ_SPEED);
    const isZoom = action === "zoomIn" || action === "zoomOut";
    const result = await invoke(connection.cam, "continuousMove", cleanPayload({
      profileToken: connection.profileToken,
      x: velocity.x,
      y: velocity.y,
      zoom: velocity.zoom,
      timeout: duration,
      onlySendPanTilt: !isZoom,
      onlySendZoom: isZoom,
    }), {
      timeoutMs: commandTimeoutMs,
      softenResponse: true,
    });

    scheduleStop(() => {
      queue.run(camera.id, async () => {
        const current = await connections.get(camera);
        await stop(current);
      }).catch(() => undefined);
    }, duration + 120);

    return {
      ...common,
      message: `PTZ ${action}`,
      velocity,
      duration,
      warning: result.warning || null,
    };
  }

  return {
    send(camera, action, options) {
      validateCamera(camera);
      return queue.run(camera.id, () => execute(camera, action, options));
    },

    async test(camera) {
      validateCamera(camera);
      const connection = await connections.get(camera);
      return {
        ok: true,
        message: "ONVIF PTZ connected",
        mode: connection.mode,
        profileToken: connection.profileToken || null,
        profiles: connection.profiles || 0,
        warning: connection.standardError
          ? { code: "STANDARD_CONNECT_FAILED", message: connection.standardError }
          : null,
      };
    },
  };
}
