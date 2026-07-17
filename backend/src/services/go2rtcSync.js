import fs from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { config } from "../core/config.js";

// Keep track of what we've synced so we can delete old ones
let lastSyncedIds = new Set();

export async function syncGo2rtc(cameras) {
  try {
    const backendDir = path.resolve(config.dataDir, "..");
    const realYamlPath = path.join(backendDir, "go2rtc.yaml");

    // 1. Read existing YAML
    let existingYaml = "";
    try {
      existingYaml = await fs.readFile(realYamlPath, "utf-8");
    } catch (e) {
      existingYaml = "streams:\n";
    }

    const doc = parseDocument(existingYaml);
    
    let streamsNode = doc.get("streams");
    if (!streamsNode) {
      doc.set("streams", doc.createNode({}));
      streamsNode = doc.get("streams");
    }

    // Ensure default settings exist if not manually overridden
    if (!doc.has("api")) {
      doc.set("api", doc.createNode({ listen: ":1984", origin: "*" }));
    }
    if (!doc.has("webrtc")) {
      doc.set("webrtc", doc.createNode({ listen: ":8555" }));
    }
    if (!doc.has("rtsp")) {
      doc.set("rtsp", doc.createNode({ listen: ":8554" }));
    }

    const currentIds = new Set();

    // 2. Remove all unknown or old cameras from AST to keep it clean
    const activeCameraIds = new Set(cameras.filter(c => c.enabled).map(c => c.id));
    
    // We iterate over all keys in the `streams` section and delete them if they aren't in activeCameraIds
    if (streamsNode && streamsNode.items) {
      const keysToRemove = [];
      for (const item of streamsNode.items) {
        const key = item.key.value;
        if (!activeCameraIds.has(key)) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        streamsNode.delete(key);
      }
    }

    // 3. Add/update current cameras in AST using the pre-built streamUrl
    for (const cam of cameras) {
      if (!cam.enabled) {
        streamsNode.delete(cam.id);
        continue;
      }
      
      currentIds.add(cam.id);
      // streamUrl is already built by normalizeCamera with all audio flags etc.
      const finalUrl = cam.streamUrl || "";
      streamsNode.set(cam.id, finalUrl);
    }

    // 4. Write back YAML preserving comments and other sections
    await fs.writeFile(realYamlPath, String(doc), "utf-8");
    console.log(`[go2rtcSync] Updated ${currentIds.size} streams in ${realYamlPath} safely`);

    // 5. Sync to running go2rtc instance via API
    for (const oldId of lastSyncedIds) {
      if (!currentIds.has(oldId)) {
        try {
          await fetch(`http://127.0.0.1:1984/api/streams?src=${encodeURIComponent(oldId)}`, { method: "DELETE" });
          console.log(`[go2rtcSync] Deleted stream ${oldId} from running go2rtc`);
        } catch (e) {}
      }
    }

    for (const cam of cameras) {
      if (!cam.enabled) {
        try {
          await fetch(`http://127.0.0.1:1984/api/streams?src=${encodeURIComponent(cam.id)}`, { method: "DELETE" });
        } catch(e) {}
        continue;
      }
      
      const finalUrl = cam.streamUrl || "";

      try {
        const url = `http://127.0.0.1:1984/api/streams?name=${encodeURIComponent(cam.id)}&src=${encodeURIComponent(finalUrl)}`;
        await fetch(url, { method: "PUT" });
      } catch (e) {}
    }

    lastSyncedIds = currentIds;
  } catch (error) {
    console.error("[go2rtcSync] Failed to sync go2rtc config:", error);
  }
}
