import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readActiveDataSet } from '../src/main/data-store.js';

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
