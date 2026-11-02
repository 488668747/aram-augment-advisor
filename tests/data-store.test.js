import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { importDataVersion, readActiveDataSet } from '../src/main/data-store.js';

async function createDataRoot(manifest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aram-augment-advisor-'));
  const versionDir = path.join(root, 'versions', manifest.dataVersion);
  await mkdir(versionDir, { recursive: true });
  await writeFile(path.join(root, 'current.json'), JSON.stringify({
    dataVersion: manifest.dataVersion,
  }));
  await writeFile(path.join(versionDir, 'manifest.json'), JSON.stringify(manifest));
  return root;
}

async function createImportSource(dataVersion, { validHash = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aram-augment-advisor-source-'));
  const sampleData = JSON.stringify({ dataVersion, champions: [], augments: [], items: [] });
  const sha256 = createHash('sha256').update(sampleData).digest('hex');
  await writeFile(path.join(root, 'sample-data.json'), sampleData);
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    dataVersion,
    gamePatch: dataVersion.split('.').slice(0, 2).join('.'),
    locale: 'zh-CN',
    generatedAt: '2026-11-02T00:00:00.000Z',
    files: [{
      path: 'sample-data.json',
      sha256: validHash ? sha256 : '0'.repeat(64),
    }],
  }));
  return root;
}

test('读取当前激活的数据版本', async () => {
  const root = await createDataRoot({
    schemaVersion: 1,
    dataVersion: '16.21.5',
    gamePatch: '16.21',
    locale: 'zh-CN',
    generatedAt: '2026-11-02T00:00:00.000Z',
  });

  const active = await readActiveDataSet(root);

  assert.equal(active.manifest.dataVersion, '16.21.5');
  assert.equal(active.manifest.gamePatch, '16.21');
  assert.equal(active.versionDirectory, path.join(root, 'versions', '16.21.5'));
});

test('拒绝缺少数据契约字段的激活版本', async () => {
  const root = await createDataRoot({
    dataVersion: '16.21.5',
    gamePatch: '16.21',
  });

  await assert.rejects(
    () => readActiveDataSet(root),
    /schemaVersion|locale|generatedAt/,
  );
});

test('拒绝 current.json 指向不同版本的 manifest', async () => {
  const root = await createDataRoot({
    schemaVersion: 1,
    dataVersion: '16.20.5',
    gamePatch: '16.21',
    locale: 'zh-CN',
    generatedAt: '2026-11-02T00:00:00.000Z',
  });

  await writeFile(path.join(root, 'current.json'), JSON.stringify({ dataVersion: '16.20.5' }));
  await writeFile(
    path.join(root, 'versions', '16.20.5', 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      dataVersion: '16.21.5',
      gamePatch: '16.21',
      locale: 'zh-CN',
      generatedAt: '2026-11-02T00:00:00.000Z',
    }),
  );

  await assert.rejects(
    () => readActiveDataSet(root),
    /指向版本|dataVersion/,
  );
});

test('导入有效数据包并原子激活新版本', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'aram-augment-advisor-data-'));
  const source = await createImportSource('16.21.5');

  const result = await importDataVersion({ sourceDirectory: source, dataRoot });
  const active = await readActiveDataSet(dataRoot);

  assert.equal(result.dataVersion, '16.21.5');
  assert.equal(active.manifest.dataVersion, '16.21.5');
});

test('导入校验失败时保留原激活版本', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'aram-augment-advisor-data-'));
  const firstSource = await createImportSource('16.20.5');
  const invalidSource = await createImportSource('16.21.5', { validHash: false });

  await importDataVersion({ sourceDirectory: firstSource, dataRoot });
  await assert.rejects(
    () => importDataVersion({ sourceDirectory: invalidSource, dataRoot }),
    /校验失败/,
  );

  const active = await readActiveDataSet(dataRoot);
  assert.equal(active.manifest.dataVersion, '16.20.5');
});
