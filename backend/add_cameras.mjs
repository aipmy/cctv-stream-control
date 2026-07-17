import { createCamera } from "./src/services/cameraService.js";

async function addCameras() {
  try {
    await createCamera({
      name: "Indoor",
      sourceType: "ONVIF",
      ip: "172.16.50.252",
      onvifPort: 8000,
      username: "admin",
      password: "tamvan123",
      audioMode: "backchannel",
      enablePTZ: true,
      enabled: true
    });
    console.log("Added Indoor camera");

    await createCamera({
      name: "Outdoor",
      sourceType: "RTSP",
      ip: "172.16.50.253",
      rtspPort: 8554,
      streamPath: "/Streaming/Channels/101",
      username: "admin",
      password: "tamvan123",
      audioMode: "none",
      enablePTZ: false,
      enabled: true
    });
    console.log("Added Outdoor camera");
  } catch (err) {
    console.error(err);
  }
}
addCameras();
