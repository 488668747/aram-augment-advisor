import { readActiveDataFile, readActiveDataSet } from './data-store.js';

function byWinRateThenGames(left, right) {
  const winRateDifference = (right.stats?.winRate ?? -1) - (left.stats?.winRate ?? -1);
  if (winRateDifference !== 0) return winRateDifference;
  return (right.stats?.games ?? 0) - (left.stats?.games ?? 0);
}

export function createChampionOverview({ champion, details, items }) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const build = details.build ?? details.builds?.[0] ?? null;
  const coreItems = build?.coreItems ?? [];
  const recommendedRoutes = coreItems.map((route) => ({
    ...route,
    items: (route.itemIds ?? []).map((itemId) => itemMap.get(itemId)).filter(Boolean),
  })).filter((route) => route.items.length > 0);

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
