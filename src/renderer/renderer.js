const statusElement = document.querySelector('#status');
const lcuStatusElement = document.querySelector('#lcu-status');
const dataVersionElement = document.querySelector('#data-version');
const gamePatchElement = document.querySelector('#game-patch');
const dataSourceElement = document.querySelector('#data-source');
const syncButton = document.querySelector('#sync-button');
const championSelect = document.querySelector('#champion-select');
const championSearch = document.querySelector('#champion-search');
const championSearchHint = document.querySelector('#champion-search-hint');
const championCard = document.querySelector('#champion-card');
const championIcon = document.querySelector('#champion-icon');
const championName = document.querySelector('#champion-name');
const championTitle = document.querySelector('#champion-title');
const championWinRate = document.querySelector('#champion-win-rate');
const championPatch = document.querySelector('#champion-patch');
const augmentList = document.querySelector('#augment-list');
const itemList = document.querySelector('#item-list');
const buildNote = document.querySelector('#build-note');
const detailError = document.querySelector('#detail-error');
let champions = [];
let lastLcuChampionId = 0;
let selectedChampionId = 0;
let overviewRequestId = 0;

function renderChampionOptions() {
  const query = championSearch.value.trim().normalize('NFKC').toLowerCase();
  const matches = champions.filter((champion) =>
    [champion.name, champion.title, champion.alias].some((value) =>
      String(value ?? '').normalize('NFKC').toLowerCase().includes(query)));

  championSelect.replaceChildren();
  for (const champion of matches) {
    const option = document.createElement('option');
    option.value = String(champion.id);
    option.textContent = `${champion.name} · ${champion.title ?? champion.alias ?? ''}`;
    championSelect.append(option);
  }
  if (!matches.some((champion) => champion.id === selectedChampionId)) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = matches.length > 0 ? '请选择搜索结果' : '没有匹配的英雄';
    placeholder.disabled = true;
    championSelect.prepend(placeholder);
    championSelect.value = '';
  } else {
    championSelect.value = String(selectedChampionId);
  }
  championSelect.disabled = matches.length === 0;
  championSearchHint.textContent = query
    ? (matches.length ? `找到 ${matches.length} 位英雄，选择下拉结果或按回车确认` : '没有匹配的英雄，请换个关键词')
    : `共 ${champions.length} 位英雄`;
}

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
  const rarities = [
    { key: 'prismatic', rarity: 2, title: '棱彩胜率（彩色）' },
    { key: 'gold', rarity: 1, title: '黄金胜率（金色）' },
    { key: 'silver', rarity: 0, title: '白银胜率（白色）' },
  ];
  for (const { key, rarity, title } of rarities) {
    // 主进程已经按当前英雄胜率排序；过滤后保留各稀有度内部的排名。
    const matches = augments.filter(augment =>
      augment.rarityName ? augment.rarityName === key : augment.rarity === rarity);
    const group = document.createElement('section');
    group.className = `augment-group augment-group--${key}`;
    group.setAttribute('aria-labelledby', `augment-heading-${key}`);
    const header = document.createElement('div');
    header.className = 'augment-group-header';
    const heading = document.createElement('h4');
    heading.id = `augment-heading-${key}`;
    heading.textContent = title;
    const count = document.createElement('span');
    count.className = 'augment-count';
    count.textContent = `${matches.length} 个海克斯`;
    header.append(heading, count);
    const list = document.createElement('div');
    list.className = 'augment-list';
    list.tabIndex = 0;
    list.setAttribute('aria-label', `${title}排行榜`);
    if (matches.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'search-hint';
      empty.textContent = '当前英雄暂无该类海克斯数据';
      list.append(empty);
    }
    matches.forEach((augment, index) => {
      const card = document.createElement('div');
      card.className = 'augment';
      const rank = document.createElement('span');
      rank.className = 'augment-rank';
      rank.textContent = String(index + 1);
      rank.setAttribute('aria-label', `第 ${index + 1} 名`);
      const icon = document.createElement('img');
      setImage(icon, augment.iconUrl, augment.name);
      const main = document.createElement('div');
      main.className = 'augment-main';
      const name = document.createElement('div');
      name.className = 'augment-name';
      name.textContent = augment.name;
      const meta = document.createElement('div');
      meta.className = 'augment-meta';
      const games = Number.isInteger(augment.stats?.games)
        ? `${augment.stats.games.toLocaleString('zh-CN')} 场` : '样本量未知';
      meta.textContent = `${formatPercent(augment.stats?.winRate)} · ${games}`;
      main.append(name, meta);
      card.append(rank, icon, main);
      list.append(card);
    });
    group.append(header, list);
    augmentList.append(group);
  }
}

