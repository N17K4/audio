const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overviewAPI', {
  getDiskUsage: () => ipcRenderer.invoke('app:getDiskUsage'),
  deleteModels: (engine) => ipcRenderer.invoke('app:deleteModels', engine),
  openLogsDir: () => ipcRenderer.invoke('app:openLogsDir'),
});
