import EventEmitter from "node:events";
import jpeg from "jpeg-js";

export const motionEmitter = new EventEmitter();

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

export function rgbaToGray(rgba, width, height) {
  const out = new Uint8Array(width * height);
  let j = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    out[j++] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  return out;
}

export function blendBackground(prev, curr, alpha) {
  const out = new Uint8Array(curr.length);
  const inv = 1 - alpha;
  for (let i = 0; i < curr.length; i++) {
    out[i] = Math.round(prev[i] * inv + curr[i] * alpha);
  }
  return out;
}

export function pointInPolygon(nx, ny, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    const intersect = ((yi > ny) !== (yj > ny)) && (nx < (xj - xi) * (ny - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isIgnoredPoint(nx, ny, ignoreZones) {
  for (const z of ignoreZones) {
    if (z.enabled === false) continue;
    if (z.type === "polygon") {
      if (pointInPolygon(nx, ny, z.points || [])) return true;
      continue;
    }
    // rectangle fallback
    if (z.x != null && z.y != null && z.w != null && z.h != null) {
      if (nx >= z.x && ny >= z.y && nx <= z.x + z.w && ny <= z.y + z.h) return true;
    }
  }
  return false;
}

export function detectMotion(prev, curr, width, height, options) {
  const BLOCK_SIZE = 12;
  const cols = Math.ceil(width / BLOCK_SIZE);
  const rows = Math.ceil(height / BLOCK_SIZE);
  
  // Konversi sensitivitas (1-100) ke threshold pixel-diff
  const sensitivity = clamp(Number(options.sensitivity) || 50, 1, 100);
  const offset = sensitivity - 50;
  const DEFAULT_DIFF = 30;
  const DEFAULT_MIN_BLOCKS = 4;
  
  const diffThreshold = clamp(Math.round(DEFAULT_DIFF - (offset * 0.42)), 8, 80);
  const baseMinBlocks = clamp(Math.round(DEFAULT_MIN_BLOCKS - (offset * 0.06)), 1, 60);

  const resolutionFactor = clamp(Math.sqrt((width * height) / (854 * 480)), 0.20, 1.6);
  const effectiveMinMotionBlocks = clamp(Math.round(baseMinBlocks * resolutionFactor), 1, 160);
  const effectiveMinBoxWidth = clamp(Math.round(18 * resolutionFactor), 6, 18 * 4);
  const effectiveMinBoxHeight = clamp(Math.round(18 * resolutionFactor), 6, 18 * 4);
  
  const active = new Uint8Array(cols * rows);
  let activeCount = 0;
  const ignoreZones = options.excludeAreas || [];

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let sum = 0, count = 0;
      const x0 = bx * BLOCK_SIZE, y0 = by * BLOCK_SIZE;
      const x1 = Math.min(width, x0 + BLOCK_SIZE), y1 = Math.min(height, y0 + BLOCK_SIZE);
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) { sum += Math.abs(curr[row + x] - prev[row + x]); count++; }
      }
      const centerX = (x0 + x1) / 2 / width;
      const centerY = (y0 + y1) / 2 / height;
      if (isIgnoredPoint(centerX, centerY, ignoreZones)) continue;
      if ((sum / Math.max(1, count)) >= diffThreshold) { active[by * cols + bx] = 1; activeCount++; }
    }
  }

  const visited = new Uint8Array(cols * rows);
  const boxes = [];
  for (let i = 0; i < active.length; i++) {
    if (!active[i] || visited[i]) continue;
    const queue = [i]; visited[i] = 1;
    let minBx = cols, maxBx = 0, minBy = rows, maxBy = 0, blocks = 0;
    while (queue.length) {
      const idx = queue.pop();
      const bx = idx % cols; const by = Math.floor(idx / cols);
      blocks++; 
      minBx = Math.min(minBx, bx); maxBx = Math.max(maxBx, bx); 
      minBy = Math.min(minBy, by); maxBy = Math.max(maxBy, by);
      
      for (const [nx, ny] of [[bx - 1, by], [bx + 1, by], [bx, by - 1], [bx, by + 1]]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const nIdx = ny * cols + nx;
        if (!active[nIdx] || visited[nIdx]) continue;
        visited[nIdx] = 1; queue.push(nIdx);
      }
    }
    if (blocks < effectiveMinMotionBlocks) continue;
    const x = minBx * BLOCK_SIZE, y = minBy * BLOCK_SIZE;
    const w = Math.min(width, (maxBx + 1) * BLOCK_SIZE) - x;
    const h = Math.min(height, (maxBy + 1) * BLOCK_SIZE) - y;
    if (w < effectiveMinBoxWidth || h < effectiveMinBoxHeight) continue;
    boxes.push({ x, y, w, h, blocks });
  }
  return { motion: boxes.length > 0, boxes, activity: activeCount };
}

export function getDetectDimensions(detectResolution, originalWidth, originalHeight) {
  const res = detectResolution || "Auto";
  if (res === "Auto") {
    return { width: 640, height: 360 };
  }
  const match = res.match(/^(\d+)p$/);
  if (match) {
    const height = Number(match[1]);
    if (height === 1080) return { width: 1920, height: 1080 };
    if (height === 720) return { width: 1280, height: 720 };
    if (height === 480) return { width: 854, height: 480 };
    if (height === 360) return { width: 640, height: 360 };
    if (height === 144) return { width: 256, height: 144 };
  }
  return { width: 640, height: 360 };
}

export function rgbaToGrayDownsample(rgba, width, height, targetWidth, targetHeight) {
  if (width === targetWidth && height === targetHeight) {
    return rgbaToGray(rgba, width, height);
  }
  const out = new Uint8Array(targetWidth * targetHeight);
  const stepX = width / targetWidth;
  const stepY = height / targetHeight;
  let idx = 0;
  for (let y = 0; y < targetHeight; y++) {
    const srcY = Math.floor(y * stepY);
    const rowOffset = srcY * width * 4;
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.floor(x * stepX);
      const pixelOffset = rowOffset + srcX * 4;
      out[idx++] = Math.round(
        0.299 * rgba[pixelOffset] +
        0.587 * rgba[pixelOffset + 1] +
        0.114 * rgba[pixelOffset + 2]
      );
    }
  }
  return out;
}

export class CameraMotionEngine {
  constructor(cameraId) {
    this.cameraId = cameraId;
    this.previousGray = null;
  }

  processFrame(jpegBytes, options) {
    let decoded;
    try { 
      decoded = jpeg.decode(jpegBytes, { useTArray: true }); 
    } catch (e) { 
      return { error: "decode_error" }; 
    }
    const target = getDetectDimensions(options.detectResolution || "Auto", decoded.width, decoded.height);
    const gray = rgbaToGrayDownsample(decoded.data, decoded.width, decoded.height, target.width, target.height);
    if (!this.previousGray || this.previousGray.length !== gray.length) { 
      this.previousGray = gray; 
      return { motion: false, boxes: [], activity: 0 }; 
    }
    const motion = detectMotion(this.previousGray, gray, target.width, target.height, options);
    this.previousGray = blendBackground(this.previousGray, gray, motion.motion ? 0.08 : 0.18);
    
    // Siarkan ke klien secara real-time
    motionEmitter.emit(`motion-${this.cameraId}`, {
      ts: new Date().toISOString(),
      motion: motion.motion,
      boxes: motion.boxes,
      activity: motion.activity,
      frame: { width: decoded.width, height: decoded.height }
    });

    return motion;
  }
}
