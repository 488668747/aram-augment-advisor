import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { app, BrowserWindow, ipcMain } from 'electron';

import { readActiveDataSet } from './data-store.js';
import { readChampionList, readChampionOverview } from './data-query.js';
import { syncGlobalData } from './data-sync.js';
import { LcuService } from './lcu-service.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const lcuService = new LcuService();
let lcuPollTimer;
let lcuPollInFlight = false;

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

  window.loadFile(path.resolve(currentDirectory, '../renderer/index.html'));
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

  return {
    dataVersion: result.dataVersion,
    fileCount: result.fileCount,
  };
});

ipcMain.handle('lcu:get-snapshot', () => lcuService.getSnapshot());

async function pollLcu() {
  if (lcuPollInFlight) return;
  lcuPollInFlight = true;
  try {
    const snapshot = await lcuService.getSnapshot();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('lcu:snapshot', snapshot);
    }
  } finally {
    lcuPollInFlight = false;
  }
}

app.whenReady().then(() => {
  createMainWindow();
  pollLcu();
  lcuPollTimer = setInterval(pollLcu, 1500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  clearInterval(lcuPollTimer);
  if (process.platform !== 'darwin') app.quit();
});
