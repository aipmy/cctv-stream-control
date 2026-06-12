import assert from "node:assert/strict";
import test from "node:test";
import { createKeyedCommandQueue } from "../src/modules/ptz/commandQueue.js";
import { createPtzController } from "../src/modules/ptz/ptzController.js";

test("keyed command queue serializes commands for one camera", async () => {
  const queue = createKeyedCommandQueue();
  const events = [];

  const first = queue.run("cam-1", async () => {
    events.push("first:start");
    await new Promise((resolve) => setTimeout(resolve, 15));
    events.push("first:end");
  });
  const second = queue.run("cam-1", async () => {
    events.push("second:start");
    events.push("second:end");
  });

  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("controller reports socket reset as warning only after command dispatch", async () => {
  let moveCalls = 0;
  const cam = {
    activeSource: { profileToken: "profile-1" },
    continuousMove(_payload, callback) {
      moveCalls += 1;
      setImmediate(() => callback(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })));
    },
    stop(_payload, callback) {
      setImmediate(() => callback(null, { ok: true }));
    },
  };
  const controller = createPtzController({
    connections: {
      get: async () => ({
        cam,
        mode: "ws-security-time-shift",
        profileToken: "profile-1",
        profiles: 1,
      }),
    },
    queue: createKeyedCommandQueue(),
    scheduleStop: () => {},
  });
  const camera = {
    id: "cam-1",
    enabled: true,
    enablePTZ: true,
    sourceType: "RTSP+ONVIF",
  };

  const result = await controller.send(camera, "right", { duration: 200 });

  assert.equal(moveCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "ws-security-time-shift");
  assert.equal(result.warning.code, "SOFT_RESPONSE_ERROR");
});

test("controller does not soften connection failures", async () => {
  const controller = createPtzController({
    connections: { get: async () => { throw new Error("socket hang up"); } },
    queue: createKeyedCommandQueue(),
  });

  await assert.rejects(
    controller.send({
      id: "cam-1",
      enabled: true,
      enablePTZ: true,
      sourceType: "RTSP+ONVIF",
    }, "left"),
    /socket hang up/,
  );
});
