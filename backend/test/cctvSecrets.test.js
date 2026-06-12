import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCamera, publicCamera } from "../src/core/cctv.js";

test("public camera replaces password with hasPassword metadata", () => {
  const camera = normalizeCamera({
    id: "cam-1",
    name: "Gate",
    ip: "10.0.0.8",
    username: "admin",
    password: "camera-secret",
  });

  const result = publicCamera(camera);

  assert.equal(result.password, undefined);
  assert.equal(result.hasPassword, true);
  assert.doesNotMatch(result.rtspUrl, /camera-secret/);
});

test("camera password update semantics preserve, replace, and clear explicitly", () => {
  const existing = normalizeCamera({
    id: "cam-1",
    name: "Gate",
    ip: "10.0.0.8",
    password: "old-secret",
  });

  const preserved = normalizeCamera({ name: "Gate 2", password: "" }, existing);
  const replaced = normalizeCamera({ password: "new-secret" }, existing);
  const cleared = normalizeCamera({ clearPassword: true }, existing);

  assert.equal(preserved.password, "old-secret");
  assert.equal(replaced.password, "new-secret");
  assert.equal(cleared.password, "");
});
