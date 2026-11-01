// Preload for the shell window: the only bridge the local pages need.
//
// The main window runs sandboxed without node integration, so the startup-failure page cannot call the main process
// itself. This exposes just two actions: restart the backend, and open the log folder.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshShell', {
  restartBackend: () => ipcRenderer.send('backend:restart'),
  openLogs: () => ipcRenderer.send('backend:logs'),
})
