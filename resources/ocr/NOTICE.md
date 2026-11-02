# Offline OCR resources and third-party notices

## Reproduce the model bundle

Run `npm ci` (including devDependencies), then `npm run ocr:prepare`.
Both `npm run dist:dir` and `npm run dist:win` run preparation first.
Preparation reads installed npm files only: it performs no HTTP requests and
does not install packages. There is no project postinstall hook. Dependency
installation in this change used `--ignore-scripts`.

`models.json` pins each source package version, source path, compressed size,
and SHA-256. Worker initialization also verifies both files against that metadata
to prevent Tesseract silently falling back to one language if a model is corrupt.
The script rejects mismatched package versions, license labels,
hashes, sizes, or invalid gzip files. Only the smaller LSTM integer models are
copied, unchanged, into the ignored `tessdata/` directory (4,671,641 bytes total).
The lockfile also pins npm tarball integrity, including the production closure.
Do not commit generated traineddata or fetch models at application runtime.

## Sources and licenses

| Component | Version/source | License |
| --- | --- | --- |
| Tesseract.js | npm `tesseract.js@6.0.1`; https://github.com/naptha/tesseract.js | Apache-2.0 |
| Tesseract.js Core (Tesseract/Leptonica WASM) | npm `tesseract.js-core@6.1.2`, locked production dependency; https://github.com/naptha/tesseract.js-core | Apache-2.0; embedded Leptonica has BSD-style terms |
| Simplified Chinese model | npm `@tesseract.js-data/chi_sim@1.0.0`, `4.0.0_best_int/chi_sim.traineddata.gz` | npm package metadata: MIT; upstream traineddata distribution: Apache-2.0 |
| English model | npm `@tesseract.js-data/eng@1.0.0`, `4.0.0_best_int/eng.traineddata.gz` | npm package metadata: MIT; upstream traineddata distribution: Apache-2.0 |

The model packages identify their publisher as Balearica and contributors as
Balearica and jeromewu, with https://github.com/naptha/tessdata as their source.
They do not ship a LICENSE file. That repository's `gh-pages` branch supplies
an Apache-2.0 LICENSE: https://github.com/naptha/tessdata/blob/gh-pages/LICENSE.
The underlying Tesseract best models also use Apache-2.0:
https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE.
The npm MIT label must not be treated as a replacement for the model's
upstream Apache terms. No model modifications are made by preparation.

`licenses/Apache-2.0.txt` reproduces the license shipped by Tesseract.js Core.
`licenses/MIT.txt` includes the MIT permission text for the model npm packages.
`licenses/Leptonica.txt` preserves Leptonica's copyright and permission notice.
The installed production npm packages retain their own LICENSE files in
`app.asar.unpacked/node_modules`; these notices supplement those files.
No code, images, or datasets from aramgg or other unlicensed repositories are
included in this OCR implementation.

## Runtime integration

Import `createOcrEngine` from `src/main/ocr-engine.js`. `assetRoot` is the OCR
directory containing `worker.cjs` and `tessdata/`, **not** the application root.
It defaults to this repository's `resources/ocr/` in Node or unpackaged
Electron, and to `path.join(process.resourcesPath, 'ocr')` when the module is
loaded from packaged Electron's `app.asar` (or `app.asar.unpacked`).

`recognizeSlots` accepts exactly three non-empty encoded image Buffers and
returns exactly three `{ text, confidence }` objects in the same order.
Confidence is clamped to 0..1. Inputs are never treated as URLs or file paths.
Requests are serialized; the worker is reused until an error, timeout, or
termination. Callers must keep image bytes stable until their request finishes.
The text mode remains a single line with `chi_sim+eng`, suitable for already
cropped slot titles. Recognition with raw confidence below 90/100 receives up
to three additional, deduplicated image variants: a 20px white border, a tight
foreground crop scaled to 2/3 with that border, and a tight crop normalized to
32px foreground height with that border. Only transcripts repeated across at
least two distinct images can replace the initial result. Selection preserves
the highest original Tesseract word-level confidence for that transcript; it
does not award a confidence bonus for agreement. High-confidence originals
skip these retries, including English. Unsupported image layouts keep the
original reading.

Preprocessing runs in the owning Node worker using the shipped Leptonica WASM
decoder and in-memory BMP variants, with no new dependency or filesystem image
outputs. The decoder is lazy and reused, with an additional WASM instance only
after an uncertain reading. It supports monochrome, 8-bit grey, and 32-bit RGB/
RGBA images without palettes, with dimension/allocation bounds. The private
Leptonica bindings are covered by tests against the locked core version.
No screen capture or preview is performed here.

Initialization times out after 45 seconds; each slot after 30 seconds. A failed
batch rejects as a whole and destroys the worker, including nested Tesseract
workers. The next request creates a fresh worker. `terminate()` cancels active
work, rejects queued work, and permanently closes the engine; it is idempotent.
Errors and logger callbacks do not record image contents or credentials.

All language reads use an absolute local `langPath` with `gzip: true` and
`cacheMethod: 'none'`. Model read failures fail the batch; no CDN fallback is
enabled; the nested worker's fetch adapter also rejects network access.
Tesseract's virtual WASM filesystem remains in memory; no model cache
is written into the application bundle or working directory.

The native worker wrapper lives in `extraResources/ocr`, outside ASAR. Native
worker entry, JS glue, WASM, and all production dependencies are accessible on
disk because `asarUnpack` covers `node_modules/**/*`. Resolution uses
`createRequire` and maps `app.asar/` to `app.asar.unpacked/` for both Windows and
POSIX paths. An explicit disk `corePath` is supplied, but Tesseract.js 6.0.1's
Node backend ignores that option and resolves core by package name next to
its own worker; the unpacked production dependency closure is therefore
required. Core supports both SIMD and non-SIMD LSTM WASM locally.

Production requires only Tesseract.js and its transitive npm dependencies;
language npm packages are build-only devDependencies. Runtime requires no
external OCR executable, Python, language installation, model download, or
network connection. Keep `ocr/` and `app.asar.unpacked/` with the packaged app.
