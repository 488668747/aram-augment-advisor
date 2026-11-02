import assert from 'node:assert/strict';
import test from 'node:test';
import { matchAugmentSlots } from '../src/main/augment-matching.js';

const catalog = [
  { id: 1, name: '小蜜蜂！！！', rarityName: 'gold' },
  { id: 2, name: '尤里卡', rarityName: 'prismatic' },
  { id: 3, name: '侵蚀', rarity: 0 },
];
const stats = [{ id: 1, stats: { winRate: 0.61, games: 1200 } }, { id: 3, stats: { winRate: 0, games: 10 } }];

test('规范化中文空白标点，按左中右槽位补齐当前英雄统计', () => {
  const slots = matchAugmentSlots([
    { text: '小 蜜 蜂!!!', confidence: .95 }, { text: '尤里卡\n', confidence: .9 }, { text: '侵蚀', confidence: .99 },
  ], catalog, stats);
  assert.deepEqual(slots.map(x => x.augmentId), [1, 2, 3]);
  assert.equal(slots[0].winRate, .61);
  assert.equal(slots[1].winRate, null);
  assert.equal(slots[2].winRate, 0);
  assert.equal(slots[2].rarity, 'silver');
});

test('漏读、低置信度和重名不挪动槽位、不拿全局胜率冒充英雄胜率', () => {
  const slots = matchAugmentSlots([
    { text: '无法识别', confidence: .99 }, { text: '尤里卡', confidence: .2 }, { text: '侵蚀', confidence: .99 },
  ], catalog, stats);
  assert.deepEqual(slots.map(x => x.missing), [true, true, false]);
  assert.deepEqual(slots.map(x => x.slot), [0, 1, 2]);
  const ambiguous = matchAugmentSlots([{ text: '尤里卡', confidence: .99 }], [...catalog, { id: 4, name: '尤里卡' }], []);
  assert.equal(ambiguous[0].missing, true);
});

test('仅对原名感叹号后缀容忍 OCR 将叹号读成 1 或 l，不删掉真实名称数字',()=>{
 const special=[{id:1,name:'小蜜蜂！！！'},{id:2,name:'强化1'},{id:3,name:'强化'}];
 const readings=[{text:'小 蜜蜂 ! 1 !',confidence:.69},{text:'强化1',confidence:.8},{text:'强化2',confidence:.8}];
 const slots=matchAugmentSlots(readings,special,[]);
 assert.deepEqual(slots.map(s=>s.augmentId??null),[1,2,null]);
});
