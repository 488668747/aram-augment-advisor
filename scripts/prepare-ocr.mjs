import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../resources/ocr/', import.meta.url));
const { models } = JSON.parse(await readFile(path.join(root, 'models.json'), 'utf8'));

// No downloads or install hooks: all inputs come from npm ci and its lockfile.
// Validate every source before replacing any generated model.
const verified = [];
for (const model of models) {
  let packagePath;
  try {
    packagePath = require.resolve(`${model.package}/package.json`);
  } catch {
    throw new Error(`Missing ${model.package}@${model.version}; run npm ci (including devDependencies)`);
  }
  const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
  if (metadata.version !== model.version || metadata.license !== 'MIT') {
    throw new Error(`Unexpected version or license for ${model.package}`);
  }
  const data = await readFile(path.join(path.dirname(packagePath), model.source));
  if (data.length !== model.bytes || createHash('sha256').update(data).digest('hex') !== model.sha256) {
    throw new Error(`Model integrity check failed for ${model.language}`);
  }
  gunzipSync(data); // Also reject corrupt/truncated archives before packaging.
  verified.push({ model, data });
}

const destination = path.join(root, 'tessdata');
await mkdir(destination, { recursive: true });
for (const { model, data } of verified) {
  await writeFile(path.join(destination, `${model.language}.traineddata.gz`), data);
  console.log(`Prepared offline OCR model: ${model.language} (${data.length} bytes, SHA-256 verified)`);
}
