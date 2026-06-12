import assert from "node:assert/strict";
import test from "node:test";
import { redactError, sanitizeRequestUrl } from "../src/core/redact.js";

test("request URL logging redacts stream tokens", () => {
  const result = sanitizeRequestUrl(
    "/api/streams/cam-1/index.m3u8?token=top-secret&vid=viewer-1&output=HLS",
  );

  assert.doesNotMatch(result, /top-secret/);
  assert.match(result, /token=%5BREDACTED%5D/);
  assert.match(result, /vid=viewer-1/);
});

test("error redaction removes URL credentials and sensitive JSON fields", () => {
  const result = redactError(
    'failed rtsp://admin:camera-pass@10.0.0.8/live {"password":"user-pass","token":"abc"}',
  );

  assert.doesNotMatch(result, /camera-pass|user-pass|abc/);
  assert.match(result, /\[REDACTED\]/);
});
