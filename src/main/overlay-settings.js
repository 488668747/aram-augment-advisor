import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// 标准 16:9 界面的三个名称区域；不同 UI 布局可在主应用中重新框选。
export const DEFAULT_REGIONS = [0.245, 0.43, 0.615].map(x => ({ x, y: 0.398, width: 0.13, height: 0.025 }));

export function validateRegions(regions) {
  if (!Array.isArray(regions) || regions.length !== 3) throw new Error('请依次框选左、中、右三个名称区域');
  const normalized = regions.map(region => {
    const { x, y, width, height } = region ?? {};
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0
      || width < .005 || height < .005 || x + width > 1.000001 || y + height > 1.000001) {
      throw new Error('识别区域必须完整位于截图内，且有可用的宽度和高度');
    }
    return { x, y, width, height };
  });
  if (!(normalized[0].x < normalized[1].x && normalized[1].x < normalized[2].x)) {
    throw new Error('识别区域必须按左、中、右顺序框选');
  }
  return normalized;
}

export async function loadOverlaySettings(filePath) {
  const defaults = { enabled: true, displayId: 'primary', regions: structuredClone(DEFAULT_REGIONS), calibrated: false };
  try {
    const saved = JSON.parse(await readFile(filePath, 'utf8'));
    return { enabled: typeof saved.enabled === 'boolean' ? saved.enabled : true,
      displayId: typeof saved.displayId === 'string' ? saved.displayId : 'primary',
      regions: saved.calibrated === true ? validateRegions(saved.regions) : structuredClone(DEFAULT_REGIONS),
      calibrated: saved.calibrated === true };
  } catch { return defaults; }
}

export async function saveOverlaySettings(filePath, settings) {
  const safe = { enabled: settings.enabled === true, displayId: String(settings.displayId),
    regions: validateRegions(settings.regions), calibrated: settings.calibrated === true };
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(safe, null, 2), { mode: 0o600 });
  await rename(temporary, filePath);
}
