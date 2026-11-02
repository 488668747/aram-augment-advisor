import { desktopCapturer, nativeImage, screen, systemPreferences } from 'electron';
import { validateRegions } from './overlay-settings.js';

export function getCaptureDisplays() {
  return screen.getAllDisplays().map((display, index) => ({ id: String(display.id),
    name: display.label || `显示器 ${index + 1}`, width: display.size.width, height: display.size.height }));
}

export function resolveDisplay(displayId) {
  const display = displayId === 'primary' ? screen.getPrimaryDisplay()
    : screen.getAllDisplays().find(item => String(item.id) === displayId);
  if (!display) throw new Error('所选显示器不可用，请重新选择');
  return display;
}

export async function captureDisplay(displayId) {
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied') {
    throw new Error('请在系统设置中允许屏幕录制，随后重启助手');
  }
  const display = resolveDisplay(displayId);
  const width = Math.min(2560, Math.round(display.size.width * display.scaleFactor));
  let timer;
  try {
    const sources = await Promise.race([
      desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false,
        thumbnailSize: { width, height: Math.round(width * display.size.height / display.size.width) } }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('屏幕截图超时')), 5000); }),
    ]);
    const source = sources.find(item => String(item.display_id) === String(display.id));
    if (!source || source.thumbnail.isEmpty()) throw new Error('无法截取所选屏幕，请检查屏幕录制权限');
    return source.thumbnail;
  } finally { clearTimeout(timer); }
}

export function cropTitleImages(image, regions) {
  const { width, height } = image.getSize();
  const crops = validateRegions(regions).map(region => {
    const left = Math.round(width * region.x), top = Math.round(height * region.y);
    const crop = image.crop({ x: left, y: top, width: Math.min(width - left, Math.max(1, Math.round(width * region.width))),
      height: Math.min(height - top, Math.max(1, Math.round(height * region.height))) });
    const resized = crop.resize({ height: 100, quality: 'best' });
    const size = resized.getSize();
    const pixels = resized.toBitmap({ scaleFactor: 1 });
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const bright = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 > 135;
      if (bright) ink++;
      const value = bright ? 0 : 255;
      pixels[i] = value; pixels[i + 1] = value; pixels[i + 2] = value; pixels[i + 3] = 255;
    }
    // 名称区域边缘的卡片竖框会被单行 OCR 当作字母；只去除边缘贯穿整行的竖线。
    for (let x = 0; x < size.width; x++) {
      if (x > size.width * .05 && x < size.width * .95) continue;
      let black = 0;
      for (let y = 0; y < size.height; y++) if (pixels[(y * size.width + x) * 4] === 0) black++;
      if (black < size.height * .9) continue;
      for (let y = 0; y < size.height; y++) {
        const i = (y * size.width + x) * 4;
        pixels[i] = 255; pixels[i + 1] = 255; pixels[i + 2] = 255;
      }
    }
    for (const right of [false, true]) {
      const edge = Math.ceil(size.width * .05);
      const column = x => right ? size.width - 1 - x : x;
      let gapIsBlank = true;
      for (let x = edge; x < edge * 2 && gapIsBlank; x++) {
        for (let y = 0; y < size.height; y++) {
          if (pixels[(y * size.width + column(x)) * 4] === 0) { gapIsBlank = false; break; }
        }
      }
      if (!gapIsBlank) continue;
      for (let x = 0; x < edge; x++) for (let y = 0; y < size.height; y++) {
        const i = (y * size.width + column(x)) * 4;
        pixels[i] = 255; pixels[i + 1] = 255; pixels[i + 2] = 255;
      }
    }
    return { png: nativeImage.createFromBitmap(pixels, { ...size, scaleFactor: 1 }).toPNG(), ratio: ink / (pixels.length / 4) };
  });
  // 空白或大块高亮画面不启动昂贵的文字识别；此门槛仅减少明显无关帧。
  if (crops.filter(crop => crop.ratio >= .005 && crop.ratio <= .4).length < 2) return [];
  return crops.map(crop => crop.png);
}
