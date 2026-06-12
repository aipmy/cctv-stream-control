import assert from "node:assert/strict";
import test from "node:test";
import { classifyStreamError } from "../src/stream/streamError.js";

test("encoder errors become a short public message without FFmpeg command details", () => {
  const result = classifyStreamError(`
    spawn: ffmpeg -i rtsp://admin:secret@10.0.0.8:8554/live
    [libx264 @ 0x123] frame MB size (120x68) > level limit (3600)
  `);

  assert.deepEqual(result, {
    code: "ENCODER_INCOMPATIBLE",
    message: "Resolusi atau codec kamera tidak kompatibel dengan profil transcode.",
  });
  assert.doesNotMatch(JSON.stringify(result), /ffmpeg|rtsp:|admin|secret|level limit/i);
});

test("network and authentication failures have actionable public messages", () => {
  assert.deepEqual(classifyStreamError("Connection timed out"), {
    code: "SOURCE_TIMEOUT",
    message: "Koneksi ke kamera timeout. Periksa IP, port, jaringan, dan status kamera.",
  });
  assert.deepEqual(classifyStreamError("method DESCRIBE failed: 401 Unauthorized"), {
    code: "SOURCE_AUTH_FAILED",
    message: "Autentikasi kamera ditolak. Periksa username dan password kamera.",
  });
});
