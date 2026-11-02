import assert from 'node:assert/strict';
import test from 'node:test';

import { LcuClient, parseLockfile } from '../src/main/lcu-client.js';
import { discoverLockfilePath, extractInstallDirectory } from '../src/main/lcu-discovery.js';
import { createChampSelectSnapshot, LcuService } from '../src/main/lcu-service.js';

test('解析 LCU lockfile', () => {
  assert.deepEqual(parseLockfile('LeagueClient:1234:2999:secret:https'), {
    name: 'LeagueClient',
    pid: '1234',
    port: 2999,
    token: 'secret',
    protocol: 'https',
  });
});

test('LCU 客户端请求游戏阶段和选人 session', async () => {
  const calls = [];
  const client = new LcuClient(
    { port: 2999, token: 'secret', protocol: 'https' },
    async (pathname, connection) => {
      calls.push({ pathname, connection });
      return pathname.includes('gameflow') ? 'ChampSelect' : { localPlayerCellId: 7 };
    },
  );

  assert.equal(await client.getGameflowPhase(), 'ChampSelect');
  assert.deepEqual(await client.getChampSelectSession(), { localPlayerCellId: 7 });
  assert.deepEqual(calls.map((call) => call.pathname), [
    '/lol-gameflow/v1/gameflow-phase',
    '/lol-champ-select/v1/session',
  ]);
});

test('从 session 映射当前玩家英雄', () => {
  const snapshot = createChampSelectSnapshot({
    phase: 'ChampSelect',
    session: {
      localPlayerCellId: 7,
      myTeam: [{ cellId: 7, championId: 17 }],
    },
  });

  assert.deepEqual(snapshot, {
    status: 'connected',
    phase: 'ChampSelect',
    localPlayerCellId: 7,
    championId: 17,
  });
});

test('没有 lockfile 时保持未连接状态', async () => {
  const service = new LcuService({ findLockfile: async () => null });
  assert.deepEqual(await service.getSnapshot(), {
    status: 'disconnected',
    phase: 'Unavailable',
    championId: 0,
  });
});

test('LCU 服务读取选人阶段并返回当前英雄', async () => {
  const service = new LcuService({
    findLockfile: async () => 'C:\\Riot Games\\League of Legends\\lockfile',
    read: async () => ({ port: 2999, token: 'secret', protocol: 'https' }),
    createClient: () => ({
      getGameflowPhase: async () => 'ChampSelect',
      getChampSelectSession: async () => ({
        localPlayerCellId: 3,
        myTeam: [{ cellId: 3, selectedChampionId: 17 }],
      }),
    }),
  });

  assert.deepEqual(await service.getSnapshot(), {
    status: 'connected',
    phase: 'ChampSelect',
    localPlayerCellId: 3,
    championId: 17,
  });
});

test('从进程命令行提取安装目录和 lockfile', async () => {
  assert.equal(
    extractInstallDirectory('--install-directory="C:\\Riot Games\\League of Legends"'),
    'C:\\Riot Games\\League of Legends',
  );

  const lockfilePath = await discoverLockfilePath({
    env: {},
    platform: 'win32',
    exists: (value) => value === 'C:\\Riot Games\\League of Legends\\lockfile',
    exec: async () => ({ stdout: 'LeagueClientUx.exe --install-directory="C:\\Riot Games\\League of Legends"\n' }),
  });
  assert.equal(lockfilePath, 'C:\\Riot Games\\League of Legends\\lockfile');
});
