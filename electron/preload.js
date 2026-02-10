// Preload script for Electron
// Exposes safe IPC channels to the renderer process

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Read file from main process (safer than giving renderer direct access)
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  
  // Write file via main process
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  
  // Get data slot directory
  getDataSlotDir: (slot) => ipcRenderer.invoke('get-data-slot-dir', slot),
});
