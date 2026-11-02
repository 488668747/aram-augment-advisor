import assert from 'node:assert/strict';
import test from 'node:test';

import { LcuClient, parseLockfile } from '../src/main/lcu-client.js';
import { discoverLockfilePath, extractInstallDirectory } from '../src/main/lcu-discovery.js';
import { createChampSelectSnapshot, LcuService, resolveGameflowChampion } from '../src/main/lcu-service.js';

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

test('保留选人英雄进入实际对局，回到大厅后清除本局英雄', async () => {
  let phase='ChampSelect', validGame=true;
  const service=new LcuService({findLockfile:async()=>'/test/lockfile',read:async()=>({}),
    createClient:()=>({getGameflowPhase:async()=>phase,getChampSelectSession:async()=>({localPlayerCellId:7,myTeam:[{cellId:7,championId:17}]}),getGameflowSession:async()=>phase==='InProgress'&&validGame?({gameData:{playerChampionSelections:[{summonerId:7,championId:17}]}}):{},getCurrentSummoner:async()=>({summonerId:7})})});
  assert.equal((await service.getSnapshot()).championId,17);
  phase='GameStart';assert.equal((await service.getSnapshot()).championId,17);
  phase='InProgress';assert.equal((await service.getSnapshot()).championId,17);
  phase='Lobby';assert.equal((await service.getSnapshot()).championId,0);
  validGame=false;phase='InProgress';assert.equal((await service.getSnapshot()).championId,0);
});

test('进入对局时核实最终英雄，不能继续使用最后一次选人快照',async()=>{
 let phase='ChampSelect';
 const service=new LcuService({findLockfile:async()=>'/test/lock',read:async()=>({}),createClient:()=>({
  getGameflowPhase:async()=>phase,
  getChampSelectSession:async()=>({localPlayerCellId:7,myTeam:[{cellId:7,championId:1}]}),
  getGameflowSession:async()=>({gameData:{playerChampionSelections:[{summonerId:7,championId:17},{summonerId:8,championId:55}]}}),
  getCurrentSummoner:async()=>({summonerId:7}),
 })});
 assert.equal((await service.getSnapshot()).championId,1);
 phase='InProgress';assert.equal((await service.getSnapshot()).championId,17);
});

test('对局无法核实自身英雄时不继续显示选人旧数据，并合并并发查询',async()=>{
 let phase='ChampSelect',queries=0;
 const service=new LcuService({findLockfile:async()=>'/test/lock',read:async()=>({}),createClient:()=>({
  getGameflowPhase:async()=>{queries++;return phase;},
  getChampSelectSession:async()=>({localPlayerCellId:7,myTeam:[{cellId:7,championId:1}]}),
  getGameflowSession:async()=>({gameData:{playerChampionSelections:[{summonerId:8,championId:55}]}}),
  getCurrentSummoner:async()=>({summonerId:7}),
 })});
 await Promise.all([service.getSnapshot(),service.getSnapshot()]);assert.equal(queries,1);
 phase='InProgress';assert.equal((await service.getSnapshot()).championId,0);
});


test('最终英雄按自身身份匹配，不能用无效 ID 或冲突记录猜测', () => {
  const game={gameData:{teamOne:[{puuid:'self',championId:17}],teamTwo:[{puuid:'other',championId:55}]}};
  assert.equal(resolveGameflowChampion(game,{puuid:'self'}),17);
  assert.equal(resolveGameflowChampion({gameData:{teamOne:[{summonerId:0,championId:55}]}},{summonerId:0}),0);
  assert.equal(resolveGameflowChampion({gameData:{teamOne:[{summonerId:7,championId:17}],playerChampionSelections:[{summonerId:7,championId:1}]}},{summonerId:7}),0);
});

test('对局查询期间阶段已结束时不继续返回 InProgress，身份冲突不认作自己',async()=>{
 const service=new LcuService({findLockfile:async()=>'/test/lock',read:async()=>({}),createClient:()=>({
  getGameflowPhase:async()=> 'InProgress',getGameflowSession:async()=>({phase:'EndOfGame',gameData:{teamOne:[{summonerId:7,championId:17}]}}),getCurrentSummoner:async()=>({summonerId:7}),
 })});
 assert.deepEqual(await service.getSnapshot(),{status:'connected',phase:'EndOfGame',championId:0});
 assert.equal(resolveGameflowChampion({gameData:{teamOne:[{summonerId:7,puuid:'other',championId:55}]}},{summonerId:7,puuid:'self'}),0);
});
