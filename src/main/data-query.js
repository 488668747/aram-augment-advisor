import { readActiveDataFile, readActiveDataSet } from './data-store.js';

function byWinRateThenGames(left, right) {
  const winRateDifference = (right.stats?.winRate ?? -1) - (left.stats?.winRate ?? -1);
  if (winRateDifference !== 0) return winRateDifference;
  return (right.stats?.games ?? 0) - (left.stats?.games ?? 0);
}

function itemSetKey(itemIds) {
  return [...itemIds].sort((a, b) => a - b).join(',');
}

function normalizeBuildRoute(record, itemIds, kind, itemMap) {
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 6
    || new Set(itemIds).size !== itemIds.length
    || itemIds.some(id => !Number.isInteger(id) || id <= 0 || !itemMap.has(id))) return null;

  const hasCounts = Number.isInteger(record.games) && record.games > 0
    && Number.isInteger(record.wins) && record.wins >= 0 && record.wins <= record.games;
  if (kind !== 'core' && !hasCounts) return null;

  return {
    itemIds,
    items: itemIds.map(id => itemMap.get(id)),
    kind,
    games: hasCounts ? record.games : null,
    wins: hasCounts ? record.wins : null,
    winRate: hasCounts ? record.wins / record.games : null,
    pickRate: Number.isFinite(record.pickRate) && record.pickRate >= 0 && record.pickRate <= 1
      ? record.pickRate : null,
  };
}

function uniqueBuildRoutes(routes) {
  const byItems = new Map();
  for (const route of routes.filter(Boolean)) {
    const key = itemSetKey(route.itemIds);
    const previous = byItems.get(key);
    // 上游不同排列或核心拆分的样本可能重叠，保留最大样本，不能直接相加。
    if (!previous || (route.games ?? 0) > (previous.games ?? 0)
      || (route.games === previous.games && route.kind === 'full')) byItems.set(key, route);
  }
  return [...byItems.values()].sort((a, b) => (b.games ?? 0) - (a.games ?? 0));
}

function createBuildRoutes(build, itemMap) {
  const coreRoutes = uniqueBuildRoutes((build.coreItems ?? []).map(record =>
    normalizeBuildRoute(record, record.itemIds, 'core', itemMap)));
  const coreKeys = new Set(coreRoutes.map(route => itemSetKey(route.itemIds)));
  const fullRoutes = (build.fullItems ?? []).filter(record => record.itemIds?.length >= 5)
    .map(record => normalizeBuildRoute(record, record.itemIds, 'full', itemMap));
  const extensions = (build.itemExtensions ?? []).filter(record =>
    Array.isArray(record.coreItemIds) && Array.isArray(record.itemIds)
    && record.itemIds.length > 0 && coreKeys.has(itemSetKey(record.coreItemIds))
    && (record.step === undefined || record.step === record.itemIds.length))
    .map(record => normalizeBuildRoute(record,
      [...record.coreItemIds, ...record.itemIds], 'extended', itemMap));
  const routes = uniqueBuildRoutes([...fullRoutes, ...extensions]);
  if (routes.length === 0) return coreRoutes.slice(0, 3);
  const longest = Math.max(...routes.map(route => route.items.length));
  // 优先六件（含鞋），缺少六件统计时降级到五件；不拆截或凭单件数据补齐。
  return routes.filter(route => route.items.length === longest).slice(0, 3);
}

export function createChampionOverview({ champion, details, items }) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const build = details.build ?? details.builds?.[0] ?? null;
  const recommendedRoutes = build ? createBuildRoutes(build, itemMap) : [];

  return {
    champion: details.champion ?? champion,
    augments: [...(details.augments ?? [])].sort(byWinRateThenGames),
    build: build
      ? {
        ...build,
        recommendedRoutes,
      }
      : null,
  };
}

export async function readChampionList(dataRoot) {
  const payload = await readActiveDataFile(dataRoot, 'champions.json');
  return payload.data ?? [];
}

export async function readChampionOverview(dataRoot, championId) {
  const [championsPayload, details, itemsPayload] = await Promise.all([
    readActiveDataFile(dataRoot, 'champions.json'),
    readActiveDataFile(dataRoot, `champions/${championId}.json`),
    readActiveDataFile(dataRoot, 'items.json'),
  ]);
  const champion = (championsPayload.data ?? []).find((item) => item.id === championId);
  const overview = createChampionOverview({
    champion,
    details,
    items: itemsPayload.data ?? [],
  });
  const active = await readActiveDataSet(dataRoot);

  return {
    dataVersion: active.manifest.dataVersion,
    gamePatch: active.manifest.gamePatch,
    ...overview,
  };
}
