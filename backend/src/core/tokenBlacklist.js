import path from "node:path";
import { config } from "./config.js";
import { JsonStore } from "./jsonStore.js";

const blacklistStore = new JsonStore(path.join(config.dataDir, "blacklist.json"), []);
let cleanupInterval = null;

// Menginisialisasi blacklist dan memulai auto-cleanup
export async function initializeBlacklist() {
  await blacklistStore.read();
  if (cleanupInterval) clearInterval(cleanupInterval);
  cleanupInterval = setInterval(() => void runBlacklistCleanup(), 60 * 60 * 1000); // 1 jam sekali
}

export async function stopBlacklist() {
  if (cleanupInterval) clearInterval(cleanupInterval);
}

// Menambahkan token ke blacklist
export async function revokeToken(jti, exp) {
  if (!jti || !exp) return;
  await blacklistStore.update((list) => {
    // Hindari duplikasi
    if (list.some((item) => item.jti === jti)) return list;
    return [...list, { jti, exp }];
  });
}

// Memeriksa apakah token ada di blacklist
export async function isTokenRevoked(jti) {
  if (!jti) return false;
  const list = await blacklistStore.read();
  return list.some((item) => item.jti === jti);
}

// Menghapus token dari blacklist jika waktu exp-nya sudah terlewat
export async function runBlacklistCleanup() {
  const now = Math.floor(Date.now() / 1000);
  await blacklistStore.update((list) => {
    return list.filter((item) => item.exp > now);
  });
}
