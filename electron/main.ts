import { app, BrowserWindow, protocol } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
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

  const parseId = (url: string, scheme: string): number => {
    const m = url.match(new RegExp(`^${scheme}://([^/?#]+)`));
    return m ? parseInt(m[1], 10) : NaN;
  };

  const mimeFromExt = (ext: string): string => {
    switch (ext) {
      case '.png': return 'image/png';
      case '.gif': return 'image/gif';
      case '.webp': return 'image/webp';
      default: return 'image/jpeg';
    }
  };

  // thumb://<imageId>  -> serves cached thumbnail jpg
  protocol.handle('thumb', async (req) => {
    const id = parseId(req.url, 'thumb');
    if (!Number.isFinite(id)) return new Response('bad id', { status: 400 });
    const row = imageQueries.getById(id);
    if (!row) return new Response('not found', { status: 404 });
    if (row.thumb_status !== 'ready') return new Response('not ready', { status: 425 });
    try {
      const data = await fs.readFile(thumbPathFor(row.path));
      return new Response(data, {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' }
      });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  });

  // photo://<imageId>  -> serves full-resolution image (or NEF embedded preview) bytes
  protocol.handle('photo', async (req) => {
    const id = parseId(req.url, 'photo');
    if (!Number.isFinite(id)) return new Response('bad id', { status: 400 });
    const row = imageQueries.getById(id);
    if (!row) return new Response('not found', { status: 404 });
    try {
      if (row.ext === '.nef') {
        const buf = await generateFullPreview(row.path, row.ext);
        return new Response(buf, { headers: { 'content-type': 'image/jpeg' } });
      }
      const data = await fs.readFile(row.path);
      return new Response(data, { headers: { 'content-type': mimeFromExt(row.ext) } });
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
