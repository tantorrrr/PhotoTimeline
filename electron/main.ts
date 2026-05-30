import { app, BrowserWindow, protocol } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { initDb, imageQueries } from './db';
import { registerIpc } from './ipc';
import { thumbPathFor, generateFullPreview } from './thumbnail';
import { imageMime, videoMime, isVideoExt } from './media';

let mainWindow: BrowserWindow | null = null;

/** Zero-copy view so a Node Buffer satisfies the web Response BodyInit type. */
function bytes(buf: Buffer): BodyInit {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as unknown as BodyInit;
}

/** Parse a single HTTP Range header against a known file size. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] === '' ? NaN : parseInt(m[1], 10);
  let end = m[2] === '' ? NaN : parseInt(m[2], 10);
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    // suffix range: final N bytes
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (Number.isNaN(end) || end >= size) {
    end = size - 1;
  }
  if (start < 0 || start >= size || start > end) return null;
  return { start, end };
}

/** Stream a video file, honouring Range requests so the player can seek. */
async function serveVideo(filePath: string, ext: string, rangeHeader: string | null): Promise<Response> {
  let size: number;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    return new Response('not found', { status: 404 });
  }
  const mime = videoMime(ext);
  const range = parseRange(rangeHeader, size);
  const baseHeaders: Record<string, string> = { 'content-type': mime, 'accept-ranges': 'bytes' };
  if (!range) {
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
    return new Response(stream, { headers: { ...baseHeaders, 'content-length': String(size) } });
  }
  const { start, end } = range;
  const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    status: 206,
    headers: {
      ...baseHeaders,
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': String(end - start + 1)
    }
  });
}

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

  const parseId = (url: string, _scheme: string): number => {
    // Tolerate any of: scheme://123, scheme://123/, scheme://t/123, scheme://host/path/123
    const m = url.match(/(\d+)\/?(?:[?#].*)?$/);
    return m ? parseInt(m[1], 10) : NaN;
  };

  // thumb://t/<imageId>  -> serves cached thumbnail jpg
  protocol.handle('thumb', async (req) => {
    const id = parseId(req.url, 'thumb');
    console.log('[thumb] req', req.url, '-> id', id);
    if (!Number.isFinite(id)) return new Response('bad id', { status: 400 });
    const row = imageQueries.getById(id);
    if (!row) {
      console.warn('[thumb] not found', id);
      return new Response('not found', { status: 404 });
    }
    if (row.thumb_status !== 'ready') {
      console.warn('[thumb] not ready', id, row.thumb_status);
      return new Response('not ready', { status: 425 });
    }
    const thumbFile = thumbPathFor(row.path);
    try {
      const data = await fs.readFile(thumbFile);
      return new Response(bytes(data), {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' }
      });
    } catch (e) {
      console.error('[thumb] read failed', thumbFile, e);
      return new Response(String(e), { status: 500 });
    }
  });

  // photo://<imageId>  -> serves full-resolution image (NEF embedded preview)
  // or streams the original video with Range support.
  protocol.handle('photo', async (req) => {
    const id = parseId(req.url, 'photo');
    if (!Number.isFinite(id)) return new Response('bad id', { status: 400 });
    const row = imageQueries.getById(id);
    if (!row) return new Response('not found', { status: 404 });
    try {
      if (isVideoExt(row.ext)) {
        return await serveVideo(row.path, row.ext, req.headers.get('range'));
      }
      if (row.ext === '.nef') {
        const buf = await generateFullPreview(row.path, row.ext);
        return new Response(bytes(buf), { headers: { 'content-type': 'image/jpeg' } });
      }
      const data = await fs.readFile(row.path);
      return new Response(bytes(data), { headers: { 'content-type': imageMime(row.ext) } });
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
