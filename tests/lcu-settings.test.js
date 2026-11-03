import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeClientDirectory } from '../src/main/lcu-discovery.js';
import { loadLcuSettings, saveLcuSettings, validateClientDirectory } from '../src/main/lcu-settings.js';

test('支持粘贴带引号的 Windows 中文客户端程序或连接文件路径', () => {
  assert.equal(normalizeClientDirectory(' "D:\\腾讯游戏\\英雄联盟\\LeagueClient\\LeagueClient.exe" ', 'win32'), 'D:\\腾讯游戏\\英雄联盟\\LeagueClient');
  assert.equal(normalizeClientDirectory('D:\\英雄联盟\\LeagueClient\\lockfile', 'win32'), 'D:\\英雄联盟\\LeagueClient');
  assert.equal(normalizeClientDirectory('D:\\英雄联盟\\LeagueClient', 'win32'), 'D:\\英雄联盟\\LeagueClient');
  assert.throws(() => normalizeClientDirectory('英雄联盟', 'win32'), /完整/);
  assert.throws(() => normalizeClientDirectory(null, 'win32'), /文字/);
});

test('没有运行客户端时仍可通过 LeagueClient.exe 验证并保存根目录', () => {
  assert.equal(validateClientDirectory('E:\\WeGameApps\\英雄联盟', { platform: 'win32',
    isFile: filename => filename === 'E:\\WeGameApps\\英雄联盟\\LeagueClient\\LeagueClient.exe',
  }), 'E:\\WeGameApps\\英雄联盟');
  assert.throws(() => validateClientDirectory('E:\\WeGame', { platform: 'win32', isFile: () => false }), /不要选择 WeGame/);
  assert.equal(validateClientDirectory(''), '');
});

test('客户端路径配置重启后保留，清除后恢复自动检测，损坏配置可恢复', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'aram-lcu-settings-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const filename = path.join(temporary, 'user', 'lcu-settings.json');
  const directory = path.join(temporary, '英雄联盟');
  await mkdir(directory);
  await writeFile(path.join(directory, 'LeagueClient.exe'), 'fixture');
  assert.deepEqual(await loadLcuSettings(filename), { clientDirectory: '' });
  await saveLcuSettings(filename, validateClientDirectory(directory));
  assert.deepEqual(await loadLcuSettings(filename), { clientDirectory: directory });
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), { clientDirectory: directory });
  await saveLcuSettings(filename, '');
  assert.deepEqual(await loadLcuSettings(filename), { clientDirectory: '' });
  await writeFile(filename, '{broken');
  assert.deepEqual(await loadLcuSettings(filename), { clientDirectory: '' });
});
