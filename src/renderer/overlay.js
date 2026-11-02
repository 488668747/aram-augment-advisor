const overlayApi = window.aramAugmentAdvisor?.overlay;
const slotCards = [...document.querySelectorAll('[data-slot]')];
const overlayStatus = document.querySelector('#overlay-status');
const overlayChampion = document.querySelector('#overlay-champion');
const rarityLabels = { prismatic: '棱彩', gold: '黄金', silver: '白银' };
const statusLabels = { idle: '等待识别', scanning: '正在截屏…', recognizing: '正在识别…',
  visible: '本地识别 · 当前英雄统计', error: '识别失败，请在助手中重试', disabled: '本地识别已关闭' };
let stateRevision = 0;
let unsubscribe;

function renderOverlay(state) {
  stateRevision += 1;
  const showResults = state?.enabled && (state.visible ?? state.status === 'visible');
  const slots = Array.isArray(state?.slots) ? state.slots : [];
  for (const [index, card] of slotCards.entries()) {
    // 按 slot 定位，绝不将中间或右侧结果补到未识别的左侧。
    const slot = showResults ? slots.find(item => item?.slot === index) : null;
    const known = slot && !slot.missing;
    const rarity = known && Object.hasOwn(rarityLabels, slot.rarity) ? slot.rarity : '';
    card.dataset.rarity = rarity;
    card.querySelector('.rarity').textContent = rarityLabels[rarity] ?? '稀有度未知';
    const name = known && typeof slot.name === 'string' && slot.name.trim() ? slot.name.trim() : '未识别';
    card.querySelector('h2').textContent = name;
    card.querySelector('h2').title = name;
    const hasWinRate = known && typeof slot.winRate === 'number' && Number.isFinite(slot.winRate)
      && slot.winRate >= 0 && slot.winRate <= 1;
    card.querySelector('.win-rate').textContent = hasWinRate ? `${(slot.winRate * 100).toFixed(1)}%` : '—';
    card.querySelector('.stat-label').textContent = hasWinRate ? '胜率' : '胜率未知';
    card.querySelector('.games').textContent = known && Number.isInteger(slot.games) && slot.games >= 0
      ? `${slot.games.toLocaleString('zh-CN')} 场` : '样本量未知';
  }
  // 页脚只使用固定状态文案，避免显示错误堆栈、截图内容或其他调试信息。
  overlayStatus.textContent = !state?.enabled ? '本地识别已关闭'
    : statusLabels[state.status] ?? '等待识别';
  const championName = typeof state?.championName === 'string' ? state.championName.trim() : '';
  overlayChampion.textContent = Number.isInteger(state?.championId) && state.championId > 0
    ? `当前英雄 ${championName || `#${state.championId}`}` : '当前英雄待确认';
  overlayChampion.title = overlayChampion.textContent;
}

async function connectOverlay() {
  if (!overlayApi || typeof overlayApi.getState !== 'function' || typeof overlayApi.onState !== 'function') {
    overlayStatus.textContent = '本地识别接口暂不可用';
    return;
  }
  try {
    unsubscribe = overlayApi.onState(renderOverlay);
    const revision = stateRevision;
    const initial = await overlayApi.getState();
    if (revision === stateRevision) renderOverlay(initial);
  } catch {
    if (stateRevision === 0) overlayStatus.textContent = '连接失败，请重新打开助手';
  }
}

window.addEventListener('beforeunload', () => {
  if (typeof unsubscribe === 'function') unsubscribe();
}, { once: true });

void connectOverlay();
