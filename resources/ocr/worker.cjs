'use strict';

// Owning createWorker in a native worker makes its initialization cancellable.
const { parentPort, setEnvironmentData, workerData } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { createImageVariants, chooseRepeatedResult } = require('./image-variants.cjs');

// Pass the resolved on-disk upstream entry into the nested worker without
// modifying process-wide environment variables or any dependency sources.
setEnvironmentData('aram-advisor:ocr-worker', workerData.workerPath);

const { createWorker, OEM, PSM } = require(workerData.tesseractEntry);
const variantsFor = createImageVariants({ corePath: workerData.corePath });
let worker;

function fail() {
  // Do not send upstream errors, file paths, image data, or OCR text to logs.
  parentPort.postMessage({ type: 'error' });
}

(async () => {
  // Tesseract can silently continue with only one language when another model
  // is corrupt. Verify both before initialization; all IO stays off the main thread.
  const { models } = JSON.parse(await readFile(path.join(__dirname, 'models.json'), 'utf8'));
  for (const language of ['chi_sim', 'eng']) {
    const expected = models.find((model) => model.language === language);
    const data = await readFile(path.join(workerData.langPath, `${language}.traineddata.gz`));
    if (!expected || data.length !== expected.bytes
      || createHash('sha256').update(data).digest('hex') !== expected.sha256) {
      throw new Error('Offline OCR model integrity check failed');
    }
  }
  worker = await createWorker('chi_sim+eng', OEM.LSTM_ONLY, {
    workerPath: path.join(__dirname, 'tesseract-worker.cjs'),
    corePath: workerData.corePath,
    langPath: workerData.langPath,
    gzip: true,
    cacheMethod: 'none',
    logger: () => {},
    errorHandler: fail,
  });
  worker.worker.on('error', fail);
  worker.worker.on('exit', fail);
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    user_defined_dpi: '150',
  });
  parentPort.on('message', async (message) => {
    if (message.type !== 'recognize') return;
    try {
      // Structured clone turns Buffer into Uint8Array; keep upstream on the
      // in-memory input branch so it cannot interpret input as a file or URL.
      const image = Buffer.from(message.image);
      const { data } = await worker.recognize(image);
      const readings = [data];
      // Retry uncertain titles only, with a bounded set of genuinely different
      // geometries. Agreement selects a transcript, never invents a confidence.
      if (data.confidence < 90) {
        for (const variant of await variantsFor(image)) {
          readings.push((await worker.recognize(variant)).data);
        }
      }
      const result = chooseRepeatedResult(readings);
      parentPort.postMessage({ type: 'result', result: { text: result.text, confidence: result.confidence } });
    } catch {
      fail();
    }
  });
  parentPort.postMessage({ type: 'ready' });
})().catch(fail);
