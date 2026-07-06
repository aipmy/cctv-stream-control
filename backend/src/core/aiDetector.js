import { Worker, isMainThread, parentPort } from 'worker_threads';
import { fileURLToPath } from 'url';

let worker = null;
let taskId = 0;
const callbacks = new Map();
let isWorkerBusy = false;
let isWorkerReady = false;
let messageQueue = [];

export async function getModel() {
  // Dummy function for compatibility if called
  return true;
}

export async function detectObjects(jpegBuffer, threshold = 0.5) {
  if (!isMainThread) return [];

  // Drop frame if AI is already processing another frame (prevents queue buildup across multiple cameras)
  if (isWorkerBusy) {
    return null;
  }

  if (!worker) {
      isWorkerReady = false;
      worker = new Worker(fileURLToPath(import.meta.url));
      worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          console.log("[AI] Worker is ready and model loaded.");
          isWorkerReady = true;
          // Process queued messages
          messageQueue.forEach(m => worker.postMessage(m));
          messageQueue = [];
        } else if (msg.type === 'result' || msg.type === 'error') {
          console.log(`[AI Detector] Received ${msg.type} for id ${msg.id}`);
          const cb = callbacks.get(msg.id);
          if (cb) {
            callbacks.delete(msg.id);
            isWorkerBusy = callbacks.size > 0;
            console.log(`[AI Detector] Resolving callback. isWorkerBusy=${isWorkerBusy}`);
            if (msg.type === 'result') cb.resolve(msg.predictions);
            else cb.reject(new Error(msg.error));
          } else {
            console.log(`[AI Detector] No callback found for id ${msg.id}`);
          }
        }
      });
      worker.on('error', (err) => {
        console.error("[AI Worker Error]", err);
        isWorkerBusy = false;
      });
      worker.on('exit', (code) => {
        if (code !== 0) console.error(`[AI Worker] Stopped with exit code ${code}`);
        worker = null;
        isWorkerBusy = false;
      });
    }
    
    return new Promise((resolve, reject) => {
      const id = ++taskId;
      callbacks.set(id, { resolve, reject });
      isWorkerBusy = true;
      
      const msg = { id, buffer: jpegBuffer, threshold };
      if (isWorkerReady) {
        worker.postMessage(msg);
      } else {
        messageQueue.push(msg);
      }
      
      // Auto timeout after 15 seconds if worker gets stuck
      setTimeout(() => {
        if (callbacks.has(id)) {
          callbacks.delete(id);
          resolve([]); // Just return empty on timeout
        }
      }, 15000);
    });
}

if (!isMainThread) {
  // Worker Thread
  (async () => {
    try {
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const util = require('util');
      if (typeof util.isNullOrUndefined !== 'function') {
        util.isNullOrUndefined = function (val) {
          return val === null || val === undefined;
        };
      }
      
      let tf;
      let isNode = false;
      try {
        tf = await import('@tensorflow/tfjs-node');
        isNode = true;
      } catch (e) {
        tf = await import('@tensorflow/tfjs');
        tf.setBackend('cpu');
      }
      
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      
      console.log(`[AI Worker] Loading COCO-SSD model (using ${isNode ? 'tfjs-node' : 'tfjs-cpu'})...`);
      const model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      parentPort.postMessage({ type: 'ready' });

      parentPort.on('message', async (msg) => {
        if (!msg.buffer) return;
        try {
          let imageTensor;
          let frameWidth, frameHeight;
          
          if (isNode) {
            imageTensor = tf.node.decodeImage(msg.buffer);
            frameWidth = imageTensor.shape[1];
            frameHeight = imageTensor.shape[0];
          } else {
            const jpeg = await import('jpeg-js');
            const rawImageData = jpeg.default.decode(msg.buffer, { useTArray: true });
            frameWidth = rawImageData.width;
            frameHeight = rawImageData.height;
            const numPixels = frameWidth * frameHeight;
            const values = new Int32Array(numPixels * 3);
            for (let i = 0; i < numPixels; i++) {
              values[i * 3 + 0] = rawImageData.data[i * 4 + 0]; // R
              values[i * 3 + 1] = rawImageData.data[i * 4 + 1]; // G
              values[i * 3 + 2] = rawImageData.data[i * 4 + 2]; // B
            }
            const outShape = [frameHeight, frameWidth, 3];
            imageTensor = tf.tensor3d(values, outShape, 'int32');
          }
          
          const start = Date.now();
          
          // Downscale tensor for performance (max 640x480)
          let processTensor = imageTensor;
          let scaleX = 1;
          let scaleY = 1;
          
          if (frameWidth > 640 || frameHeight > 480) {
            const scale = Math.min(640 / frameWidth, 480 / frameHeight);
            const newWidth = Math.round(frameWidth * scale);
            const newHeight = Math.round(frameHeight * scale);
            const resized = tf.image.resizeBilinear(imageTensor, [newHeight, newWidth]);
            processTensor = resized.toInt();
            resized.dispose();
            scaleX = frameWidth / newWidth;
            scaleY = frameHeight / newHeight;
          }
          
          const rawPredictions = await model.detect(processTensor, 20, 0.10);
          const duration = Date.now() - start;
          
          if (processTensor !== imageTensor) processTensor.dispose();
          imageTensor.dispose();
          
          // Rescale boxes back to original coordinates
          const predictions = rawPredictions.map(p => ({
            ...p,
            bbox: [
              p.bbox[0] * scaleX,
              p.bbox[1] * scaleY,
              p.bbox[2] * scaleX,
              p.bbox[3] * scaleY
            ]
          }));

          const formatted = predictions.map(p => ({
            class: p.class,
            score: p.score,
            bbox: p.bbox,
            frameWidth,
            frameHeight
          }));

          if (formatted.length > 0) {
            console.log(`[AI Worker] Detection took ${duration}ms. Found: ${formatted.map(p => `${p.class} (${Math.round(p.score * 100)}%)`).join(', ')}`);
          }

          parentPort.postMessage({ type: 'result', id: msg.id, predictions: formatted });
        } catch (err) {
          parentPort.postMessage({ type: 'error', id: msg.id, error: err.message });
        }
      });
    } catch (err) {
      console.error("[AI Worker Init Error]", err);
    }
  })();
}
