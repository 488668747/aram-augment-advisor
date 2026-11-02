import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createImageVariants, chooseRepeatedResult } = require('../image-variants.cjs');
const bmp = require('bmp-js');

test('a one-off high score cannot replace a repeated transcript', () => {
  const results = [
    { text: 'HERR', confidence: 0 },
    { text: '吞噬 灵魂\n', confidence: 28 },
    { text: '吞噬灵魂', confidence: 50 },
    { text: '吞叭灵魂', confidence: 60 },
  ];
  assert.equal(chooseRepeatedResult(results), results[2]);
});

test('agreement never inflates raw confidence; no agreement retains the original', () => {
  const repeated = [{ text: '侵蚀', confidence: 28 }, { text: '侵蚀\n', confidence: 86 }];
  assert.equal(chooseRepeatedResult(repeated), repeated[1]);
  const disagree = [{ text: 'a', confidence: 30 }, { text: 'b', confidence: 99 }, { text: '', confidence: 100 }];
  assert.equal(chooseRepeatedResult(disagree), disagree[0]);
  assert.equal(chooseRepeatedResult([{ text: '', confidence: 0 }, { text: '', confidence: 90 }]).confidence, 0);
});

test('English retries retain English and punctuation and cannot detach input', () => {
  const results = [{ text: 'HELLO WORLD!', confidence: 35 }, { text: 'HELLO  WORLD!\n', confidence: 70 }];
  assert.equal(chooseRepeatedResult(results), results[1]);
});

test('offline WASM decoding adds white borders, scales real pixels, and uses memory only', async () => {
  const width = 120, height = 80;
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let y = 10; y < 70; y++) {
    for (let x = 30; x < 90; x++) {
      const offset = (y * width + x) * 4;
      pixels.fill(0, offset + 1, offset + 4);
    }
  }
  const image = bmp.encode({ width, height, data: pixels }).data;
  const snapshot = Buffer.from(image);
  const variants = await createImageVariants({
    corePath: path.dirname(require.resolve('tesseract.js-core/package.json')),
  })(image);
  assert.deepEqual(image, snapshot);
  assert.deepEqual(variants.map((buffer) => {
    const decoded = bmp.decode(buffer);
    return [decoded.width, decoded.height];
  }), [[160, 120], [80, 80], [72, 72]]);
  for (const variant of variants) {
    const decoded = bmp.decode(variant);
    const pixel = (x, y) => decoded.data[(y * decoded.width + x) * 4 + 1];
    assert.equal(pixel(0, 0), 255);
    assert.equal(pixel(19, 20), 255);
    assert.equal(pixel(decoded.width - 1, decoded.height - 1), 255);
    assert.equal(pixel(Math.floor(decoded.width / 2), Math.floor(decoded.height / 2)), 0);
  }
});

test('empty images produce no retries and identical variants are deduplicated', async () => {
  const variantsFor = createImageVariants({
    corePath: path.dirname(require.resolve('tesseract.js-core/package.json')),
  });
  const blank = bmp.encode({ width: 80, height: 48, data: Buffer.alloc(80 * 48 * 4, 255) }).data;
  assert.deepEqual(await variantsFor(blank), []);
  // A fully black 48px square yields identical 32px images for the two scale policies.
  const black = bmp.encode({ width: 48, height: 48, data: Buffer.alloc(48 * 48 * 4, 0) }).data;
  const variants = await variantsFor(black);
  assert.equal(variants.length, 2);
});

test('thin noise cannot cause an unbounded normalization allocation', async () => {
  const variantsFor = createImageVariants({
    corePath: path.dirname(require.resolve('tesseract.js-core/package.json')),
  });
  const noise = bmp.encode({ width: 1000, height: 1, data: Buffer.alloc(1000 * 4, 0) }).data;
  const variants = await variantsFor(noise);
  assert.equal(variants.length, 1);
  assert.ok(variants.every((image) => image.length < 4_000_000));
});
