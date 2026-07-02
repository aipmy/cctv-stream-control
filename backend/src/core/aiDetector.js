import { Worker, isMainThread, parentPort } from 'worker_threads';
import { fileURLToPath } from 'url';

if (isMainThread) {
  let worker = null;
  let taskId = 0;
  const callbacks = new Map();

  export async function getModel() {
    // Dummy function for compatibility if called
    return true;
  }

  export async function detectObjects(jpegBuffer) {
    if (!worker) {
      worker = new Worker(fileURLToPath(import.meta.url));
      worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          console.log("[AI] Worker is ready and model loaded.");
        } else if (msg.type === 'result' || msg.type === 'error') {
          const cb = callbacks.get(msg.id);
          if (cb) {
            callbacks.delete(msg.id);
            if (msg.type === 'result') cb.resolve(msg.predictions);
            else cb.reject(new Error(msg.error));
          }
        }
      });
      worker.on('error', (err) => {
        console.error("[AI Worker Error]", err);
      });
      worker.on('exit', (code) => {
        if (code !== 0) console.error(`[AI Worker] Stopped with exit code ${code}`);
        worker = null;
      });
    }
    
    return new Promise((resolve, reject) => {
      const id = taskId++;
      callbacks.set(id, { resolve, reject });
      worker.postMessage({ id, buffer: jpegBuffer });
      
      // Auto timeout after 15 seconds if worker gets stuck
      setTimeout(() => {
        if (callbacks.has(id)) {
          callbacks.delete(id);
          resolve([]); // Just return empty on timeout
        }
      }, 15000);
    });
  }
} else {
  // Worker Thread
  (async () => {
    try {
      const tf = await import('@tensorflow/tfjs');
      tf.setBackend('cpu');
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      const jpeg = await import('jpeg-js');
      
      console.log("[AI Worker] Loading COCO-SSD model...");
      const model = await cocoSsd.load({ base: 'mobilenet_v2' });
      parentPort.postMessage({ type: 'ready' });

      parentPort.on('message', async (msg) => {
        if (!msg.buffer) return;
        try {
          const rawImageData = jpeg.default.decode(msg.buffer, { useTArray: true });
          const numPixels = rawImageData.width * rawImageData.height;
          const values = new Int32Array(numPixels * 3);
          
          for (let i = 0; i < numPixels; i++) {
            values[i * 3 + 0] = rawImageData.data[i * 4 + 0]; // R
            values[i * 3 + 1] = rawImageData.data[i * 4 + 1]; // G
            values[i * 3 + 2] = rawImageData.data[i * 4 + 2]; // B
          }

          const outShape = [rawImageData.height, rawImageData.width, 3];
          const imageTensor = tf.tensor3d(values, outShape, 'int32');
          
          const start = Date.now();
          const predictions = await model.detect(imageTensor);
          const duration = Date.now() - start;
          
          imageTensor.dispose();

          const formatted = predictions.map(p => ({
            class: p.class,
            score: p.score,
            bbox: p.bbox,
            frameWidth: rawImageData.width,
            frameHeight: rawImageData.height
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
