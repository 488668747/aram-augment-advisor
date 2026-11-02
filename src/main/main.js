import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { app, BrowserWindow, ipcMain } from 'electron';

import { readActiveDataSet } from './data-store.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

function getDataRoot() {
  const dataDirectory = path.resolve(currentDirectory, '../../data');
  const runtimeDirectory = path.join(dataDirectory, 'runtime');
  return existsSync(path.join(runtimeDirectory, 'current.json'))
    ? runtimeDirectory
    : dataDirectory;
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

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
