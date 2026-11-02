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
  assert.equal(overview.build.recommendedItems[0].name, '灭世者的死亡之帽');
});
