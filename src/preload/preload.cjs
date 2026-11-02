const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aramAugmentAdvisor', {
  data: {
    getActive: () => ipcRenderer.invoke('data:get-active'),
    getChampions: () => ipcRenderer.invoke('data:get-champions'),
    getChampionOverview: (championId) => ipcRenderer.invoke('data:get-champion-overview', championId),
    sync: () => ipcRenderer.invoke('data:sync'),
    onSyncProgress: (listener) => ipcRenderer.on('data:sync-progress', (_event, progress) => listener(progress)),
  },
});
