const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setupAPI', {
  // 接收主进程推送
  onInfo:     (cb) => ipcRenderer.on('setup:info',     (_e, data) => cb(data)),
  onProgress: (cb) => ipcRenderer.on('setup:progress', (_e, data) => cb(data)),
  onDone:     (cb) => ipcRenderer.on('setup:done',     (_e, data) => cb(data)),

  // 操作
  startDownload:       (opts) => ipcRenderer.invoke('setup:startDownload', opts),
  startDualDownload:   (opts) => ipcRenderer.invoke('setup:startDualDownload', opts),
  startAutoDownload:   (opts) => ipcRenderer.invoke('setup:startAutoDownload', opts),
  cancelDownload:      ()     => ipcRenderer.invoke('setup:cancelDownload'),
  closeWindow:         ()     => ipcRenderer.invoke('setup:closeWindow'),
  testHfConnectivity:  ()     => ipcRenderer.invoke('setup:testHfConnectivity'),
  saveConfig:          (cfg)  => ipcRenderer.invoke('setup:saveConfig', cfg),
  loadConfig:          ()     => ipcRenderer.invoke('setup:loadConfig'),
});