function renderItems(items, container) {
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'item';
    const icon = document.createElement('img');
    setImage(icon, item.iconUrl, item.name);
    const main = document.createElement('div');
    main.className = 'item-main';
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = item.name;
    main.append(name);
    card.append(icon, main);
    container.append(card);
  }
}

function renderBuildRoutes(routes) {
  itemList.replaceChildren();
  if (routes.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = '当前英雄暂无出装组合数据';
    buildNote.textContent = '当前数据没有可用的出装组合，请稍后手动同步数据。';
    itemList.append(empty);
    return;
  }
  const itemCount = routes[0].items.length;
  const coverage = itemCount === 6 ? '六件成装' : itemCount === 5 ? '五件阶段（暂无六件统计）'
    : `仅有最多 ${itemCount} 件的组合，暂无五六件统计`;
  buildNote.textContent = `${coverage}；同装备组合只展示一次，按样本量排序。胜率为对应装备样本的胜场 ÷ 场次，不能与英雄整体胜率直接比较；尚未按已选海克斯调整。`;
  routes.forEach((route, index) => {
    const section = document.createElement('section');
    section.className = 'build-route';
    const header = document.createElement('div');
    header.className = 'build-route-header';
    const title = document.createElement('h4');
    title.textContent = `方案 ${index + 1} · ${route.items.length} 件`;
    const stats = document.createElement('span');
    stats.className = 'build-route-stats';
    const games = Number.isInteger(route.games) ? `${route.games.toLocaleString('zh-CN')} 场` : '样本量未知';
    const pickRate = typeof route.pickRate === 'number' ? ` · 选取率 ${formatPercent(route.pickRate)}` : '';
    stats.textContent = `${route.items.length} 件样本胜率 ${formatPercent(route.winRate)} · ${games}${pickRate}`;
    header.append(title, stats);
    const items = document.createElement('div');
    items.className = 'item-list';
    renderItems(route.items, items);
    section.append(header, items);
    itemList.append(section);
  });
}

