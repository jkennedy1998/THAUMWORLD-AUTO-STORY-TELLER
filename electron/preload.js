// Preload script for Electron
// Exposes safe IPC channels to the renderer process

const { contextBridge, ipcRenderer } = require('electron');

// Determine which mode we're in based on environment variable
const appMode = process.env.THAUM_APP_MODE || 'game';
const startupBootMode = process.env.THAUM_STARTUP_BOOT_MODE || 'manual_shell';
const dataSlot = Number(process.env.DATA_SLOT || 1) || 1;
const toolAssistedInputsBootConfig = {
  enabled: process.env.THAUM_TAI_ENABLED === 'true',
  taiId: process.env.THAUM_TAI_ID || '',
  testName: process.env.THAUM_TAI_TEST_NAME || '',
  openMs: Number(process.env.THAUM_TAI_OPEN_MS || 0) || 0,
  endDelayMs: Number(process.env.THAUM_TAI_END_DELAY_MS || 0) || 0,
  scriptPath: process.env.THAUM_TAI_SCRIPT_PATH || '',
};

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
const inputHostKind = appMode === 'game' ? 'electron_bridge' : 'dom_window';

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
  dataSlot,
  startupBootMode,
  toolAssistedInputsBootConfig,

  // Current gameplay input host implementation. Renderer code uses this as a seam
  // so Electron-specific input sourcing can be swapped without touching game logic.
  inputHostKind,

  gameplayInputPublishContext: (ctx) => ipcRenderer.send('gameplay-input-context', ctx),
  gameplayInputSendEvent: (message) => ipcRenderer.send('gameplay-input-event', message),
  toolAssistedInputsSendKeyboardEvent: (message) => ipcRenderer.send('tool-assisted-inputs-keyboard-event', message),
  toolAssistedInputsResetKeyboard: () => ipcRenderer.send('tool-assisted-inputs-keyboard-reset'),
  gameplayInputRequestSnapshot: (playerId) => ipcRenderer.send('gameplay-input-request-snapshot', { player_id: playerId }),
  gameplayInputReset: (playerId) => ipcRenderer.send('gameplay-input-reset', { player_id: playerId }),
  gameplayInputSubscribe: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = (_event, message) => listener(message);
    ipcRenderer.on('gameplay-input-message', wrapped);
    return () => {
      ipcRenderer.removeListener('gameplay-input-message', wrapped);
    };
  },

  // Clipboard operations
  clipboardReadText: () => ipcRenderer.invoke('clipboard-read-text'),
  clipboardWriteText: (text) => ipcRenderer.invoke('clipboard-write-text', text),
  clipboardReadImage: () => ipcRenderer.invoke('clipboard-read-image'),
  clipboardHasImage: () => ipcRenderer.invoke('clipboard-has-image'),
});
