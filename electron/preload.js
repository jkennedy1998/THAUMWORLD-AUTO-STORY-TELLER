// Preload script for Electron
// Exposes safe IPC channels to the renderer process

const { contextBridge, ipcRenderer } = require('electron');

// Determine which mode we're in based on environment variable
const appMode = process.env.THAUM_APP_MODE || 'game';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Read file from main process (safer than giving renderer direct access)
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),

  // Write file via main process
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),

  // Atomic write (temp + rename)
  writeFileAtomic: (filePath, content) => ipcRenderer.invoke('write-file-atomic', filePath, content),

  // Get data slot directory
  getDataSlotDir: (slot) => ipcRenderer.invoke('get-data-slot-dir', slot),

  // Painter save directory
  getAsciiDrawingsDir: () => ipcRenderer.invoke('get-ascii-drawings-dir'),

  // File dialogs
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),

  // App mode (game or ascii_painter) - set before page loads
  appMode: appMode,

  // Clipboard operations
  clipboardReadText: () => ipcRenderer.invoke('clipboard-read-text'),
  clipboardWriteText: (text) => ipcRenderer.invoke('clipboard-write-text', text),
  clipboardReadImage: () => ipcRenderer.invoke('clipboard-read-image'),
  clipboardHasImage: () => ipcRenderer.invoke('clipboard-has-image'),
});
