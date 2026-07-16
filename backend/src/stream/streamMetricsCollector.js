import fs from "node:fs";
import path from "node:path";

export class StreamMetricsCollector {
  constructor(cameraId, hlsDir) {
    this.cameraId = cameraId;
    this.hlsDir = hlsDir;
    this.inputFps = 0;
    this.outputFps = 0;
    this.speed = 1.0;
    this.bitrate = 0;
    this.droppedFrames = 0;
    this.dtsDiscontinuities = 0;
    this.lastFrameAt = Date.now();
    
    // HLS tracking
    this.segmentDuration = 4.0; 
    this.playlistAge = 0;
    this.segmentDelay = 0;
    this.lastSegmentWriteTime = Date.now();
    this.segmentCount = 0;

    // File Watcher
    this.watcher = null;
    this.startHlsWatcher();
  }

  startHlsWatcher() {
    try {
      if (!fs.existsSync(this.hlsDir)) {
        fs.mkdirSync(this.hlsDir, { recursive: true });
      }
      this.watcher = fs.watch(this.hlsDir, (eventType, filename) => {
        if (eventType === "rename" && filename && filename.endsWith(".ts")) {
          const filePath = path.join(this.hlsDir, filename);
          if (fs.existsSync(filePath)) {
            const now = Date.now();
            const diffSec = (now - this.lastSegmentWriteTime) / 1000;
            this.lastSegmentWriteTime = now;
            this.segmentCount++;
            
            if (this.segmentCount > 1) {
              this.segmentDuration = diffSec;
              const expectedDuration = this.hlsDir.includes("low_latency") ? 1.0 : 4.0;
              this.segmentDelay = Math.max(0, diffSec - expectedDuration);
            }
          }
        }
      });
    } catch (err) {
      console.error(`[MetricsCollector][${this.cameraId}] Watcher error:`, err);
    }
  }

  parseStderr(data) {
    const log = data.toString();
    
    if (log.includes("Frame dropped") || log.includes("drop")) {
      this.droppedFrames++;
    }
    if (log.includes("DTS discontinuity") || log.includes("Non-monotonous DTS")) {
      this.dtsDiscontinuities++;
    }

    const fpsMatch = log.match(/fps=\s*([\d.]+)/);
    if (fpsMatch) this.outputFps = parseFloat(fpsMatch[1]);

    const speedMatch = log.match(/speed=\s*([\d.]+)x/);
    if (speedMatch) this.speed = parseFloat(speedMatch[1]);

    const bitrateMatch = log.match(/bitrate=\s*([\d.]+)\s*kbits\/s/);
    if (bitrateMatch) this.bitrate = parseFloat(bitrateMatch[1]);

    this.lastFrameAt = Date.now();
  }

  getMetrics() {
    const playlistPath = path.join(this.hlsDir, "index.m3u8");
    try {
      if (fs.existsSync(playlistPath)) {
        const stat = fs.statSync(playlistPath);
        this.playlistAge = (Date.now() - stat.mtimeMs) / 1000;
      } else {
        this.playlistAge = 999;
      }
    } catch {
      this.playlistAge = 999;
    }

    return {
      inputFps: this.outputFps || 15,
      outputFps: this.outputFps || 15,
      speed: this.speed,
      bitrate: this.bitrate,
      droppedFrames: this.droppedFrames,
      dtsDiscontinuities: this.dtsDiscontinuities,
      segmentDuration: parseFloat(this.segmentDuration.toFixed(2)),
      playlistAge: parseFloat(this.playlistAge.toFixed(2)),
      segmentDelay: parseFloat(this.segmentDelay.toFixed(2))
    };
  }

  destroy() {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {}
    }
  }
}

const activeCollectors = new Map();

export function getOrCreateCollector(cameraId, hlsDir) {
  if (!activeCollectors.has(cameraId)) {
    activeCollectors.set(cameraId, new StreamMetricsCollector(cameraId, hlsDir));
  }
  return activeCollectors.get(cameraId);
}

export function removeCollector(cameraId) {
  const collector = activeCollectors.get(cameraId);
  if (collector) {
    collector.destroy();
    activeCollectors.delete(cameraId);
  }
}

export function getCollectorMetrics(cameraId) {
  const collector = activeCollectors.get(cameraId);
  return collector ? collector.getMetrics() : null;
}
