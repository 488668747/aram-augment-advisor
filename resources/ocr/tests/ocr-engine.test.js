import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createOcrEngine } from '../../../src/main/ocr-engine.js';

const require = createRequire(import.meta.url);

const slots = (...values) => values.map((value) => Buffer.from([value]));
const bootstrap = `
const { parentPort, workerData } = require('node:worker_threads');
const { appendFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const root = path.dirname(workerData.langPath);
appendFileSync(path.join(root, 'starts'), 'started\\n');
let busy = false;
parentPort.on('message', ({ image }) => {
  if (busy) throw new Error('Overlapping requests');
  busy = true;
  writeFileSync(path.join(root, 'seen'), String(image[0]));
  if (image[0] === 252) return;
  if (image[0] === 253) process.exit(9);
  if (image[0] === 254) { parentPort.postMessage({ type: 'error' }); return; }
  setTimeout(() => {
    busy = false;
    parentPort.postMessage({ type: 'result', result: {
      text: '  slot-' + image[0] + '\\n',
      confidence: ({ 1: 95, 2: 150, 3: -10, 4: NaN })[image[0]],
    } });
  }, 5);
});
parentPort.postMessage({ type: 'ready' });
`;

async function fixture(t, source = bootstrap) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ocr-engine-test-'));
  await mkdir(path.join(root, 'tessdata'));
  for (const lang of ['chi_sim', 'eng']) {
    await writeFile(path.join(root, 'tessdata', `${lang}.traineddata.gz`), 'fixture');
  }
  await writeFile(path.join(root, 'worker.cjs'), source);
  const engine = createOcrEngine({ assetRoot: root });
  t.after(async () => { await engine.terminate(); await rm(root, { recursive: true, force: true }); });
  return { root, engine };
}

async function waitForFile(filename) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    try { return await readFile(filename, 'utf8'); } catch { await nextTurn(); }
  }
  throw new Error('Fixture worker did not start');
}

test('creation is lazy; invalid input and absent models reject without starting OCR', async () => {
  const engine = createOcrEngine({ assetRoot: path.join(os.tmpdir(), 'missing-ocr-resources') });
  await assert.rejects(engine.recognizeSlots(slots(1, 2)), /exactly three/);
  await assert.rejects(engine.recognizeSlots([Buffer.alloc(0), ...slots(1, 2)]), /non-empty/);
  await assert.rejects(engine.recognizeSlots(['https://example.invalid', ...slots(1, 2)]), /Buffers/);
  await assert.rejects(engine.recognizeSlots(slots(1, 2, 3)), /Offline OCR resources are missing/);
  await engine.terminate();
  await engine.terminate();
  await assert.rejects(engine.recognizeSlots(slots(1, 2, 3)), /terminated/);
});

test('concurrent batches serialize, retain order, normalize confidence, and reuse one worker', async (t) => {
  const { root, engine } = await fixture(t);
  const images = slots(1, 2, 3);
  const [first, second] = await Promise.all([
    engine.recognizeSlots(images), engine.recognizeSlots(slots(4, 1, 2)),
  ]);
  assert.deepEqual(first, [
    { text: 'slot-1', confidence: 0.95 },
    { text: 'slot-2', confidence: 1 },
    { text: 'slot-3', confidence: 0 },
  ]);
  assert.deepEqual(second.map((slot) => slot.text), ['slot-4', 'slot-1', 'slot-2']);
  assert.equal(second[0].confidence, 0);
  assert.deepEqual(images, slots(1, 2, 3));
  assert.equal(await readFile(path.join(root, 'starts'), 'utf8'), 'started\n');
});

for (const failure of [253, 254]) {
  test(`worker ${failure === 253 ? 'exit' : 'reported error'} rejects a batch and recreates on the next`, async (t) => {
    const { root, engine } = await fixture(t);
    await assert.rejects(engine.recognizeSlots(slots(failure, 1, 2)), /worker/);
    assert.equal((await engine.recognizeSlots(slots(1, 2, 3)))[0].text, 'slot-1');
    assert.equal(await readFile(path.join(root, 'starts'), 'utf8'), 'started\nstarted\n');
  });
}

