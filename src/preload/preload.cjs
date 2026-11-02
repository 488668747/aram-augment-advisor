const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aramAugmentAdvisor', {
  data: {
    getActive: () => ipcRenderer.invoke('data:get-active'),
  },
});
