import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAuditStore } from "../src/modules/audit/auditStore.js";

test("audit records are sanitized, filterable, persistent, and bounded", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cctv-audit-"));
  const filePath = path.join(dir, "audit.ndjson");
  let now = 1_700_000_000_000;
  const store = createAuditStore({
    filePath,
    now: () => now,
    retentionMs: 10_000,
    maxRecords: 3,
  });
  await store.load();

  await store.add({
    actor: { id: "u-1", username: "admin", role: "admin" },
    action: "auth.login",
    outcome: "success",
    target: { type: "user", id: "u-1", label: "admin" },
    details: {
      password: "must-not-leak",
      token: "top-secret",
      source: "rtsp://admin:camera-secret@10.0.0.8/live",
      fields: ["username"],
    },
  });
  now += 1000;
  await store.add({
    actor: { id: "u-2", username: "operator", role: "teknisi" },
    action: "camera.update",
    outcome: "success",
    target: { type: "camera", id: "cam-1", label: "Gate" },
  });
  now += 1000;
  await store.add({
    actor: { id: "u-2", username: "operator", role: "teknisi" },
    action: "ptz.command",
    outcome: "warning",
    target: { type: "camera", id: "cam-1", label: "Gate" },
    details: { command: "right", warningCode: "SOFT_RESPONSE_ERROR" },
  });
  now += 1000;
  await store.add({
    actor: { id: "u-1", username: "admin", role: "admin" },
    action: "user.update",
    outcome: "success",
    target: { type: "user", id: "u-2", label: "operator" },
  });

  const page = store.query({ limit: 2, actor: "operator" });
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].action, "ptz.command");
  assert.equal(page.nextCursor, null);

  const persisted = await readFile(filePath, "utf8");
  assert.doesNotMatch(persisted, /must-not-leak|top-secret|camera-secret/);

  const reloaded = createAuditStore({
    filePath,
    now: () => now,
    retentionMs: 10_000,
    maxRecords: 3,
  });
  await reloaded.load();
  const all = reloaded.query({ limit: 10 });
  assert.equal(all.items.length, 3);
  assert.equal(all.items[0].action, "user.update");
});

test("audit cursor returns the next older page", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cctv-audit-cursor-"));
  const store = createAuditStore({
    filePath: path.join(dir, "audit.ndjson"),
    now: () => 1_700_000_000_000,
  });
  await store.load();

  await store.add({ action: "one", outcome: "success" });
  await store.add({ action: "two", outcome: "success" });
  await store.add({ action: "three", outcome: "success" });

  const first = store.query({ limit: 2 });
  const second = store.query({ limit: 2, cursor: first.nextCursor });

  assert.deepEqual(first.items.map((item) => item.action), ["three", "two"]);
  assert.deepEqual(second.items.map((item) => item.action), ["one"]);
});
