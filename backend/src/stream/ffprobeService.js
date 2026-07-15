import { exec } from "node:child_process";
import { promisify } from "node:util";
import { buildSourceUrl } from "../core/cctv.js";
import { normalizeRtspTransport } from "./ffmpegArgs.js";

const execAsync = promisify(exec);

/**
 * Probes the camera's RTSP stream and extracts metadata.
 * @param {Object} camera The camera configuration object.
 * @param {Object} options Global options.
 * @returns {Promise<Object>} The metadata object.
 */
export async function probeCameraStream(camera, options = {}) {
  if (!camera || !camera.ip) {
    throw new Error("Invalid camera object for probing");
  }

  const url = buildSourceUrl(camera);
  const transport = normalizeRtspTransport(camera.rtspTransport, options);
  
  // Use timeout of 20s with generous analyze/probe sizes for slow cameras
  const command = `ffprobe -v error -show_format -show_streams -print_format json -rtsp_transport ${transport} -analyzeduration 5000000 -probesize 5000000 "${url}"`;

  try {
    const { stdout } = await execAsync(command, { timeout: 20000 });
    const probeData = JSON.parse(stdout);
    
    if (!probeData.streams || probeData.streams.length === 0) {
      throw new Error("No streams found in probe data");
    }

    let videoStream = null;
    let audioStream = null;

    for (const stream of probeData.streams) {
      if (stream.codec_type === "video" && !videoStream) {
        videoStream = stream;
      } else if (stream.codec_type === "audio" && !audioStream) {
        audioStream = stream;
      }
    }

    if (!videoStream) {
      throw new Error("No video stream found");
    }

    // Attempt to calculate FPS accurately
    let fps = 0;
    if (videoStream.avg_frame_rate && videoStream.avg_frame_rate !== "0/0") {
      const [num, den] = videoStream.avg_frame_rate.split("/");
      fps = Math.round(Number(num) / Number(den));
    }
    if (!fps && videoStream.r_frame_rate && videoStream.r_frame_rate !== "0/0") {
      const [num, den] = videoStream.r_frame_rate.split("/");
      fps = Math.round(Number(num) / Number(den));
    }

    const metadata = {
      videoCodec: videoStream.codec_name || "unknown",
      audioCodec: audioStream ? audioStream.codec_name || "unknown" : null,
      width: videoStream.width || 0,
      height: videoStream.height || 0,
      fps: fps || 20, // fallback
      pixelFormat: videoStream.pix_fmt || "unknown",
      hasAudio: !!audioStream,
      sampleRate: audioStream ? parseInt(audioStream.sample_rate) || 0 : null,
      audioChannels: audioStream ? audioStream.channels || 0 : null,
      rtspUrl: url,
      lastProbe: new Date().toISOString()
    };

    return metadata;
  } catch (error) {
    console.error(`[FFprobe] Error probing camera ${camera.id}: ${error.message}`);
    throw error;
  }
}
