import assert from 'node:assert/strict';
import test from 'node:test';

import { createChampionOverview } from '../src/main/data-query.js';

test('按当前英雄整理海克斯和推荐装备', () => {
  const overview = createChampionOverview({
    champion: {
      id: 1,
      name: '安妮',
      stats: { winRate: 0.49 },
    },
    details: {
      augments: [
        { id: 1, name: '低胜率', stats: { winRate: 0.48, games: 1000 } },
        { id: 2, name: '高胜率', stats: { winRate: 0.58, games: 100 } },
      ],
      build: {
        coreItems: [{ itemIds: [3089] }],
      },
    },
    items: [{ id: 3089, name: '灭世者的死亡之帽', iconUrl: 'item.png' }],
  });

  assert.equal(overview.augments[0].name, '高胜率');
  assert.equal(overview.build.recommendedRoutes[0].items[0].name, '灭世者的死亡之帽');
});

test('共享核心装备的多套出装保持独立组合及各自统计', () => {
  const coreItems = [
    { itemIds: [3084, 3111, 2502], games: 4145, wins: 2130, winRate: 0.5139, pickRate: 0.1466 },
    { itemIds: [3084, 3111, 3065], games: 3683, wins: 1928, winRate: 0.5235, pickRate: 0.1303 },
    { itemIds: [3084, 3111, 3083], games: 2386, wins: 1258, winRate: 0.5272, pickRate: 0.0844 },
  ];
  const overview = createChampionOverview({
    champion: { id: 223, name: '塔姆' },
    details: { build: { coreItems } },
    items: [
      { id: 3084, name: '心之钢' }, { id: 3111, name: '水银之靴' },
      { id: 2502, name: '无终恨意' }, { id: 3065, name: '振奋盔甲' },
      { id: 3083, name: '狂徒铠甲' },
    ],
  });

  assert.equal(overview.build.recommendedRoutes?.length, 3);
  assert.deepEqual(overview.build.recommendedRoutes.map(route => route.items.map(item => item.id)),
    coreItems.map(route => route.itemIds));
  assert.deepEqual(overview.build.recommendedRoutes.map(({ games, wins, winRate, pickRate }) =>
    ({ games, wins, winRate, pickRate })),
  coreItems.map(({ games, wins, pickRate }) => ({ games, wins, winRate: wins / games, pickRate })));
});

const buildItems = [3118, 3020, 6653, 3089, 3135, 4645, 3165, 2503]
  .map(id => ({ id, name: String(id) }));

function queryBuild(build) {
  return createChampionOverview({ champion: { id: 17 }, details: { build }, items: buildItems })
    .build.recommendedRoutes;
}

test('同装备不同排列只保留最大样本记录，不累计样本或胜率', () => {
  const routes = queryBuild({ coreItems: [
    { itemIds: [3118, 3020, 6653], games: 7735, wins: 3799 },
    { itemIds: [3118, 6653, 3020], games: 3652, wins: 1889 },
    { itemIds: [6653, 3020, 3118], games: 3355, wins: 1716 },
  ] });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].games, 7735);
  assert.equal(routes[0].winRate, 3799 / 7735);
});

test('用匹配核心的六件装扩展统计，不能沿用三件套胜率', () => {
  const routes = queryBuild({
    coreItems: [{ itemIds: [3118, 3020, 6653], games: 7735, wins: 3799 }],
    itemExtensions: [
      { coreItemIds: [3020, 3118, 6653], step: 2, itemIds: [3089, 4645], games: 1141, wins: 593 },
      { coreItemIds: [3020, 3118, 6653], step: 3, itemIds: [3089, 3135, 4645], games: 395, wins: 222 },
      { coreItemIds: [3020, 3118, 6653], step: 3, itemIds: [3089, 3165, 4645], games: 325, wins: 155 },
    ],
  });
  assert.equal(routes.length, 2);
  assert.equal(routes[0].items.length, 6);
  assert.equal(routes[0].games, 395);
  assert.equal(routes[0].winRate, 222 / 395);
  assert.equal(routes[0].kind, 'extended');
  assert.equal(routes[0].pickRate, null);
});

test('同一六件组合来自不同核心拆分时去重，使用最大样本记录', () => {
  const itemIds = [3118, 3020, 6653, 3089, 3135, 4645];
  const routes = queryBuild({
    coreItems: [
      { itemIds: [3118, 3020, 6653], games: 1000, wins: 500 },
      { itemIds: [3020, 3118, 4645], games: 500, wins: 300 },
    ],
    fullItems: [{ itemIds: [...itemIds].reverse(), games: 700, wins: 400 }],
    itemExtensions: [
      { coreItemIds: [3020, 3118, 6653], step: 3, itemIds: [3089, 3135, 4645], games: 395, wins: 222 },
      { coreItemIds: [3020, 3118, 4645], step: 3, itemIds: [3089, 3135, 6653], games: 100, wins: 50 },
    ],
  });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].games, 700);
  assert.equal(routes[0].kind, 'full');
  assert.equal(routes[0].winRate, 400 / 700);
});

test('没有六件装时保留五件装，用胜负数而非上游不一致的比例计算胜率', () => {
  const routes = queryBuild({
    coreItems: [{ itemIds: [3118, 3020, 6653] }],
    itemExtensions: [{ coreItemIds: [3020, 3118, 6653], step: 2, itemIds: [3089, 4645], games: 100, wins: 60, winRate: 0.1 }],
  });
  assert.equal(routes[0].items.length, 5);
  assert.equal(routes[0].winRate, 0.6);
});

test('不把七件套截断为六件套，不接受重复装备或缺失装备的组合', () => {
  const routes = queryBuild({
    coreItems: [{ itemIds: [3118, 3020, 6653], games: 100, wins: 50 }],
    itemExtensions: [
      { coreItemIds: [3020, 3118, 6653], step: 4, itemIds: [3089, 3135, 3165, 4645], games: 80, wins: 40 },
      { coreItemIds: [3020, 3118, 6653], step: 3, itemIds: [3089, 4645, 9999], games: 80, wins: 40 },
      { coreItemIds: [3020, 3118, 6653], step: 3, itemIds: [3089, 4645, 3020], games: 80, wins: 40 },
    ],
  });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, 'core');
  assert.equal(routes[0].items.length, 3);
  assert.equal(routes[0].games, 100);
});

test('不拼接其他核心的扩展或用单件胜率填出完整出装', () => {
  const routes = queryBuild({
    coreItems: [{ itemIds: [3118, 3020, 6653] }],
    itemExtensions: [{ coreItemIds: [3020, 3118, 4645], step: 3, itemIds: [3089, 3135, 3165], games: 100, wins: 60 }],
    situationalItems: [{ id: 3089, games: 100, wins: 80 }],
  });
  assert.equal(routes[0].items.length, 3);
  assert.equal(routes[0].kind, 'core');
  assert.equal(routes[0].winRate, null);
});
