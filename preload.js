const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('desktop-capturer:get-sources'),
  getBackendBaseUrl: () => ipcRenderer.invoke('backend:get-base-url'),
  selectOutputDir: () => ipcRenderer.invoke('dialog:selectDir'),
  logRenderer: (level, message) => ipcRenderer.send('log:renderer', level, message),
  getDiskUsage: () => ipcRenderer.invoke('app:getDiskUsage'),
  readLogFile: (filename) => ipcRenderer.invoke('app:readLogFile', filename),
  openLogsDir: () => ipcRenderer.invoke('app:openLogsDir'),
  openDir: (dirPath) => ipcRenderer.invoke('app:openDir', dirPath),
  clearUserData: () => ipcRenderer.invoke('app:clearUserData'),
  clearAndOpenSetup: () => ipcRenderer.invoke('app:clearAndOpenSetup'),
});
