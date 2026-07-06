import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('[TEST] Starting AI worker...');
const worker = new Worker(path.join(__dirname, 'src/core/aiDetector.js'));

worker.on('message', (msg) => {
  console.log('[TEST] Worker message type:', msg.type);
  if (msg.type === 'ready') {
    console.log('[TEST] ✅ AI Worker READY! All OK.');
    worker.terminate();
    process.exit(0);
  }
});
worker.on('error', (err) => {
  console.error('[TEST] ❌ Worker ERROR:', err.message, err.stack);
  process.exit(1);
});
worker.on('exit', (code) => {
  if (code !== 0) {
    console.error('[TEST] Worker exited with non-zero code:', code);
  }
});
setTimeout(() => {
  console.error('[TEST] ⏰ TIMEOUT - Worker tidak ready dalam 25 detik! Kemungkinan hang saat load model.');
  worker.terminate();
  process.exit(1);
}, 25000);
