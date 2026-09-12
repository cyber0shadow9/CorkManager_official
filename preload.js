const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('corkboard', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  setPinned: (v) => ipcRenderer.invoke('window:pin', v),
  isPinned: () => ipcRenderer.invoke('window:isPinned'),
  pickFiles: () => ipcRenderer.invoke('files:pick', { multi: true }),
  pickImages: () => ipcRenderer.invoke('files:pickImages'),
  openFile: (p) => ipcRenderer.invoke('files:open', p),
  revealFile: (p) => ipcRenderer.invoke('files:reveal', p),
  deleteFile: (p) => ipcRenderer.invoke('files:delete', p),
  openWebBrowser: (mode) => ipcRenderer.invoke('web:open', mode),
  onWebImage: (cb) => ipcRenderer.on('web:image', (_e, payload) => cb(payload)),
  openSourceFolder: () => ipcRenderer.invoke('app:openSourceFolder'),
  openUserDataFolder: () => ipcRenderer.invoke('app:openUserDataFolder'),
  openAttachmentsFolder: () => ipcRenderer.invoke('app:openAttachmentsFolder'),
  paths: () => ipcRenderer.invoke('app:paths'),
});
