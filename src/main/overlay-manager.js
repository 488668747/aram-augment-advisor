import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOcrEngine } from './ocr-engine.js';
import { OverlayController } from './overlay-controller.js';
import { captureDisplay, cropTitleImages, getCaptureDisplays, resolveDisplay } from './overlay-capture.js';
import { DEFAULT_REGIONS, loadOverlaySettings, saveOverlaySettings, validateRegions } from './overlay-settings.js';
import { readActiveDataFile, readActiveDataSet } from './data-store.js';

const directory = path.dirname(fileURLToPath(import.meta.url));

export async function createOverlayManager({ getMainWindow, getDataRoot, capture = captureDisplay }) {
  const settingsPath = path.join(app.getPath('userData'), 'overlay-settings.json');
  let settings = await loadOverlaySettings(settingsPath);
  let settingsWrite = Promise.resolve();
  let disposed = false;
  let dataCache;
  const assetRoot = app.isPackaged ? path.join(process.resourcesPath, 'ocr')
    : path.resolve(directory, '../../resources/ocr');
  let engine = createOcrEngine({ assetRoot });
  const stoppingEngines = new Set();
  const restartEngine = () => {
    const old = engine;
    engine = createOcrEngine({ assetRoot });
    const stopping = old.terminate().catch(() => {});
    stoppingEngines.add(stopping);
    void stopping.finally(() => stoppingEngines.delete(stopping));
  };
  const overlayWindow = new BrowserWindow({ width: 760, height: 160, show: false,
    frame: false, transparent: true, resizable: false, focusable: false, skipTaskbar: true,
    alwaysOnTop: true, fullscreenable: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      preload: path.join(directory, '../preload/preload.cjs') } });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, process.platform === 'win32' ? 'screen-saver' : 'floating');
  overlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlayWindow.webContents.on('will-navigate', event => event.preventDefault());

  const broadcast = state => {
    for (const window of [getMainWindow(), overlayWindow]) {
      if (window && !window.isDestroyed()) window.webContents.send('overlay:state', state);
    }
  };
  const controller = new OverlayController({
    settings: { enabled: settings.enabled, displayId: settings.displayId, calibrated: settings.calibrated },
    capture: async () => cropTitleImages(await capture(settings.displayId), settings.regions),
    recognizeSlots: images => engine.recognizeSlots(images),
    onInvalidate: restartEngine,
    loadData: async championId => {
      const root = getDataRoot();
      const active = await readActiveDataSet(root);
      const key = `${root}:${active.manifest.dataVersion}:${active.manifest.generatedAt}:${championId}`;
      if (dataCache?.key === key) return dataCache.value;
      const [catalog, detail] = await Promise.all([
        readActiveDataFile(root, 'augments.json'), readActiveDataFile(root, `champions/${championId}.json`),
      ]);
      const value = { catalog: catalog.data ?? [], augments: detail.augments ?? [], championName: detail.champion?.name ?? '' };
      dataCache = { key, value };
      return value;
    },
    onState: broadcast,
    show: () => {
      if (disposed || overlayWindow.isDestroyed()) return;
      const area = resolveDisplay(settings.displayId).workArea;
      const width = Math.min(760, area.width);
      overlayWindow.setBounds({ x: area.x + Math.round((area.width - width) / 2),
        y: area.y + Math.max(12, Math.round(area.height * .02)), width, height: 160 });
      overlayWindow.showInactive();
    },
    hide: () => { if (!overlayWindow.isDestroyed()) overlayWindow.hide(); },
  });

  const persist = (value = settings) => {
    const snapshot = structuredClone(value);
    settingsWrite = settingsWrite.catch(() => {}).then(() => saveOverlaySettings(settingsPath, snapshot));
    return settingsWrite;
  };
  const handles = [];
  const handle = (channel, operation, readOnly = false) => {
    ipcMain.handle(channel, (event, ...args) => {
      const main = getMainWindow();
      const allowed = event.sender === main?.webContents || (readOnly && event.sender === overlayWindow.webContents);
      if (!allowed || event.senderFrame !== event.sender.mainFrame) throw new Error('此操作仅允许应用窗口调用');
      return operation(...args);
    });
    handles.push(channel);
  };
  handle('overlay:get-state', () => controller.getState(), true);
  handle('overlay:get-displays', getCaptureDisplays);
  handle('overlay:set-enabled', async enabled => {
    if (typeof enabled !== 'boolean') throw new Error('识别开关参数无效');
    settings.enabled = enabled;
    controller.setEnabled(enabled);
    await persist();
    return controller.getState();
  });
  handle('overlay:set-display', async displayId => {
    if (typeof displayId !== 'string') throw new Error('显示器参数无效');
    resolveDisplay(displayId);
    settings = { ...settings, displayId, regions: structuredClone(DEFAULT_REGIONS), calibrated: false };
    controller.invalidateSettings({ displayId, calibrated: false, calibrating: false });
    await persist();
    return controller.getState();
  });
  handle('overlay:capture-calibration', async () => {
    controller.invalidateSettings({ calibrating: true });
    const main = getMainWindow();
    const wasVisible = main?.isVisible();
    try {
      if (wasVisible) main.hide();
      await new Promise(resolve => setTimeout(resolve, 350));
      const image = await capture(settings.displayId);
      return { dataUrl: image.toDataURL(), ...image.getSize() };
    } finally {
      if (wasVisible && main && !main.isDestroyed()) main.show();
    }
  });
  handle('overlay:save-calibration', async regions => {
    const next = { ...settings, regions: validateRegions(regions), calibrated: true };
    controller.invalidateSettings({ calibrating: true });
    await persist(next);
    settings = next;
    controller.invalidateSettings({ calibrated: true, calibrating: false });
    return controller.getState();
  });
  handle('overlay:reset-calibration', async () => {
    settings = { ...settings, regions: structuredClone(DEFAULT_REGIONS), calibrated: false };
    controller.invalidateSettings({ calibrated: false, calibrating: false });
    await persist();
    return controller.getState();
  });
  handle('overlay:cancel-calibration', () => {
    controller.invalidateSettings({ calibrating: false });
    return controller.getState();
  });
  handle('overlay:scan-once', () => controller.scanOnce());
  await overlayWindow.loadFile(path.join(directory, '../renderer/overlay.html'));
  globalShortcut.register('F8', () => { void controller.scanOnce(); });

  return {
    updateSession: snapshot => controller.updateSession(snapshot),
    invalidateData: () => { dataCache = null; controller.invalidateSettings(); },
    async dispose() {
      if (disposed) return;
      disposed = true;
      controller.dispose();
      globalShortcut.unregister('F8');
      for (const channel of handles) ipcMain.removeHandler(channel);
      if (!overlayWindow.isDestroyed()) overlayWindow.destroy();
      await engine.terminate();
      await Promise.all([...stoppingEngines]);
    },
  };
}
