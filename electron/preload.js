const { contextBridge, ipcRenderer } = require('electron');

const _progressWrappers = new Map();

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('desktop-capturer:get-sources'),
  getBackendBaseUrl: () => ipcRenderer.invoke('backend:get-base-url'),
  selectOutputDir: () => ipcRenderer.invoke('dialog:selectDir'),
  logRenderer: (level, message) => ipcRenderer.send('log:renderer', level, message),
  getDiskUsage: () => ipcRenderer.invoke('app:getDiskUsage'),
  readLogFile: (filename) => ipcRenderer.invoke('app:readLogFile', filename),
  openLogsDir: () => ipcRenderer.invoke('app:openLogsDir'),
  openDir: (dirPath) => ipcRenderer.invoke('app:openDir', dirPath),
  saveRecording: (filename, buffer) => ipcRenderer.invoke('app:saveRecording', filename, buffer),
  clearUserData: () => ipcRenderer.invoke('app:clearUserData'),
  clearAndOpenSetup: () => ipcRenderer.invoke('app:clearAndOpenSetup'),
  downloadEngine: (engine) => ipcRenderer.invoke('app:downloadEngine', engine),
  deleteEngine: (engine) => ipcRenderer.invoke('app:deleteModels', engine),
  onEngineDownloadProgress: (cb) => {
    const wrapper = (_e, d) => cb(d);
    _progressWrappers.set(cb, wrapper);
    ipcRenderer.on('engine:download:progress', wrapper);
  },
  offEngineDownloadProgress: (cb) => {
    const wrapper = _progressWrappers.get(cb);
    if (wrapper) {
      ipcRenderer.removeListener('engine:download:progress', wrapper);
      _progressWrappers.delete(cb);
    }
  },
  clearDiskRow: (key) => ipcRenderer.invoke('app:clearDiskRow', key),
  reinstallStage: (stage) => ipcRenderer.invoke('app:reinstallStage', stage),
  clearStage: (stage) => ipcRenderer.invoke('app:clearStage', stage),
  clearStageAndOpenSetup: (stage) => ipcRenderer.invoke('app:clearStageAndOpenSetup', stage),
  supplementInstall: (stage) => ipcRenderer.invoke('app:supplementInstall', stage),
});
