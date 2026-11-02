import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { importDataVersion } from '../src/main/data-store.js';
import { normalizeRemoteManifest } from '../src/shared/data-source.js';

const apiOrigin = process.env.ARAM_DATA_ORIGIN ?? 'https://data.dtodo.cn';
const dataRoot = path.resolve(process.env.ARAM_DATA_ROOT ?? 'data/runtime');
const locale = 'zh-CN';
const concurrency = Math.max(1, Number(process.env.ARAM_DATA_CONCURRENCY ?? 6));

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`请求失败 ${response.status}: ${url}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(attempt * 500);
    }
  }

  throw lastError;
}

async function fetchJson(url) {
  return (await fetchWithRetry(url)).json();
}

async function downloadFile(file, target) {
  const response = await fetchWithRetry(file.url);
  const content = Buffer.from(await response.arrayBuffer());
  if (file.bytes !== undefined && content.byteLength !== file.bytes) {
    throw new Error(`文件大小校验失败：${file.path}`);
  }

  const actualHash = createHash('sha256').update(content).digest('hex');
  if (actualHash !== file.sha256) throw new Error(`文件哈希校验失败：${file.path}`);

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function downloadWithConcurrency(files, download) {
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= files.length) return;
      await download(files[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, () => worker()),
  );
}

const config = await fetchJson(`${apiOrigin}/api/client/v1/config?locale=${locale}`);
if (config.locale !== locale) throw new Error(`配置语言不匹配：${String(config.locale)}`);

const manifestUrl = new URL(config.manifest, apiOrigin).toString();
const remoteManifest = await fetchJson(manifestUrl);
const manifest = normalizeRemoteManifest(remoteManifest, { locale, origin: apiOrigin });
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'aram-augment-advisor-sync-'));
const temporaryVersionDirectory = path.join(temporaryRoot, manifest.dataVersion);

try {
  await mkdir(temporaryVersionDirectory, { recursive: true });
  await downloadWithConcurrency(
    manifest.files,
    (file) => downloadFile(file, path.join(temporaryVersionDirectory, file.path)),
  );
  await writeFile(
    path.join(temporaryVersionDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const result = await importDataVersion({
    sourceDirectory: temporaryVersionDirectory,
    dataRoot,
    replaceExisting: true,
  });
  console.log(`已同步全球数据：${result.dataVersion}（${manifest.files.length} 个文件）`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