async function loadChampionOverview(championId) {
  const requestId = ++overviewRequestId;
  detailError.hidden = true;
  try {
    const overview = await window.aramAugmentAdvisor.data.getChampionOverview(championId);
    if (requestId !== overviewRequestId) return;
    championCard.hidden = false;
    setImage(championIcon, overview.champion?.iconUrl, overview.champion?.name ?? '英雄');
    championName.textContent = overview.champion?.name ?? '未知英雄';
    championTitle.textContent = overview.champion?.title ?? '—';
    championWinRate.textContent = formatPercent(overview.champion?.stats?.winRate);
    championPatch.textContent = overview.gamePatch;
    renderAugments(overview.augments ?? []);
    renderBuildRoutes(overview.build?.recommendedRoutes ?? []);
  } catch (error) {
    if (requestId !== overviewRequestId) return;
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
  if (!champions.some((champion) => champion.id === selectedChampionId)) {
    selectedChampionId = champions[0]?.id ?? 0;
  }
  championSearch.disabled = champions.length === 0;
  renderChampionOptions();
  if (selectedChampionId) await loadChampionOverview(selectedChampionId);
}

async function applyLcuSnapshot(snapshot) {
  document.querySelector('#lcu-connection-detail').textContent = snapshot.status === 'error'
    ? (snapshot.message ?? '连接失败，请检查客户端目录和运行权限。')
    : snapshot.status === 'disconnected' ? '请启动并登录英雄联盟客户端；若已启动，请配置客户端目录后重新检测。' : '';
  if (snapshot.status === 'connected' && ['ChampSelect', 'InProgress'].includes(snapshot.phase)) {
    lcuStatusElement.textContent = snapshot.phase === 'InProgress' ? '已连接，正在对局' : '已连接，正在选人';
    if (snapshot.championId > 0 && champions.some((champion) => champion.id === snapshot.championId)) {
      if (lastLcuChampionId !== snapshot.championId) {
        lastLcuChampionId = snapshot.championId;
        selectedChampionId = snapshot.championId;
        championSearch.value = '';
        renderChampionOptions();
        await loadChampionOverview(snapshot.championId);
      }
    } else {
      lastLcuChampionId = 0;
      if (!(snapshot.championId > 0)) lcuStatusElement.textContent += '，英雄待确认';
    }
    return;
  }

  lastLcuChampionId = 0;
  if (snapshot.status === 'connected') {
    lcuStatusElement.textContent = `已连接，当前阶段：${snapshot.phase}`;
  } else if (snapshot.status === 'error') {
    lcuStatusElement.textContent = '连接失败';
  } else {
    lcuStatusElement.textContent = '未检测到 League Client';
  }
}

// OCR 初始化独立于本地数据和客户端连接，开发阶段缺少接口也能打开原页面。
initializeLocalOcr();
initializeLcuSettings();

async function initializeLcuSettings() {
  const api = window.aramAugmentAdvisor?.lcu;
  const directory = document.querySelector('#lcu-directory');
  const browse = document.querySelector('#lcu-browse');
  const save = document.querySelector('#lcu-save');
  const retry = document.querySelector('#lcu-retry');
  const clear = document.querySelector('#lcu-clear');
  const feedback = document.querySelector('#lcu-feedback');
  const controls = [directory, browse, save, retry, clear];
  if (!api?.getSettings) return;
  const run = async operation => {
    controls.forEach(control => { control.disabled = true; });
    feedback.textContent = '';
    try { await operation(); }
    catch (error) { feedback.textContent = error instanceof Error ? error.message : String(error); }
    finally { controls.forEach(control => { control.disabled = false; }); }
  };
  const detect = async () => {
    feedback.textContent = '正在重新检测客户端…';
    await applyLcuSnapshot(await api.retry());
    feedback.textContent = '';
  };
  const persist = value => run(async () => {
    const settings = await api.saveDirectory(value);
    directory.value = settings.clientDirectory;
    await detect();
    feedback.textContent = settings.clientDirectory ? '客户端目录已保存，下次启动会自动使用。' : '已清除手动目录，继续自动检测。';
  });
  browse.addEventListener('click', () => run(async () => {
    const selected = await api.chooseDirectory();
    if (selected) { directory.value = selected; feedback.textContent = '已选择目录，请点击“保存并检测”。'; }
  }));
  save.addEventListener('click', () => persist(directory.value));
  retry.addEventListener('click', () => run(detect));
  clear.addEventListener('click', () => persist(''));
  directory.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void persist(directory.value); }
  });
  await run(async () => { directory.value = (await api.getSettings()).clientDirectory; });
}

window.aramAugmentAdvisor?.data?.onSyncProgress?.(({ completed, total }) => {
  statusElement.textContent = `正在同步数据 ${completed}/${total}`;
});

window.aramAugmentAdvisor?.lcu?.onSnapshot?.((snapshot) => {
  applyLcuSnapshot(snapshot).catch((error) => {
    lcuStatusElement.textContent = error instanceof Error ? error.message : String(error);
  });
});

