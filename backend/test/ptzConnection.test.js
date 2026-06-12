import assert from "node:assert/strict";
import test from "node:test";
import {
  createOnvifConnector,
  createOnvifConnectionManager,
} from "../src/modules/ptz/onvifConnection.js";

test("connector falls back to authenticated server clock when standard connect is reset", async () => {
  const instances = [];
  class FakeCam {
    constructor(options, callback) {
      this.options = options;
      this.profiles = [{ $: { token: "profile-1" } }];
      this.videoSources = { $: { token: "source-1" } };
      instances.push(this);
      if (options.autoconnect !== false) {
        setImmediate(() => callback(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })));
      }
    }

    getServices(_includeCapability, callback) {
      this.uri = { media: { href: "http://camera/onvif/media" } };
      setImmediate(() => callback(null));
    }

    getProfiles(callback) {
      setImmediate(() => callback(null));
    }

    getVideoSources(callback) {
      setImmediate(() => callback(null));
    }

    getActiveSources() {
      this.activeSource = { profileToken: "profile-1", ptz: { token: "ptz-1" } };
    }
  }

  const connector = createOnvifConnector({
    Cam: FakeCam,
    now: () => 1_700_000_000_000,
    uptime: () => 10,
  });
  const result = await connector.connect({
    id: "cam-1",
    ip: "10.0.0.8",
    onvifPort: 8000,
    username: "admin",
    password: "secret",
  });

  assert.equal(instances.length, 2);
  assert.equal(result.mode, "ws-security-time-shift");
  assert.equal(result.profileToken, "profile-1");
  assert.equal(instances[1].timeShift, 1_699_999_990_000);
  assert.equal(instances[1].options.autoconnect, false);
});

test("connection manager shares in-flight connections and evicts failures", async () => {
  let calls = 0;
  let rejectNext = false;
  const manager = createOnvifConnectionManager({
    connect: async () => {
      calls += 1;
      if (rejectNext) throw new Error("connect failed");
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { cam: {}, mode: "standard", profileToken: "p1" };
    },
    ttlMs: 60_000,
  });
  const camera = { id: "cam-1", ip: "10.0.0.8", onvifPort: 80, username: "a", password: "b" };

  const [first, second] = await Promise.all([manager.get(camera), manager.get(camera)]);
  assert.equal(first, second);
  assert.equal(calls, 1);

  manager.clear(camera.id);
  rejectNext = true;
  await assert.rejects(manager.get(camera), /connect failed/);
  rejectNext = false;
  await manager.get(camera);
  assert.equal(calls, 3);
});
