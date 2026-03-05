import { app, BrowserWindow, ipcMain, clipboard, dialog } from 'electron';
import {
    readFileSync,
    writeFileSync,
    existsSync,
    mkdirSync,
    openSync,
    writeSync,
    fsyncSync,
    closeSync,
    renameSync,
    unlinkSync,
} from 'fs';
import { join, dirname, basename } from 'path';

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

function get_ascii_drawings_dir() {
    const dir = join(process.cwd(), 'ascii_drawings');
    try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    } catch {
        // ignore
    }
    return dir;
}

function write_file_atomic(targetPath, content) {
    const dir = dirname(targetPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const base = basename(targetPath);
    const tmpPath = join(dir, `.${base}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const bakPath = join(dir, `.${base}.bak`);

    const fd = openSync(tmpPath, 'w');
    try {
        writeSync(fd, content, 0, 'utf-8');
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }

    // Swap in atomically as best-effort on Windows (rename won't overwrite).
    try {
        if (existsSync(bakPath)) {
            try { unlinkSync(bakPath); } catch { /* ignore */ }
        }

        if (existsSync(targetPath)) {
            renameSync(targetPath, bakPath);
        }
        renameSync(tmpPath, targetPath);
        if (existsSync(bakPath)) {
            try { unlinkSync(bakPath); } catch { /* ignore */ }
        }
    } catch (e) {
        // Attempt to restore from backup if the swap failed
        try {
            if (existsSync(bakPath) && !existsSync(targetPath)) {
                renameSync(bakPath, targetPath);
            }
        } catch {
            // ignore
        }

        try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
        throw e;
    }
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

ipcMain.handle('write-file-atomic', async (event, filePath, content) => {
    try {
        write_file_atomic(filePath, content);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-ascii-drawings-dir', async () => {
    return get_ascii_drawings_dir();
});

ipcMain.handle('show-open-dialog', async (event, options) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(win, options);
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-data-slot-dir', async (event, slot) => {
    return join(process.cwd(), 'local_data', `data_slot_${slot}`);
});

// Clipboard IPC handlers
ipcMain.handle('clipboard-read-text', async () => {
    try {
        const text = clipboard.readText();
        return { success: true, text };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clipboard-write-text', async (event, text) => {
    try {
        clipboard.writeText(text);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clipboard-read-image', async () => {
    try {
        const image = clipboard.readImage();
        if (image.isEmpty()) {
            return { success: false, error: 'No image in clipboard' };
        }
        // Convert to data URL for transfer to renderer
        const dataUrl = image.toDataURL();
        return { success: true, dataUrl, width: image.getSize().width, height: image.getSize().height };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clipboard-has-image', async () => {
    try {
        const hasImage = clipboard.hasImage && clipboard.hasImage();
        return { success: true, hasImage };
    } catch (error) {
        return { success: false, error: error.message };
    }
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
