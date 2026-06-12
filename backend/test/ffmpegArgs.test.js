import assert from "node:assert/strict";
import test from "node:test";
import { buildHlsArgs } from "../src/stream/ffmpegArgs.js";

test("transcode HLS lets x264 select a compatible level for full-HD sources", () => {
  const args = buildHlsArgs({
    camera: {
      id: "cam-full-hd",
      sourceType: "RTSP+ONVIF",
      streamType: "HLS Low Latency",
      hlsMode: "transcode",
      rtspTransport: "tcp",
      ip: "10.0.0.8",
      rtspPort: 8554,
      sourcePath: "/Streaming/Channels/101",
      username: "admin",
      password: "secret",
      enableAudio: true,
    },
    output: "HLS Low Latency",
    dir: "/tmp/hls/cam-full-hd",
    options: {
      ffmpegLogLevel: "warning",
      streamProfile: "copy",
      rtspTransport: "tcp",
      rtspTimeoutOption: "none",
      streamReadTimeoutUs: 0,
    },
  });

  assert.equal(args.includes("-level"), false);
  assert.equal(args.includes("3.1"), false);
  assert.equal(args.includes("baseline"), true);
  assert.equal(args.includes("libx264"), true);
});
