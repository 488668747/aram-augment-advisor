import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeRemoteManifest } from '../src/shared/data-source.js';

const remoteManifest = {
  service: 'aramgg-client-api',
  locale: 'zh-CN',
  gamePatch: '16.21',
  dataVersion: '16.21.5',
  generatedAt: '2026-11-02T00:00:00.000Z',
  files: [{
    path: 'champions/1.json',
    url: '/api/client/v1/data/16.21.5/champions/1.json',
    bytes: 10,
    hash: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }],
};

test('把远端 manifest 转换为本地可校验格式', () => {
  const manifest = normalizeRemoteManifest(remoteManifest, {
    locale: 'zh-CN',
    origin: 'https://data.example.com',
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.source.region, 'WORLD');
  assert.equal(manifest.files[0].sha256, 'a'.repeat(64));
  assert.equal(manifest.files[0].url, 'https://data.example.com/api/client/v1/data/16.21.5/champions/1.json');
});

test('拒绝跨来源的远端文件地址', () => {
  assert.throws(
    () => normalizeRemoteManifest({
      ...remoteManifest,
      files: [{
        ...remoteManifest.files[0],
        url: 'https://other.example.com/file.json',
      }],
    }, { locale: 'zh-CN', origin: 'https://data.example.com' }),
    /不在允许来源/,
  );
});
