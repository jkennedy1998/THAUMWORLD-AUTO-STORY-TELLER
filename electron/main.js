import { app, BrowserWindow, ipcMain } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Determine which mode we're in
const IS_PAINTER_MODE = process.env.THAUM_APP_MODE === 'ascii_painter';

// Use different ports for game vs painter so they can run simultaneously
const DEV_URL = IS_PAINTER_MODE 
    ? 'http://localhost:5174'  // Painter port
    : 'http://localhost:5173'; // Game port

function create_window() {
    console.log('[Electron] Creating window...');
    console.log(`[Electron] Mode: ${IS_PAINTER_MODE ? 'ASCII Painter' : 'Game'}`);
    console.log(`[Electron] Loading URL: ${DEV_URL}`);
    
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: join(process.cwd(), 'electron', 'preload.js'),
        },
    });

    // Mode is set via preload script before page loads
    // Preload reads process.env.THAUM_APP_MODE and exposes it as window.electronAPI.appMode

    // Add error handlers
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[Electron] Failed to load:', errorCode, errorDescription);
    });

    win.webContents.on('crashed', (event, killed) => {
        console.error('[Electron] Renderer crashed:', killed);
    });

    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
        const levelName = ['debug', 'log', 'warn', 'error'][level] || 'log';
        console.log(`[Renderer ${levelName}] ${message}`);
    });

    win.loadURL(DEV_URL).catch(err => {
        console.error('[Electron] Failed to load URL:', err);
    });
    
    console.log('[Electron] Window created successfully');
}

// IPC handlers for renderer communication
ipcMain.handle('read-file', async (event, filePath) => {
    try {
        const content = readFileSync(filePath, 'utf-8');
        return { success: true, content };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('write-file', async (event, filePath, content) => {
    try {
        writeFileSync(filePath, content, 'utf-8');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-data-slot-dir', async (event, slot) => {
    return join(process.cwd(), 'local_data', `data_slot_${slot}`);
});

app.whenReady().then(() => {
    create_window();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) create_window();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
