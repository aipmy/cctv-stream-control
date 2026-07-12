import { Router } from "express";
import onvif from "node-onvif";
import { requireRole } from "../middleware/auth.js";

export const onvifRoutes = Router();

// Endpoint to discover ONVIF cameras on the local network
onvifRoutes.get("/discover", requireRole("admin"), async (req, res, next) => {
  try {
    const devices = await onvif.startProbe();
    
    const cameras = devices.map(device => {
      let ip = "Unknown";
      if (device.xaddrs && device.xaddrs.length > 0) {
        try {
          const url = new URL(device.xaddrs[0]);
          ip = url.hostname;
        } catch (e) {
          // fallback if not a valid URL format somehow
          ip = device.xaddrs[0];
        }
      }
      return {
        urn: device.urn,
        name: device.name || "Unknown ONVIF Camera",
        hardware: device.hardware || "Unknown",
        location: device.location || "Unknown",
        xaddrs: device.xaddrs,
        ip
      };
    });

    res.json({ cameras });
  } catch (err) {
    next(err);
  }
});

// Endpoint to get RTSP streams from a specific ONVIF camera given credentials
onvifRoutes.post("/profiles", requireRole("admin"), async (req, res, next) => {
  try {
    const { xaddr, user, pass } = req.body;
    if (!xaddr) return res.status(400).json({ error: "Missing xaddr" });
    
    const device = new onvif.OnvifDevice({
      xaddr,
      user: user || "",
      pass: pass || ""
    });

    await device.init();
    
    const profileList = device.getProfileList();
    const streams = profileList.map(p => {
      return {
        name: p.name,
        resolution: p.video && p.video.resolution ? `${p.video.resolution.width}x${p.video.resolution.height}` : "Unknown",
        rtspUrl: p.stream ? p.stream.rtsp : ""
      };
    });

    res.json({ streams, info: device.getInformation() });
  } catch (err) {
    console.error("ONVIF error:", err);
    res.status(500).json({ error: err.message || "Failed to communicate with ONVIF device" });
  }
});
