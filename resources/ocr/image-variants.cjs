'use strict';

const path = require('node:path');

// Reuse the already shipped Leptonica decoder, rather than adding another image
// dependency. These WASM bindings are covered against the core version in our lockfile.
function decodeGrey(core, image) {
  const input = core._malloc(image.length);
  let pointer = 0;
  try {
    core.HEAPU8.set(image, input);
    pointer = core._pixReadMem(input, image.length);
    if (!pointer) return null;
    const pix = core.wrapPointer(pointer, core.Pix);
    const width = pix.get_w();
    const height = pix.get_h();
    const depth = pix.get_d();
    // Bounded title crops only. Unhandled encodings retain the original OCR result.
    if (width < 1 || height < 1 || width > 8192 || height > 4096 || width * height > 4_000_000
      || ![1, 8, 32].includes(depth) || core.getPointer(pix.get_colormap())) return null;
    const grey = Buffer.alloc(width * height);
    const start = pix.get_data() >>> 2;
    const stride = pix.get_wpl();
    const samplesPerPixel = pix.get_spp();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const word = core.HEAPU32[start + y * stride + Math.floor(x * depth / 32)];
        let value;
        if (depth === 32) {
          value = ((word >>> 24) * 299 + ((word >>> 16) & 255) * 587 + ((word >>> 8) & 255) * 114) / 1000;
          if (samplesPerPixel === 4) value = 255 + (value - 255) * (word & 255) / 255;
        } else if (depth === 8) value = (word >>> (24 - (x % 4) * 8)) & 255;
        else value = ((word >>> (31 - (x % 32))) & 1) ? 0 : 255;
        grey[y * width + x] = Math.round(value);
      }
    }
    return { grey, width, height };
  } finally {
    core._free(input);
    if (pointer) {
      // pixDestroy takes PIX**, not PIX*. Free pixel storage and its wrapper cache.
      const address = core._malloc(4);
      core.HEAPU32[address >>> 2] = pointer;
      core._pixDestroy(address);
      core._free(address);
      delete core.getCache(core.Pix)[pointer];
    }
  }
}

function paddedBitmap({ grey, width }, box, outputHeight) {
  const border = 20;
  const outputWidth = Math.max(1, Math.round(box.width * outputHeight / box.height));
  const paddedWidth = outputWidth + border * 2;
  const paddedHeight = outputHeight + border * 2;
  if (paddedWidth > 8192 || paddedHeight > 4096 || paddedWidth * paddedHeight > 4_000_000) return null;
  const stride = Math.ceil(paddedWidth * 3 / 4) * 4;
  const result = Buffer.alloc(54 + stride * paddedHeight, 255);
  result.fill(0, 0, 54);
  result.write('BM');
  result.writeUInt32LE(result.length, 2);
  result.writeUInt32LE(54, 10);
  result.writeUInt32LE(40, 14);
  result.writeInt32LE(paddedWidth, 18);
  result.writeInt32LE(-paddedHeight, 22); // top-down 24-bit BMP, no palette
  result.writeUInt16LE(1, 26);
  result.writeUInt16LE(24, 28);
  result.writeUInt32LE(stride * paddedHeight, 34);
  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      const y0 = Math.floor(y * box.height / outputHeight);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * box.height / outputHeight));
      const x0 = Math.floor(x * box.width / outputWidth);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * box.width / outputWidth));
      let total = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) total += grey[(box.top + yy) * width + box.left + xx];
      }
      const value = Math.round(total / ((y1 - y0) * (x1 - x0)));
      const offset = 54 + (y + border) * stride + (x + border) * 3;
      result.fill(value, offset, offset + 3);
    }
  }
  return result;
}

function createImageVariants({ corePath }) {
  let runtime;
  return async (image) => {
    runtime ??= require(path.join(corePath, 'tesseract-core-lstm.js'))();
    const decoded = decodeGrey(await runtime, image);
    if (!decoded) return [];
    const { grey, width, height } = decoded;
    let left = width; let top = height; let right = -1; let bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (grey[y * width + x] >= 128) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    if (right < left) return [];
    const box = { left, top, width: right - left + 1, height: bottom - top + 1 };
    const candidates = [
      paddedBitmap(decoded, { left: 0, top: 0, width, height }, height),
      paddedBitmap(decoded, box, Math.max(1, Math.round(box.height * 2 / 3))),
      paddedBitmap(decoded, box, 32),
    ];
    return candidates.filter((candidate, index) => candidate
      && !candidates.slice(0, index).some((other) => other?.equals(candidate)));
  };
}

function chooseRepeatedResult(results) {
  const groups = new Map();
  for (const result of results) {
    const key = String(result.text ?? '').normalize('NFKC').replace(/\s/gu, '').toLowerCase();
    if (!key || !Number.isFinite(result.confidence)) continue;
    const group = groups.get(key) ?? [];
    group.push(result);
    groups.set(key, group);
  }
  const repeated = [...groups.values()].filter((group) => group.length >= 2);
  return repeated.flat().sort((a, b) => b.confidence - a.confidence)[0] ?? results[0];
}

module.exports = { createImageVariants, chooseRepeatedResult };
