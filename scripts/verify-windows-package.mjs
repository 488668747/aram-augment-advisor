import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile } from '@electron/asar';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(project, 'dist');
const resources = path.join(dist, 'win-unpacked', 'resources');
const archive = path.join(resources, 'app.asar');
const packed = JSON.parse(extractFile(archive, 'package.json'));
const version = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')).version;
assert.equal(packed.version, version, '安装包版本与代码版本不一致');
if (process.env.RELEASE_TAG) assert.equal(process.env.RELEASE_TAG, `v${version}`);

for (const filename of ['src/main/main.js', 'src/main/lcu-service.js', 'src/main/overlay-manager.js',
  'src/main/overlay-controller.js', 'src/main/ocr-engine.js', 'src/preload/preload.cjs',
  'src/renderer/overlay.js', 'src/renderer/renderer.js']) {
  assert.deepEqual(extractFile(archive, filename), await readFile(path.join(project, filename)), filename);
}
const executable = await readFile(path.join(dist, 'win-unpacked', '海克斯大乱斗助手.exe'));
assert.equal(executable.readUInt16LE(executable.readUInt32LE(0x3c) + 4), 0x8664, '程序必须是 x64');
const digest = data => createHash('sha256').update(data).digest('hex');
const { models } = JSON.parse(await readFile(path.join(resources, 'ocr', 'models.json'), 'utf8'));
for (const model of models) {
  const data = await readFile(path.join(resources, 'ocr', 'tessdata', `${model.language}.traineddata.gz`));
  assert.equal(digest(data), model.sha256, `OCR 模型损坏：${model.language}`);
}
for (const filename of ['worker.cjs', 'tesseract-worker.cjs', 'image-variants.cjs']) {
  assert.deepEqual(await readFile(path.join(resources, 'ocr', filename)), await readFile(path.join(project, 'resources', 'ocr', filename)));
}
for (const filename of ['tesseract.js/src/worker-script/node/index.js', 'tesseract.js-core/tesseract-core-lstm.wasm',
  'tesseract.js-core/tesseract-core-simd-lstm.wasm']) {
  assert((await stat(path.join(resources, 'app.asar.unpacked', 'node_modules', filename))).isFile(), filename);
}
const dataRoot = path.join(resources, 'data', 'runtime');
const pointer = JSON.parse(await readFile(path.join(dataRoot, 'current.json'), 'utf8'));
const versionRoot = path.join(dataRoot, 'versions', pointer.dataVersion);
const manifest = JSON.parse(await readFile(path.join(versionRoot, 'manifest.json'), 'utf8'));
assert.equal(manifest.dataVersion, pointer.dataVersion);
assert(manifest.files.length > 0, '安装包必须内置统计数据');
for (const file of manifest.files) assert.equal(digest(await readFile(path.join(versionRoot, file.path))), file.sha256, file.path);

const filename = `aram-augment-advisor-${version}-win-x64-setup.exe`;
const installer = await readFile(path.join(dist, filename));
assert.equal(installer.toString('ascii', 0, 2), 'MZ', '安装包不是 Windows 可执行文件');
const sha256 = digest(installer);
await writeFile(path.join(dist, `${filename}.sha256`), `${sha256}  ${filename}\n`);
const info = { version, commit: process.env.GITHUB_SHA ?? null, platform: 'win32', architecture: 'x64',
  installer: filename, bytes: installer.length, sha256, dataVersion: pointer.dataVersion,
  dataFiles: manifest.files.length, offlineOcrLanguages: models.map(model => model.language) };
await writeFile(path.join(dist, 'release-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(JSON.stringify(info, null, 2));
