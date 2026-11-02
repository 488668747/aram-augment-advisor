import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const START_TIMEOUT_MS = 45_000;
const SLOT_TIMEOUT_MS = 30_000;

// Native workers and WASM must use real files, outside Electron's virtual ASAR.
function diskPath(filename) {
  const unpacked = filename.replace(/([\\/])app\.asar([\\/])/g, '$1app.asar.unpacked$2');
  accessSync(unpacked, constants.R_OK);
  return unpacked;
}

/**
 * assetRoot is the OCR directory containing worker.cjs and tessdata/.
 * Defaults to resources/ocr in development and process.resourcesPath/ocr in Electron.
 * Accepts exactly three encoded image Buffers, in left-to-right slot order.
 */
export function createOcrEngine({ assetRoot } = {}) {
  const packaged = /[\\/]app\.asar(?:\.unpacked)?[\\/]/.test(fileURLToPath(import.meta.url));
  const root = path.resolve(assetRoot ?? (packaged && process.resourcesPath
    ? path.join(process.resourcesPath, 'ocr')
    : fileURLToPath(new URL('../../resources/ocr/', import.meta.url))));
  let session;
  let closed = false;
  let queue = Promise.resolve();
  let termination;

  function exchange(current, message, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        current.pending = undefined;
        reject(new Error('OCR operation timed out'));
      }, timeoutMs);
      current.pending = {
        resolve(value) { clearTimeout(timer); current.pending = undefined; resolve(value); },
        reject(error) { clearTimeout(timer); current.pending = undefined; reject(error); },
      };
      if (current.failure) current.pending.reject(current.failure);
      else if (message) {
        try { current.thread.postMessage(message); }
        catch { current.pending.reject(new Error('OCR worker could not receive image')); }
      }
    });
  }

  async function discard(current, reason = new Error('OCR worker stopped')) {
    if (!current) return;
    if (session === current) session = undefined;
    current.failure = reason;
    current.pending?.reject(reason);
    // Also terminates nested Tesseract workers, even during createWorker().
    current.stopping ??= current.thread.terminate();
    await current.stopping;
  }

  async function getSession() {
    if (closed) throw new Error('OCR engine has been terminated');
    if (session) return session;
    let current;
    try {
      const tesseractEntry = diskPath(require.resolve('tesseract.js'));
      const dependencyRequire = createRequire(tesseractEntry);
      const workerPath = diskPath(dependencyRequire.resolve('tesseract.js/src/worker-script/node/index.js'));
      const corePath = path.dirname(diskPath(dependencyRequire.resolve('tesseract.js-core/package.json')));
      for (const variant of ['lstm', 'simd-lstm']) {
        diskPath(path.join(corePath, `tesseract-core-${variant}.js`));
        diskPath(path.join(corePath, `tesseract-core-${variant}.wasm`));
      }
      const langPath = diskPath(path.join(root, 'tessdata'));
      for (const lang of ['chi_sim', 'eng']) diskPath(path.join(langPath, `${lang}.traineddata.gz`));
      current = {
        thread: new Worker(diskPath(path.join(root, 'worker.cjs')), {
          workerData: { tesseractEntry, workerPath, corePath, langPath },
          // Do not inherit CLI preload/input-type flags into production workers.
          execArgv: [],
        }),
      };
      session = current;
      current.thread.on('message', (message) => {
        if (message.type === 'error') {
          current.failure = new Error('Local OCR worker failed');
          current.pending?.reject(current.failure);
        } else if (message.type === 'ready' || message.type === 'result') {
          current.pending?.resolve(message.result);
        }
      });
      current.thread.on('error', () => {
        current.failure = new Error('Local OCR worker failed');
        current.pending?.reject(current.failure);
      });
      current.thread.on('exit', () => {
        current.failure ??= new Error('Local OCR worker exited');
        current.pending?.reject(current.failure);
      });
      await exchange(current, null, START_TIMEOUT_MS);
      return current;
    } catch (error) {
      await discard(current);
      if (error.code === 'ENOENT' || error.code === 'MODULE_NOT_FOUND') {
        throw new Error('Offline OCR resources are missing; run npm run ocr:prepare before packaging');
      }
      throw error;
    }
  }

  return {
    async recognizeSlots(images) {
      if (closed) throw new Error('OCR engine has been terminated');
      if (!Array.isArray(images) || images.length !== 3
        || !images.every((image) => Buffer.isBuffer(image) && image.length > 0)) {
        throw new TypeError('OCR requires exactly three non-empty image Buffers');
      }
      // Snapshot references at submission; do not transfer/detach caller buffers.
      const slots = images.slice();
      const operation = queue.then(async () => {
        const current = await getSession();
        try {
          const results = [];
          for (const image of slots) {
            if (closed) throw new Error('OCR engine has been terminated');
            const result = await exchange(current, { type: 'recognize', image }, SLOT_TIMEOUT_MS);
            const confidence = Number(result?.confidence);
            results.push({
              text: String(result?.text ?? '').trim(),
              confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence / 100)) : 0,
            });
          }
          return results;
        } catch (error) {
          await discard(current);
          throw error;
        }
      });
      queue = operation.catch(() => {});
      return operation;
    },
    async terminate() {
      closed = true;
      termination ??= discard(session).then(() => queue);
      await termination;
    },
  };
}
