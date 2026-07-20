import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { parseDocument } from "yaml";
import { config } from "../core/config.js";

let turnSyncInterval = null;

export async function fetchTurnCredentials() {
  if (!config.cfTurnTokenId || !config.cfTurnApiToken) {
    return false;
  }
  
  try {
    const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${config.cfTurnTokenId}/credentials/generate-ice-servers`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.cfTurnApiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ttl: 86400 }) // 24 hours
    });
    
    if (!response.ok) {
      console.error("[cloudflareTurn] Failed to fetch credentials:", response.status, response.statusText);
      return false;
    }
    
    const data = await response.json();
    return data.iceServers;
  } catch (error) {
    console.error("[cloudflareTurn] Error fetching credentials:", error);
    return false;
  }
}

export async function updateGo2rtcTurnConfig() {
  const iceServers = await fetchTurnCredentials();
  if (!iceServers || iceServers.length === 0) {
    return;
  }

  try {
    const backendDir = path.resolve(config.dataDir, "..");
    const realYamlPath = path.join(backendDir, "go2rtc.yaml");
    
    let existingYaml = "";
    try {
      existingYaml = await fs.readFile(realYamlPath, "utf-8");
    } catch (e) {
      console.error("[cloudflareTurn] Error reading go2rtc.yaml:", e);
      return;
    }

    const doc = parseDocument(existingYaml);
    let webrtcNode = doc.get("webrtc");
    if (!webrtcNode) {
      doc.set("webrtc", doc.createNode({ listen: `:${config.go2rtcWebrtcPort}` }));
      webrtcNode = doc.get("webrtc");
    }

    // Merge standard STUN with new TURN servers
    const standardStun = { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] };
    
    // Cloudflare returns an array of objects like { urls, username, credential }
    webrtcNode.set("ice_servers", doc.createNode([standardStun, ...iceServers]));

    await fs.writeFile(realYamlPath, String(doc), "utf-8");
    console.log("[cloudflareTurn] Updated go2rtc.yaml with new TURN credentials");

    // Restart go2rtc if pm2 is available
    exec("pm2 restart cctv-go2rtc", (error) => {
      if (!error) {
        console.log("[cloudflareTurn] Restarted go2rtc to apply TURN config");
      }
    });

  } catch (error) {
    console.error("[cloudflareTurn] Failed to update config:", error);
  }
}

export function startTurnSync() {
  if (!config.cfTurnTokenId || !config.cfTurnApiToken) {
    console.log("[cloudflareTurn] Tokens not found, Cloudflare TURN sync disabled.");
    return;
  }
  
  // Run immediately on startup
  updateGo2rtcTurnConfig();
  
  // Run every 12 hours (43200000 ms)
  if (turnSyncInterval) clearInterval(turnSyncInterval);
  turnSyncInterval = setInterval(updateGo2rtcTurnConfig, 43200000);
  console.log("[cloudflareTurn] Cloudflare TURN sync scheduled every 12 hours.");
}
