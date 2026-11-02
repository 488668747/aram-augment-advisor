import assert from 'node:assert/strict';
import test from 'node:test';
import { OverlayController } from '../src/main/overlay-controller.js';

const frames = ['甲强化', '乙强化', '丙强化'].map(text => ({ text, confidence: .99 }));
const catalog = frames.map((r, i) => ({ id: i + 1, name: r.text, rarity: 1 }));
function setup(overrides = {}) {
  let captures = 0, shows = 0, hides = 0;
  const controller = new OverlayController({
    capture: async () => { captures++; return [Buffer.from('a'),Buffer.from('b'),Buffer.from('c')]; },
    recognizeSlots: async () => frames,
    loadData: async () => ({ catalog, augments: catalog.map(a => ({ ...a, stats: { winRate: .5, games: 100 } })) }),
    onState: () => {}, show: () => shows++, hide: () => hides++, autoSchedule: false,
    ...overrides,
  });
  return { controller, counts: () => ({ captures, shows, hides }) };
}

test('只有启用且已知英雄的实际对局可截图，识别完整三卡后显示', async () => {
  const { controller, counts } = setup();
  await controller.scanOnce();
  controller.updateSession({status:'connected', phase:'ChampSelect',championId:17});
  await controller.scanOnce();
  assert.equal(counts().captures,0);
  controller.updateSession({status:'connected', phase:'InProgress',championId:17});
  await controller.scanOnce();
  assert.equal(counts().captures,1);
  assert.equal(counts().shows,1);
  assert.deepEqual(controller.getState().slots.map(x=>x.augmentId),[1,2,3]);
  controller.setEnabled(false);
  await controller.scanOnce();
  assert.equal(counts().captures,1);
  assert.equal(controller.getState().visible,false);
  controller.dispose();
});

test('退出阶段或关闭后不能展示过期异步结果，重复识别请求不并发', async () => {
  let finish;
  const {controller,counts}=setup({recognizeSlots:()=>new Promise(resolve=>{finish=resolve;})});
  controller.updateSession({status:'connected',phase:'InProgress',championId:17});
  const first=controller.scanOnce();
  await new Promise(resolve=>setImmediate(resolve));
  const second=controller.scanOnce();
  assert.equal(counts().captures,1);
  controller.updateSession({status:'connected',phase:'Lobby',championId:0});
  finish(frames);
  await Promise.all([first,second]);
  assert.equal(counts().shows,0);
  assert.equal(controller.getState().visible,false);
  controller.dispose();
});

test('部分识别保留槽位，连续漏读清空，不从单卡或重复三卡打开浮窗', async () => {
  let readings=[frames[0],frames[0],frames[0]];
  const {controller,counts}=setup({recognizeSlots:async()=>readings});
  controller.updateSession({status:'connected',phase:'InProgress',championId:17});
  await controller.scanOnce();assert.equal(counts().shows,0);
  readings=frames;await controller.scanOnce();assert.equal(counts().shows,1);
  readings=[frames[0],{text:'',confidence:0},frames[2]];
  await controller.scanOnce();assert.deepEqual(controller.getState().slots.map(x=>x.missing),[false,true,false]);
  readings=[];
  await controller.scanOnce();await controller.scanOnce();
  assert.equal(controller.getState().visible,false);
  assert(controller.getState().slots.every(x=>x.missing));
  controller.dispose();
});
