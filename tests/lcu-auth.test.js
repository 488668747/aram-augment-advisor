import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseLockfile, parseProcessConnection, parseLogConnection, readLogConnection } from '../src/main/lcu-client.js';
import { discoverLcuCandidates } from '../src/main/lcu-discovery.js';
import { LcuService } from '../src/main/lcu-service.js';

const command = '"D:\\WeGameApps\\英雄联盟\\LeagueClient\\LeagueClientUx.exe" --app-port=2999 --remoting-auth-token=fixture-token';

test('进程启动参数支持等号、空格和引号，不把 Riot Client 的参数当成 LCU', () => {
  assert.deepEqual(parseProcessConnection(command, { Name: 'LeagueClientUx.exe', ProcessId: 123 }), {
    name: 'LeagueClientUx.exe', pid: '123', port: 2999, token: 'fixture-token', protocol: 'https',
  });
  assert.equal(parseProcessConnection('--app-port "2999" "--remoting-auth-token=fixture-token"').port, 2999);
  assert.equal(parseProcessConnection('--riotclient-app-port=2999 --riotclient-auth-token=wrong'), null);
  assert.equal(parseProcessConnection('--app-port=70000 --remoting-auth-token=fixture-token'), null);
});

test('连接文件支持 UTF-8 BOM、UTF-16 LE/BE，不接受空文件或超范围端口', () => {
  const text = 'LeagueClient:123:2999:fixture-token:https';
  for (const bytes of [Buffer.from(`\uFEFF${text}`), Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')]),
    Buffer.concat([Buffer.from([254, 255]), Buffer.from(text, 'utf16le').swap16()])]) {
    assert.equal(parseLockfile(bytes).port, 2999);
  }
  assert.throws(() => parseLockfile(''), /为空/);
  assert.throws(() => parseLockfile('LeagueClient:123:70000:fixture-token:https'), /有效字段/);
  assert.throws(() => parseLockfile('unrelated fixture-token data'), error => !error.message.includes('fixture-token'));
});

test('日志仅从同一条记录提取端口和令牌，不拼接不同记录', () => {
  assert.equal(parseLogConnection(`old --app-port=2999\nother --remoting-auth-token=wrong`), null);
  assert.equal(parseLogConnection(`line ${command}`).token, 'fixture-token');
  assert.equal(parseLogConnection('LCU https://riot:fixture-token@127.0.0.1:2999').port, 2999);
});

test('日志分段读取不能把截断的端口或令牌当成完整认证信息', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aram-lcu-log-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'LeagueClientUx.log');
  const first = 'LCU http://riot:fixture-token@127.0.0.1:2999\n';
  const partial = '\nhttp://riot:cut-token@127.0.0.1:3';
  await writeFile(filename, first + 'x'.repeat(256 * 1024 - first.length - partial.length)
    + partial + '0000\n' + 'padding\n'.repeat(50000));
  assert.equal((await readLogConnection(filename)).port, 2999);
});

test('没有 lockfile 也能通过同一个客户端进程的参数发现并连接', async () => {
  const candidates = await discoverLcuCandidates({ platform: 'win32', env: {}, exists: () => false,
    exec: async () => ({ stdout: JSON.stringify({ Name: 'LeagueClientUx.exe', ProcessId: 123,
      ExecutablePath: 'D:\\WeGameApps\\英雄联盟\\LeagueClient\\LeagueClientUx.exe', CommandLine: command }) }),
    listLogs: async () => [],
  });
  const service = new LcuService({ findLockfile: async () => candidates,
    createClient: connection => { assert.equal(connection.token, 'fixture-token'); return { getGameflowPhase: async () => 'Lobby' }; },
  });
  assert.deepEqual(await service.getSnapshot(), { status: 'connected', phase: 'Lobby', championId: 0 });
});

test('手动目录的空 lockfile 可通过客户端日志兜底，失败快照不含认证信息', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aram-lcu-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = path.join(directory, 'LeagueClient');
  await mkdir(client);
  await writeFile(path.join(client, 'lockfile'), '');
  await writeFile(path.join(client, 'LeagueClientUx.log'), `startup\n${command}\n`);
  const candidates = await discoverLcuCandidates({ configuredPath: directory, env: {}, platform: process.platform,
    exec: async () => ({ stdout: process.platform === 'win32' ? '[]' : '' }),
  });
  const service = new LcuService({ findLockfile: async () => candidates,
    createClient: connection => { assert.equal(connection.token, 'fixture-token'); return { getGameflowPhase: async () => 'Lobby' }; },
  });
  assert.equal((await service.getSnapshot()).status, 'connected');
  assert(!JSON.stringify(await service.getSnapshot()).includes('fixture-token'));
});
