import { app, BrowserWindow, protocol, net } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initDb, imageQueries } from './db';
import { registerIpc } from './ipc';
import { thumbPathFor, generateFullPreview } from './thumbnail';

let mainWindow: BrowserWindow | null = null;

protocol.registerSchemesAsPrivileged([
  { scheme: 'thumb', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } },
  { scheme: 'photo', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } }
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#111',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  initDb();

  // thumb://<imageId>  -> serves cached thumbnail jpg
  protocol.handle('thumb', async (req) => {
    const id = parseInt(req.url.replace(/^thumb:\/\//, '').replace(/\/$/, ''), 10);
    if (!Number.isFinite(id)) return new Response('bad id', { status: 400 });
    const row = imageQueries.getById(id);
    if (!row) return new Response('not found', { status: 404 });
    if (row.thumb_status !== 'ready') return new Response('not ready', { status: 425 });
    const url = pathToFileURL(thumbPathFor(row.path)).toString();
    return net.fetch(url);
  });

  // photo://<imageId>  -> serves full-resolution image (or NEF embedded preview) bytes
  protocol.handle('photo', async (req) => {
    const id = parseInt(req.url.replace(/^photo:\/\//, '').replace(/\/$/, ''), 10);
    if (!Number.isFinite(id)) return new Response('bad id', { status: 400 });
    const row = imageQueries.getById(id);
    if (!row) return new Response('not found', { status: 404 });
    try {
      if (row.ext === '.nef') {
        const buf = await generateFullPreview(row.path, row.ext);
        return new Response(buf, { headers: { 'content-type': 'image/jpeg' } });
      }
      const url = pathToFileURL(row.path).toString();
      return net.fetch(url);
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  });

  registerIpc(() => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
