function normalizedName(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

export function emptySlots() {
  return [0, 1, 2].map(slot => ({ slot, missing: true }));
}

export function matchAugmentSlots(readings, catalog, championAugments) {
  const statistics = new Map(championAugments.map(augment => [augment.id, augment.stats]));
  return emptySlots().map(empty => {
    const reading = readings[empty.slot];
    if (!reading || !Number.isFinite(reading.confidence) || reading.confidence < 0.45) return empty;
    const lines = new Set([reading.text, ...String(reading.text ?? '').split(/\r?\n/)].map(normalizedName).filter(Boolean));
    const matches = catalog.filter(augment => {
      const name = normalizedName(augment.name);
      if (lines.has(name)) return true;
      // 只对原本以叹号结尾的名称处理标点 OCR 噪声，不修改真实名称中的数字。
      return /[!！]+$/.test(augment.name) && [...lines].some(line => line.replace(/[1il]+$/g, '') === name);
    });
    if (matches.length !== 1) return empty;
    const augment = matches[0];
    const stats = statistics.get(augment.id);
    const rate = stats?.winRate;
    return {
      slot: empty.slot,
      missing: false,
      augmentId: augment.id,
      name: augment.name,
      rarity: augment.rarityName ?? ['silver', 'gold', 'prismatic'][augment.rarity] ?? 'unknown',
      winRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : null,
      games: Number.isInteger(stats?.games) && stats.games >= 0 ? stats.games : null,
    };
  });
}
