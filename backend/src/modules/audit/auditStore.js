import fs from "node:fs/promises";
import path from "node:path";
import { redactError } from "../../core/redact.js";

const SENSITIVE_KEYS = /password|token|authorization|secret|credential/i;

function sanitizeValue(value, key = "") {
  if (SENSITIVE_KEYS.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, childKey),
      ]),
    );
  }
  if (typeof value === "string") return redactError(value).slice(0, 1000);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return undefined;
}

function normalizeRecord(record, now) {
  return {
    id: record.id || `audit_${now.toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    ts: Number(record.ts || now),
    actor: {
      id: record.actor?.id || null,
      username: String(record.actor?.username || "anonymous").slice(0, 120),
      role: record.actor?.role || null,
    },
    action: String(record.action || "unknown").slice(0, 120),
    outcome: ["success", "warning", "failure"].includes(record.outcome)
      ? record.outcome
      : "success",
    target: record.target
      ? {
        type: String(record.target.type || "unknown").slice(0, 80),
        id: record.target.id ? String(record.target.id).slice(0, 160) : null,
        label: record.target.label ? String(record.target.label).slice(0, 200) : null,
      }
      : null,
    ip: record.ip ? String(record.ip).slice(0, 120) : null,
    userAgent: record.userAgent ? String(record.userAgent).slice(0, 300) : null,
    details: sanitizeValue(record.details || {}),
  };
}

export function createAuditStore({
  filePath,
  now = Date.now,
  retentionMs = 90 * 24 * 60 * 60_000,
  maxRecords = 100_000,
}) {
  let records = [];
  let writesSinceCompact = 0;
  let writeLock = Promise.resolve();

  function prune(reference = now()) {
    const cutoff = reference - retentionMs;
    records = records
      .filter((record) => Number(record?.ts) >= cutoff)
      .sort((a, b) => a.ts - b.ts)
      .slice(-maxRecords);
  }

  async function compact() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const content = records.map((record) => JSON.stringify(record)).join("\n");
    await fs.writeFile(filePath, content ? `${content}\n` : "", "utf8");
    writesSinceCompact = 0;
  }

  function queueWrite(operation) {
    const current = writeLock.then(operation);
    writeLock = current.then(() => undefined, () => undefined);
    return current;
  }

  return {
    async load() {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      try {
        const raw = await fs.readFile(filePath, "utf8");
        records = raw
          .split(/\r?\n/)
          .filter(Boolean)
          .flatMap((line) => {
            try {
              const parsed = JSON.parse(line);
              return Number.isFinite(Number(parsed?.ts)) ? [parsed] : [];
            } catch {
              return [];
            }
          });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        records = [];
      }
      prune();
      await compact();
    },

    add(record) {
      const normalized = normalizeRecord(record, now());
      records.push(normalized);
      prune(normalized.ts);
      writesSinceCompact += 1;
      return queueWrite(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        if (records.length >= maxRecords || writesSinceCompact >= 1000) {
          await compact();
        } else {
          await fs.appendFile(filePath, `${JSON.stringify(normalized)}\n`, "utf8");
        }
        return { ...normalized };
      });
    },

    query({ limit = 50, cursor, actor, action, outcome } = {}) {
      const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
      const actorQuery = String(actor || "").trim().toLowerCase();
      const actionQuery = String(action || "").trim().toLowerCase();
      let selected = [...records].reverse().filter((record) => {
        if (actorQuery) {
          const actorText = `${record.actor?.id || ""} ${record.actor?.username || ""}`.toLowerCase();
          if (!actorText.includes(actorQuery)) return false;
        }
        if (actionQuery && !record.action.toLowerCase().includes(actionQuery)) return false;
        if (outcome && record.outcome !== outcome) return false;
        return true;
      });
      if (cursor) {
        const cursorIndex = selected.findIndex((record) => record.id === cursor);
        selected = cursorIndex >= 0 ? selected.slice(cursorIndex + 1) : [];
      }
      const items = selected.slice(0, safeLimit);
      return {
        items: items.map((item) => ({ ...item })),
        nextCursor: selected.length > safeLimit ? items.at(-1)?.id || null : null,
      };
    },

    async flush() {
      await writeLock;
    },

    async clear() {
      return queueWrite(async () => {
        records = [];
        await compact();
        return true;
      });
    },

    async exportAll() {
      // Return plain JS array for JSON export
      return [...records].sort((a, b) => b.ts - a.ts);
    },
  };
}
