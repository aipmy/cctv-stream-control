import path from "node:path";
import { config } from "../../core/config.js";
import { redactError } from "../../core/redact.js";
import { createAuditStore } from "./auditStore.js";

const store = createAuditStore({
  filePath: path.join(config.dataDir, "audit.ndjson"),
  retentionMs: config.auditRetentionMs,
  maxRecords: config.auditMaxRecords,
});

let initialized = false;

export async function initializeAudit() {
  if (initialized) return;
  await store.load();
  initialized = true;
}

export async function closeAudit() {
  if (!initialized) return;
  await store.flush();
}

export function listAudit(query) {
  return store.query(query);
}

function requestActor(req, override) {
  const actor = override || req?.auth || {};
  return {
    id: actor.id || actor.sub || null,
    username: actor.username || "anonymous",
    role: actor.role || null,
  };
}

export async function auditRequest(req, event) {
  try {
    await initializeAudit();
    return await store.add({
      ...event,
      actor: requestActor(req, event.actor),
      ip: req?.ip || req?.socket?.remoteAddress || null,
      userAgent: req?.get?.("user-agent") || req?.headers?.["user-agent"] || null,
    });
  } catch (error) {
    console.error(`Audit write failed: ${redactError(error).split("\n")[0]}`);
    return null;
  }
}

export function changedFields(payload, allowlist) {
  if (!payload || typeof payload !== "object") return [];
  const allowed = new Set(allowlist);
  return Object.keys(payload).filter((key) => allowed.has(key)).sort();
}

export async function clearAudit() {
  await initializeAudit();
  return store.clear();
}

export async function exportAudit() {
  await initializeAudit();
  return store.exportAll();
}
