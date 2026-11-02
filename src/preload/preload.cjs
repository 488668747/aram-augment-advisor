const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aramAugmentAdvisor', {
  data: {
    getActive: () => ipcRenderer.invoke('data:get-active'),
    getChampions: () => ipcRenderer.invoke('data:get-champions'),
    getChampionOverview: (championId) => ipcRenderer.invoke('data:get-champion-overview', championId),
    sync: () => ipcRenderer.invoke('data:sync'),
    onSyncProgress: (listener) => ipcRenderer.on('data:sync-progress', (_event, progress) => listener(progress)),
  },
  lcu: {
    getSnapshot: () => ipcRenderer.invoke('lcu:get-snapshot'),
    onSnapshot: (listener) => ipcRenderer.on('lcu:snapshot', (_event, snapshot) => listener(snapshot)),
  },
  overlay: {
    getState: () => ipcRenderer.invoke('overlay:get-state'),
    setEnabled: (enabled) => ipcRenderer.invoke('overlay:set-enabled', enabled),
    getDisplays: () => ipcRenderer.invoke('overlay:get-displays'),
    setDisplayId: (displayId) => ipcRenderer.invoke('overlay:set-display', displayId),
    captureCalibration: () => ipcRenderer.invoke('overlay:capture-calibration'),
    saveCalibration: (regions) => ipcRenderer.invoke('overlay:save-calibration', regions),
    resetCalibration: () => ipcRenderer.invoke('overlay:reset-calibration'),
    cancelCalibration: () => ipcRenderer.invoke('overlay:cancel-calibration'),
    scanOnce: () => ipcRenderer.invoke('overlay:scan-once'),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('overlay:state', handler);
      return () => ipcRenderer.removeListener('overlay:state', handler);
    },
  },
});
