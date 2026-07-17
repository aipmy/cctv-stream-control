import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStore } from "../src/core/jsonStore.js";
import { createUserService } from "../src/modules/users/userService.js";

async function makeService() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cctv-users-"));
  const file = path.join(dir, "users.json");
  const store = new JsonStore(file, []);
  return { file, service: createUserService({ store }) };
}

test("fresh user storage is empty until the first admin is created", async () => {
  const { service } = await makeService();

  assert.deepEqual(await service.setupStatus(), { required: true });
  assert.deepEqual(await service.listUsers(), []);
});

test("first admin setup is atomic and can only run once", async () => {
  const { service } = await makeService();

  const created = await service.createInitialAdmin({
    username: "owner",
    password: "rahasia-ku",
  });

  assert.equal(created.user.username, "owner");
  assert.equal(created.user.role, "admin");
  assert.equal(created.user.password, undefined);
  assert.equal(typeof created.token, "string");
  assert.deepEqual(await service.setupStatus(), { required: false });

  await assert.rejects(
    service.createInitialAdmin({ username: "other", password: "password" }),
    (error) => error?.status === 409,
  );

  const login = await service.login("owner", "rahasia-ku");
  assert.equal(login.ok, true);
  const operator = await service.createUser({
    username: "operator",
    password: "operator-secret",
    role: "guest",
  });
  assert.equal(operator.username, "operator");
});

test("user responses never expose passwords and blank update preserves the stored password", async () => {
  const { file, service } = await makeService();
  const created = await service.createInitialAdmin({
    username: "admin",
    password: "secret-one",
  });

  const updated = await service.updateUser(created.user.id, {
    username: "admin",
    password: "",
  });
  const stored = JSON.parse(await readFile(file, "utf8"));

  assert.equal(updated.password, undefined);
  assert.equal(stored[0].password, "secret-one");
  assert.equal((await service.listUsers())[0].password, undefined);
});

test("legacy users receive empty preferences and pinned cameras are normalized", async () => {
  const { service } = await makeService();
  const created = await service.createInitialAdmin({
    username: "admin",
    password: "secret-one",
  });

  assert.deepEqual(created.user.preferences, { pinnedCameraIds: [] });

  const updated = await service.updatePreferences(created.user.id, {
    pinnedCameraIds: ["cam-2", "cam-1", "cam-2", "", 42],
  });

  assert.deepEqual(updated.preferences, {
    pinnedCameraIds: ["cam-2", "cam-1"],
  });
  assert.deepEqual((await service.getUserById(created.user.id)).preferences, {
    pinnedCameraIds: ["cam-2", "cam-1"],
  });
});

test("users can change their own password only with the current password", async () => {
  const { service } = await makeService();
  const created = await service.createInitialAdmin({
    username: "admin",
    password: "secret-one",
  });

  await assert.rejects(
    service.changePassword(created.user.id, "wrong-password", "secret-two"),
    (error) => error?.status === 400,
  );

  const changed = await service.changePassword(
    created.user.id,
    "secret-one",
    "secret-two",
  );
  assert.equal(changed.username, "admin");
  assert.equal(changed.password, undefined);
  await assert.rejects(service.login("admin", "secret-one"), (err) => err?.status === 401);
  assert.equal((await service.login("admin", "secret-two")).ok, true);
});
