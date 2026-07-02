import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import jpeg from 'jpeg-js';

// Setup TF.js to use CPU backend (since we don't have C++ node bindings for portability)
tf.setBackend('cpu');

let modelPromise = null;

export async function getModel() {
  if (!modelPromise) {
    console.log("[AI] Loading COCO-SSD model...");
    modelPromise = cocoSsd.load({
      base: 'mobilenet_v2' // Very lightweight model
    }).then(model => {
      console.log("[AI] COCO-SSD model loaded successfully.");
      return model;
    }).catch(err => {
      console.error("[AI] Failed to load COCO-SSD model:", err);
      modelPromise = null;
      throw err;
    });
  }
  return modelPromise;
}

/**
 * Run object detection on a raw JPEG buffer.
 * @param {Buffer} jpegBuffer - Raw JPEG bytes from MJPEG stream
 * @returns {Promise<Array>} - Array of detection objects { class, score, bbox }
 */
export async function detectObjects(jpegBuffer) {
  try {
    const model = await getModel();
    if (!model) return [];

    // Decode JPEG buffer to raw pixels
    const rawImageData = jpeg.decode(jpegBuffer, { useTArray: true });
    
    // Create a 3D tensor from the flat pixel array [height, width, 4] -> [height, width, 3]
    const numPixels = rawImageData.width * rawImageData.height;
    const values = new Int32Array(numPixels * 3);
    
    // Drop the alpha channel for RGB tensor
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
    
    // Free tensor memory immediately
    imageTensor.dispose();

    if (predictions.length > 0) {
      console.log(`[AI] Detection took ${duration}ms. Found: ${predictions.map(p => `${p.class} (${Math.round(p.score * 100)}%)`).join(', ')}`);
    }

    return predictions.map(p => ({
      class: p.class,
      score: p.score,
      bbox: p.bbox,
      frameWidth: rawImageData.width,
      frameHeight: rawImageData.height
    }));
  } catch (err) {
    console.error("[AI] Error during detection:", err);
    return [];
  }
}
