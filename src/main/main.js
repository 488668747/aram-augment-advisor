import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';

import { readActiveDataSet } from './data-store.js';
import { readChampionList, readChampionOverview } from './data-query.js';
import { syncGlobalData } from './data-sync.js';
import { LcuService } from './lcu-service.js';
import { discoverLockfilePaths } from './lcu-discovery.js';
import { loadLcuSettings, saveLcuSettings, validateClientDirectory } from './lcu-settings.js';
import { createOverlayManager } from './overlay-manager.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
let lcuSettings = { clientDirectory: '' };
let cachedLockfiles;
let cacheExpiresAt = 0;
const lcuService = new LcuService({ findLockfile: async () => {
  if (cachedLockfiles?.length && Date.now() < cacheExpiresAt && cachedLockfiles.every(filename => existsSync(filename))) return cachedLockfiles;
  cachedLockfiles = await discoverLockfilePaths({ configuredPath: lcuSettings.clientDirectory });
  cacheExpiresAt = Date.now() + 15000;
  return cachedLockfiles;
}, onConnectionChange: () => invalidateLcuSession() });
let lcuPollTimer;
let lcuPollInFlight = false;
let mainWindow;
let overlayManager;

function getBundledDataRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'data');
  return path.resolve(currentDirectory, '../../data');
}

function getUserDataRoot() {
  return path.join(app.getPath('userData'), 'data', 'runtime');
}

function getDataRoot() {
  const bundledRoot = getBundledDataRoot();
  const bundledRuntimeRoot = path.join(bundledRoot, 'runtime');
  const userRoot = getUserDataRoot();
  if (existsSync(path.join(userRoot, 'current.json'))) return userRoot;
  if (existsSync(path.join(bundledRuntimeRoot, 'current.json'))) return bundledRuntimeRoot;
  return bundledRoot;
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#10131c',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(currentDirectory, '../preload/preload.cjs'),
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('closed', () => { mainWindow = null; app.quit(); });
  return window;
}

ipcMain.handle('data:get-active', async () => {
  const active = await readActiveDataSet(getDataRoot());
  return {
    dataVersion: active.manifest.dataVersion,
    gamePatch: active.manifest.gamePatch,
    locale: active.manifest.locale,
    generatedAt: active.manifest.generatedAt,
    source: active.manifest.source ?? null,
  };
});

ipcMain.handle('data:get-champions', async () => readChampionList(getDataRoot()));

ipcMain.handle('data:get-champion-overview', async (_event, championId) => {
  if (!Number.isInteger(championId) || championId <= 0) {
    throw new Error('英雄 ID 无效');
  }

  return readChampionOverview(getDataRoot(), championId);
});

ipcMain.handle('data:sync', async (event) => {
  const result = await syncGlobalData({
    apiOrigin: 'https://data.dtodo.cn',
    dataRoot: getUserDataRoot(),
    onProgress: (progress) => {
      event.sender.send('data:sync-progress', progress);
    },
  });

  overlayManager?.invalidateData();

  return {
    dataVersion: result.dataVersion,
    fileCount: result.fileCount,
  };
});

ipcMain.handle('lcu:get-snapshot', () => lcuService.getSnapshot());

function handleLcuSetting(channel, operation) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('客户端配置仅允许应用主窗口修改');
    }
    return operation(...args);
  });
}

handleLcuSetting('lcu:get-settings', () => lcuSettings);
handleLcuSetting('lcu:choose-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择英雄联盟安装目录或 LeagueClient 目录',
    defaultPath: lcuSettings.clientDirectory || undefined,
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});
handleLcuSetting('lcu:save-directory', async value => {
  const directory = validateClientDirectory(value);
  lcuSettings = await saveLcuSettings(path.join(app.getPath('userData'), 'lcu-settings.json'), directory);
  // 等待旧查询结束，保证重新检测不会复用修改前的查询或英雄。
  await lcuService.pendingSnapshot;
  cachedLockfiles = null;
  lcuService.currentChampionId = 0;
  lcuService.connectionKey = null;
  invalidateLcuSession();
  return lcuSettings;
});
handleLcuSetting('lcu:retry', async () => {
  await lcuService.pendingSnapshot;
  cachedLockfiles = null;
  return pollLcu();
});

function invalidateLcuSession() {
  const snapshot = { status: 'disconnected', phase: 'Unavailable', championId: 0 };
  overlayManager?.updateSession(snapshot);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lcu:snapshot', snapshot);
}

async function pollLcu() {
  if (lcuPollInFlight) return lcuService.getSnapshot();
  lcuPollInFlight = true;
  try {
    const snapshot = await lcuService.getSnapshot();
    overlayManager?.updateSession(snapshot);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('lcu:snapshot', snapshot);
    }
    return snapshot;
  } finally {
    lcuPollInFlight = false;
  }
}

app.whenReady().then(async () => {
  lcuSettings = await loadLcuSettings(path.join(app.getPath('userData'), 'lcu-settings.json'));
  createMainWindow();
  overlayManager = await createOverlayManager({ getMainWindow: () => mainWindow, getDataRoot });
  await mainWindow.loadFile(path.resolve(currentDirectory, '../renderer/index.html'));
  pollLcu();
  lcuPollTimer = setInterval(pollLcu, 1500);

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
  });
});

app.on('before-quit', () => {
  clearInterval(lcuPollTimer);
  void overlayManager?.dispose();
});

app.on('window-all-closed', () => {
  clearInterval(lcuPollTimer);
  if (process.platform !== 'darwin') app.quit();
});
