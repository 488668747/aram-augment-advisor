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
  coreItems.map(({ games, wins, winRate, pickRate }) => ({ games, wins, winRate, pickRate })));
});
