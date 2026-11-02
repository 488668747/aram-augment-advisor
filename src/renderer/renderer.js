const statusElement = document.querySelector('#status');
const lcuStatusElement = document.querySelector('#lcu-status');
const dataVersionElement = document.querySelector('#data-version');
const gamePatchElement = document.querySelector('#game-patch');
const dataSourceElement = document.querySelector('#data-source');
const syncButton = document.querySelector('#sync-button');
const championSelect = document.querySelector('#champion-select');
const championCard = document.querySelector('#champion-card');
const championIcon = document.querySelector('#champion-icon');
const championName = document.querySelector('#champion-name');
const championTitle = document.querySelector('#champion-title');
const championWinRate = document.querySelector('#champion-win-rate');
const championPatch = document.querySelector('#champion-patch');
const augmentList = document.querySelector('#augment-list');
const itemList = document.querySelector('#item-list');
const detailError = document.querySelector('#detail-error');
let champions = [];
let lastLcuChampionId = 0;

function formatPercent(value) {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '暂无数据';
}

function setImage(image, url, alt) {
  image.src = url ?? '';
  image.alt = alt;
  image.onerror = () => {
    image.removeAttribute('src');
  };
}

function renderAugments(augments) {
  augmentList.replaceChildren();
  for (const augment of augments.slice(0, 20)) {
    const card = document.createElement('div');
    card.className = 'augment';
    const icon = document.createElement('img');
    setImage(icon, augment.iconUrl, augment.name);
    const main = document.createElement('div');
    main.className = 'augment-main';
    const name = document.createElement('div');
    name.className = 'augment-name';
    name.textContent = augment.name;
    const meta = document.createElement('div');
    meta.className = 'augment-meta';
    meta.textContent = `${formatPercent(augment.stats?.winRate)} · ${augment.stats?.games ?? 0} 场`;
    main.append(name, meta);
    card.append(icon, main);
    augmentList.append(card);
  }
}

function renderItems(items) {
  itemList.replaceChildren();
  for (const item of items.slice(0, 9)) {
    const card = document.createElement('div');
    card.className = 'item';
    const icon = document.createElement('img');
    setImage(icon, item.iconUrl, item.name);
    const main = document.createElement('div');
    main.className = 'item-main';
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = item.name;
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = '推荐核心装备';
    main.append(name, meta);
    card.append(icon, main);
    itemList.append(card);
  }
}

async function loadChampionOverview(championId) {
  detailError.hidden = true;
  try {
    const overview = await window.aramAugmentAdvisor.data.getChampionOverview(championId);
    championCard.hidden = false;
    setImage(championIcon, overview.champion?.iconUrl, overview.champion?.name ?? '英雄');
    championName.textContent = overview.champion?.name ?? '未知英雄';
    championTitle.textContent = overview.champion?.title ?? '—';
    championWinRate.textContent = formatPercent(overview.champion?.stats?.winRate);
    championPatch.textContent = overview.gamePatch;
    renderAugments(overview.augments ?? []);
    renderItems(overview.build?.recommendedItems ?? []);
  } catch (error) {
    championCard.hidden = true;
    detailError.hidden = false;
    detailError.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function loadLocalData() {
  const active = await window.aramAugmentAdvisor.data.getActive();
  statusElement.textContent = '本地数据已加载';
  dataVersionElement.textContent = active.dataVersion;
  gamePatchElement.textContent = active.gamePatch;
  dataSourceElement.textContent = active.source?.region ?? '本地';

  champions = await window.aramAugmentAdvisor.data.getChampions();
  championSelect.replaceChildren();
  for (const champion of champions) {
    const option = document.createElement('option');
    option.value = String(champion.id);
    option.textContent = champion.name;
    championSelect.append(option);
  }
  championSelect.disabled = false;
  if (champions.length > 0) await loadChampionOverview(champions[0].id);
}

async function applyLcuSnapshot(snapshot) {
  if (snapshot.status === 'connected' && snapshot.phase === 'ChampSelect') {
    lcuStatusElement.textContent = '已连接，正在选人';
    if (snapshot.championId > 0 && champions.some((champion) => champion.id === snapshot.championId)) {
      championSelect.value = String(snapshot.championId);
      if (lastLcuChampionId !== snapshot.championId) {
        lastLcuChampionId = snapshot.championId;
        await loadChampionOverview(snapshot.championId);
      }
    }
    return;
  }

  if (snapshot.status === 'connected') {
    lcuStatusElement.textContent = `已连接，当前阶段：${snapshot.phase}`;
  } else if (snapshot.status === 'error') {
    lcuStatusElement.textContent = '连接失败';
  } else {
    lcuStatusElement.textContent = '未检测到 League Client';
  }
}

window.aramAugmentAdvisor.data.onSyncProgress(({ completed, total }) => {
  statusElement.textContent = `正在同步数据 ${completed}/${total}`;
});

window.aramAugmentAdvisor.lcu.onSnapshot((snapshot) => {
  applyLcuSnapshot(snapshot).catch((error) => {
    lcuStatusElement.textContent = error instanceof Error ? error.message : String(error);
  });
});

championSelect.addEventListener('change', () => loadChampionOverview(Number(championSelect.value)));

syncButton.addEventListener('click', async () => {
  syncButton.disabled = true;
  detailError.hidden = true;
  statusElement.textContent = '正在准备同步…';
  try {
    await window.aramAugmentAdvisor.data.sync();
    await loadLocalData();
    statusElement.textContent = '数据同步完成';
  } catch (error) {
    statusElement.textContent = '数据同步失败';
    detailError.hidden = false;
    detailError.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    syncButton.disabled = false;
  }
});

try {
  await loadLocalData();
  await applyLcuSnapshot(await window.aramAugmentAdvisor.lcu.getSnapshot());
} catch (error) {
  statusElement.textContent = '本地数据读取失败';
  statusElement.classList.add('error');
  dataSourceElement.textContent = error instanceof Error ? error.message : String(error);
}
