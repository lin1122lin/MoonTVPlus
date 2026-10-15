const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopSettings', {
  read: () => ipcRenderer.invoke('settings:read'),
  save: (value) => ipcRenderer.invoke('settings:save', value),
});