championSearch.addEventListener('input', renderChampionOptions);
championSearch.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing || championSelect.disabled) return;
  const firstMatch = [...championSelect.options].find((option) => !option.disabled);
  if (firstMatch) {
    championSelect.value = firstMatch.value;
    championSelect.dispatchEvent(new Event('change'));
  }
});
championSelect.addEventListener('change', () => {
  selectedChampionId = Number(championSelect.value);
  if (selectedChampionId > 0) loadChampionOverview(selectedChampionId);
});

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
  if (!window.aramAugmentAdvisor?.data) throw new Error('本地数据接口暂不可用');
  await loadLocalData();
  if (window.aramAugmentAdvisor?.lcu?.getSnapshot) {
    await applyLcuSnapshot(await window.aramAugmentAdvisor.lcu.getSnapshot());
  } else {
    lcuStatusElement.textContent = '客户端接口暂不可用';
  }
} catch (error) {
  statusElement.textContent = '本地数据读取失败';
  statusElement.classList.add('error');
  dataSourceElement.textContent = error instanceof Error ? error.message : String(error);
}

function initializeLocalOcr() {
  const api = window.aramAugmentAdvisor?.overlay;
  const enabled = document.querySelector('#ocr-enabled');
  const display = document.querySelector('#ocr-display');
  const stateText = document.querySelector('#ocr-state');
  const calibrationText = document.querySelector('#ocr-calibration-state');
  const feedback = document.querySelector('#ocr-feedback');
  const scan = document.querySelector('#ocr-scan');
  const calibrate = document.querySelector('#ocr-calibrate');
  const reset = document.querySelector('#ocr-reset');
  const dialog = document.querySelector('#ocr-calibration');
  const editor = document.querySelector('#calibration-editor');
  const preview = document.querySelector('#calibration-preview');
  const image = document.querySelector('#calibration-image');
  const message = document.querySelector('#calibration-message');
  const validation = document.querySelector('#calibration-validation');
  const cancel = document.querySelector('#calibration-cancel');
  const retry = document.querySelector('#calibration-retry');
  const save = document.querySelector('#calibration-save');
  const slotButtons = [...document.querySelectorAll('[data-calibration-slot]')];
  const fields = Object.fromEntries(['x', 'y', 'width', 'height'].map(key =>
    [key, document.querySelector(`#calibration-${key}`)]));
  const titles = ['左侧标题', '中间标题', '右侧标题'];
  const statuses = { idle: '等待识别', scanning: '正在截屏', recognizing: '正在识别标题',
    visible: '浮层已更新', error: '识别失败', disabled: '已关闭' };
  const phases = { None: '未进入对局', Lobby: '大厅', Matchmaking: '匹配中', ReadyCheck: '等待接受对局',
    ChampSelect: '选择英雄', GameStart: '对局启动中', InProgress: '对局中', Reconnect: '等待重连',
    WaitingForStats: '等待结算', PreEndOfGame: '对局结束', EndOfGame: '结算' };
  let state = null;
  let displays = [];
  let stateRevision = 0;
  let busy = false;
  let captureBusy = false;
  let saving = false;
  let captureToken = 0;
  let screenshot = null;
  let captureDisplayId = '';
  let regions = [null, null, null];
  let activeSlot = 0;
  let drag = null;
  let calibrationFailure = '';
  let calibrationSession = false;
  let calibrationSaved = false;
  let releasePromise = null;
  let unsubscribe;

  const required = ['getState', 'setEnabled', 'getDisplays', 'setDisplayId', 'captureCalibration',
    'saveCalibration', 'cancelCalibration', 'resetCalibration', 'scanOnce', 'onState'];
  if (!api || required.some(name => typeof api[name] !== 'function')) {
    stateText.textContent = '本地识别接口暂不可用';
    display.replaceChildren(new Option('接口就绪后可选择显示器', ''));
    syncButton.disabled = !window.aramAugmentAdvisor?.data?.sync;
    return;
  }

  function renderControls() {
    const ready = Boolean(state);
    const scanning = ['scanning', 'recognizing'].includes(state?.status);
    const locked = busy || captureBusy || saving || Boolean(releasePromise) || dialog.open;
    enabled.checked = Boolean(state?.enabled);
    enabled.disabled = !ready || locked;
    display.disabled = !ready || locked || displays.length === 0;
    display.value = state?.displayId ?? 'primary';
    scan.disabled = !ready || locked || scanning || state?.calibrating || !state.enabled
      || state.phase !== 'InProgress' || !(state.championId > 0);
    const validDisplay = state?.displayId === 'primary' || displays.some(item => item.id === state?.displayId);
    calibrate.disabled = !ready || locked || scanning || !validDisplay;
    reset.disabled = !ready || locked || scanning || !state.calibrated;
    if (ready) {
      const phase = phases[state.phase] ?? '等待客户端阶段';
      stateText.textContent = `${statuses[state.status] ?? '等待识别'} · ${phase}${state.message ? ` · ${state.message}` : ''}`;
      stateText.classList.toggle('error', state.status === 'error');
      calibrationText.textContent = state.calibrated ? '已校准三个标题区域'
        : '使用默认 16:9 标题区域；如识别位置不符，可截图校准';
    }
    if (dialog.open) renderCalibration();
  }

  function acceptState(next) {
    if (!next || typeof next.enabled !== 'boolean') return;
    state = next;
    stateRevision += 1;
    renderControls();
  }

  async function refreshState() {
    const revision = stateRevision;
    const next = await api.getState();
    // 较慢的查询结果不能覆盖订阅推来的新状态。
    if (revision === stateRevision) acceptState(next);
  }

  async function perform(action, failureText) {
    if (busy || captureBusy || releasePromise || dialog.open) return;
    busy = true;
    feedback.textContent = '';
    renderControls();
    try {
      await action();
      await refreshState();
    } catch {
      feedback.textContent = failureText;
    } finally {
      busy = false;
      renderControls();
    }
  }

  async function cancelCalibrationSession(force = false) {
    if (releasePromise) await releasePromise;
    if (!force && !calibrationSession && !state?.calibrating) return;
    calibrationSession = false;
    releasePromise = (async () => {
      try {
        await api.cancelCalibration();
        await refreshState();
      } catch {
        feedback.textContent = '结束校准失败，请重试截图校准或重置校准。';
      }
    })();
    renderControls();
    try {
      await releasePromise;
    } finally {
      releasePromise = null;
      renderControls();
    }
  }

  function regionError() {
    if (!screenshot) return '请先截取游戏所在显示器。';
    if (state?.displayId !== captureDisplayId) return '显示器已改变，请重新截图后再校准。';
    const minWidth = Math.max(12 / screenshot.width, 0.005);
    const minHeight = Math.max(8 / screenshot.height, 0.005);
    for (let index = 0; index < 3; index += 1) {
      const region = regions[index];
      if (!region) return `请框选${titles[index]}（共需三个区域）。`;
      if (Object.values(region).some(value => !Number.isFinite(value)) || region.x < 0 || region.y < 0
        || region.width < minWidth || region.height < minHeight
        || region.x + region.width > 1 + 1e-9 || region.y + region.height > 1 + 1e-9) {
        return `${titles[index]}须位于截图内，且至少宽 ${Math.ceil(minWidth * screenshot.width)}、高 ${Math.ceil(minHeight * screenshot.height)} 像素。`;
      }
    }
    if (regions[0].x + regions[0].width > regions[1].x
      || regions[1].x + regions[1].width > regions[2].x) {
      return '三个标题必须从左到右排列，横向不能重叠。请选择对应标题重新调整。';
    }
    return '';
  }

  function renderRectangles() {
    preview.querySelectorAll('.calibration-rectangle').forEach(element => element.remove());
    regions.forEach((region, index) => {
      if (!region || Object.values(region).some(value => !Number.isFinite(value))) return;
      if (region.x < 0 || region.y < 0 || region.width < 0 || region.height < 0
        || region.x + region.width > 1 + 1e-9 || region.y + region.height > 1 + 1e-9) return;
      const rectangle = document.createElement('div');
      rectangle.className = 'calibration-rectangle';
      rectangle.dataset.active = String(index === activeSlot);
      rectangle.style.left = `${region.x * 100}%`;
      rectangle.style.top = `${region.y * 100}%`;
      rectangle.style.width = `${region.width * 100}%`;
      rectangle.style.height = `${region.height * 100}%`;
      const label = document.createElement('span');
      label.textContent = titles[index];
      rectangle.append(label);
      preview.append(rectangle);
    });
  }

  function updateFields() {
    for (const [key, input] of Object.entries(fields)) {
      input.value = regions[activeSlot] ? String(Number((regions[activeSlot][key] * 100).toFixed(3))) : '';
    }
  }

  function renderCalibration() {
    const locked = captureBusy || saving;
    const stale = screenshot && state?.displayId !== captureDisplayId;
    editor.hidden = !screenshot;
    retry.disabled = locked;
    cancel.disabled = saving;
    save.disabled = locked || Boolean(drag) || Boolean(regionError());
    save.textContent = saving ? '正在保存…' : '保存三个区域';
    retry.textContent = captureBusy ? '正在截图…' : '重新截图';
    slotButtons.forEach((button, index) => {
      button.disabled = locked || Boolean(stale);
      button.setAttribute('aria-pressed', String(index === activeSlot));
      button.textContent = `${titles[index]} · ${regions[index] ? '已框选' : '未框选'}`;
    });
    Object.values(fields).forEach(input => { input.disabled = locked || Boolean(stale); });
    document.querySelector('#calibration-field-label').textContent = `${titles[activeSlot]}的位置与大小（占截图百分比）`;
    if (screenshot) {
      message.textContent = stale ? '显示器已改变，请重新截图。'
        : `完整截图 ${screenshot.width} × ${screenshot.height} · 当前编辑${titles[activeSlot]}`;
      validation.textContent = calibrationFailure || regionError();
    }
    renderRectangles();
  }

  function selectSlot(index) {
    activeSlot = index;
    updateFields();
    renderCalibration();
  }

  function clearScreenshot() {
    drag = null;
    screenshot = null;
    regions = [null, null, null];
    image.removeAttribute('src');
    updateFields();
    editor.hidden = true;
  }

  async function capture() {
    if (captureBusy || saving) return;
    captureBusy = true;
    calibrationSession = true;
    calibrationSaved = false;
    const token = ++captureToken;
    const displayId = state?.displayId;
    clearScreenshot();
    activeSlot = 0;
    calibrationFailure = '';
    validation.textContent = '';
    message.textContent = '正在截取所选显示器，助手会短暂隐藏…';
    renderControls();
    try {
      const result = await api.captureCalibration();
      if (token !== captureToken || !dialog.open) {
        await cancelCalibrationSession(true);
        return;
      }
      if (!result || !/^data:image\/(png|jpeg|webp);base64,/.test(result.dataUrl)
        || !Number.isFinite(result.width) || !Number.isFinite(result.height)
        || result.width <= 0 || result.height <= 0) throw new Error('Invalid capture');
      image.src = result.dataUrl;
      await image.decode();
      if (token !== captureToken || !dialog.open) {
        await cancelCalibrationSession(true);
        return;
      }
      screenshot = { width: result.width, height: result.height };
      captureDisplayId = displayId;
      selectSlot(0);
    } catch {
      if (token === captureToken && dialog.open) {
        // 对话框仍打开时保持校准暂停，避免自动截屏捕获助手窗口。
        clearScreenshot();
        message.textContent = '截图或图片读取失败，自动识别仍暂停。请检查系统录屏权限与显示器连接，然后重新截图或取消校准。';
      } else {
        await cancelCalibrationSession(true);
      }
    } finally {
      captureBusy = false;
      renderControls();
    }
  }

  function pointerPosition(event) {
    const bounds = preview.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  }

  function updateDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const end = pointerPosition(event);
    calibrationFailure = '';
    regions[activeSlot] = { x: Math.min(drag.start.x, end.x), y: Math.min(drag.start.y, end.y),
      width: Math.abs(end.x - drag.start.x), height: Math.abs(end.y - drag.start.y) };
    updateFields();
    renderCalibration();
  }

  preview.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || !screenshot || captureBusy || saving || drag
      || state?.displayId !== captureDisplayId) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, start: pointerPosition(event), previous: regions[activeSlot] };
    preview.setPointerCapture(event.pointerId);
    updateDrag(event);
  });
  preview.addEventListener('pointermove', updateDrag);
  preview.addEventListener('pointerup', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateDrag(event);
    drag = null;
    preview.releasePointerCapture(event.pointerId);
    if (!regionError() || (regions[activeSlot]?.width >= Math.max(12 / screenshot.width, 0.005)
      && regions[activeSlot]?.height >= Math.max(8 / screenshot.height, 0.005))) {
      selectSlot(Math.min(2, activeSlot + 1));
    } else renderCalibration();
  });
  function cancelDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    regions[activeSlot] = drag.previous;
    drag = null;
    updateFields();
    renderCalibration();
  }
  preview.addEventListener('pointercancel', cancelDrag);
  preview.addEventListener('lostpointercapture', cancelDrag);
  slotButtons.forEach((button, index) => button.addEventListener('click', () => selectSlot(index)));
  Object.values(fields).forEach(input => input.addEventListener('input', () => {
    calibrationFailure = '';
    regions[activeSlot] = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.valueAsNumber / 100]));
    renderCalibration();
  }));

  enabled.addEventListener('change', () => {
    const next = enabled.checked;
    void perform(() => api.setEnabled(next), '无法切换浮层，请重试。');
  });
  display.addEventListener('change', () => {
    const next = display.value;
    void perform(() => api.setDisplayId(next), '无法切换显示器，请重试。');
  });
  scan.addEventListener('click', () => void perform(() => api.scanOnce(), '本次识别失败，请检查游戏画面后重试。'));
  reset.addEventListener('click', () => void perform(() => api.resetCalibration(), '重置校准失败，请重试。'));
  calibrate.addEventListener('click', () => {
    feedback.textContent = '';
    dialog.showModal();
    void capture();
  });
  retry.addEventListener('click', () => void capture());
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    captureToken += 1;
    clearScreenshot();
    if (!calibrationSaved) void cancelCalibrationSession();
    calibrationSaved = false;
    renderControls();
    calibrate.focus();
  });
  save.addEventListener('click', async () => {
    if (saving || captureBusy || drag || regionError()) return;
    saving = true;
    calibrationFailure = '';
    const savedDisplayId = captureDisplayId;
    const payload = regions.map(region => ({ ...region }));
    renderCalibration();
    try {
      await api.saveCalibration(payload);
      calibrationSession = false;
      calibrationSaved = true;
      await refreshState();
      if (state?.displayId !== savedDisplayId) {
        calibrationFailure = '显示器已改变，请重新截图后保存。';
      } else {
        dialog.close();
        feedback.textContent = '';
      }
    } catch {
      calibrationFailure = '保存失败，请重试或重新截图。';
    } finally {
      saving = false;
      renderControls();
    }
  });

  async function connect() {
    try {
      unsubscribe = api.onState(acceptState);
      await refreshState();
    } catch {
      stateText.textContent = '本地识别连接失败，请重新打开页面。';
    }
    try {
      const result = await api.getDisplays();
      displays = Array.isArray(result) ? result.map(item => ({ ...item, id: String(item.id) })) : [];
      display.replaceChildren(new Option('主显示器（默认）', 'primary'));
      for (const item of displays) {
        if (item.id === 'primary') continue;
        display.append(new Option(`${item.name} · ${item.width} × ${item.height}`, item.id));
      }
      if (!displays.length) feedback.textContent = '未找到可截取的显示器，请检查系统录屏权限。';
    } catch {
      display.replaceChildren(new Option('显示器读取失败', ''));
      feedback.textContent = '显示器读取失败，请检查权限后重新打开页面。';
    }
    renderControls();
  }
  window.addEventListener('beforeunload', () => {
    if (typeof unsubscribe === 'function') unsubscribe();
    if (calibrationSession || state?.calibrating) void api.cancelCalibration().catch(() => {});
  }, { once: true });
  void connect();
}