test('termination cancels in-flight and queued batches and is idempotent', async (t) => {
  const { root, engine } = await fixture(t);
  const active = assert.rejects(engine.recognizeSlots(slots(252, 1, 2)), /stopped|terminated/);
  const queued = assert.rejects(engine.recognizeSlots(slots(1, 2, 3)), /terminated/);
  await waitForFile(path.join(root, 'seen'));
  await Promise.all([engine.terminate(), engine.terminate(), active, queued]);
});

test('initialization timeout kills a not-yet-ready worker and allows recovery', async (t) => {
  const { root, engine } = await fixture(t, 'setInterval(() => {}, 1000);');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rejected = assert.rejects(engine.recognizeSlots(slots(1, 2, 3)), /timed out/);
  await nextTurn();
  t.mock.timers.tick(45_000);
  await rejected;
  t.mock.timers.reset();
  await writeFile(path.join(root, 'worker.cjs'), bootstrap);
  assert.equal((await engine.recognizeSlots(slots(1, 2, 3)))[0].text, 'slot-1');
});

test('slot timeout rejects the whole batch and recreates the worker', async (t) => {
  const { root, engine } = await fixture(t);
  // Warm up so this timeout covers recognition, rather than initialization.
  await engine.recognizeSlots(slots(1, 2, 3));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rejected = assert.rejects(engine.recognizeSlots(slots(252, 1, 2)), /timed out/);
  await nextTurn();
  t.mock.timers.tick(30_000);
  await rejected;
  t.mock.timers.reset();
  assert.equal((await engine.recognizeSlots(slots(1, 2, 3)))[0].text, 'slot-1');
  assert.equal(await readFile(path.join(root, 'starts'), 'utf8'), 'started\nstarted\n');
});

test('initialization timeout also terminates nested native workers', async (t) => {
  const source = `
    const { Worker, workerData } = require('node:worker_threads');
    const path = require('node:path');
    new Worker(\`
      const { workerData } = require('node:worker_threads');
      const { appendFileSync } = require('node:fs');
      setInterval(() => appendFileSync(workerData, 'tick\\\\n'), 5);
    \`, { eval: true, workerData: path.join(workerData.langPath, '..', 'heartbeat') });
  `;
  const { root, engine } = await fixture(t, source);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rejected = assert.rejects(engine.recognizeSlots(slots(1, 2, 3)), /timed out/);
  const heartbeat = path.join(root, 'heartbeat');
  await waitForFile(heartbeat);
  t.mock.timers.tick(45_000);
  await rejected;
  t.mock.timers.reset();
  const stopped = await readFile(heartbeat, 'utf8');
  await delay(50);
  assert.equal(await readFile(heartbeat, 'utf8'), stopped, 'nested worker must stop with its owner');
});

test('a corrupt Chinese model fails instead of silently continuing with English only', { timeout: 5000 }, async (t) => {
  const { root, engine } = await fixture(t);
  for (const filename of ['worker.cjs', 'tesseract-worker.cjs', 'image-variants.cjs', 'models.json']) {
    await cp(new URL(`../${filename}`, import.meta.url), path.join(root, filename));
  }
  // Leave chi_sim corrupt but supply valid English: without the integrity gate,
  // upstream can initialize English only and successfully recognize a blank image.
  const english = require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
  await cp(english, path.join(root, 'tessdata', 'eng.traineddata.gz'));
  const { encode } = require('bmp-js');
  const blank = encode({ data: Buffer.alloc(400 * 80 * 4, 255), width: 400, height: 80 }).data;
  await assert.rejects(engine.recognizeSlots([blank, blank, blank]), /OCR worker failed/);
});
