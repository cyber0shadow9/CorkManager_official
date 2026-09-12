const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webpick', {
  grab: (url) => ipcRenderer.send('web:grab', url),
  close: () => ipcRenderer.send('web:close'),
});
