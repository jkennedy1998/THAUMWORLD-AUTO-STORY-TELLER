import { app, BrowserWindow } from 'electron';

const DEV_URL = 'http://localhost:5173';

function create_window() {
    console.log('[Electron] Creating window...');
    
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

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

    console.log('[Electron] Loading URL:', DEV_URL);
    win.loadURL(DEV_URL).catch(err => {
        console.error('[Electron] Failed to load URL:', err);
    });
    
    console.log('[Electron] Window created successfully');
}

app.whenReady().then(() => {
    create_window();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) create_window();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
