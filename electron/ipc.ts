import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import { folderQueries, imageQueries, AddFolderResult } from './db';
import { scanFolder, ScanProgress } from './scanner';

export type FolderListItem = {
  id: number;
  path: string;
  added_at: number;
  last_scan_at: number | null;
  image_count: number;
};

let activeScans = new Set<number>();

function addAndScan(
  rawPath: string,
  send: (channel: string, payload: unknown) => void
): AddFolderResult {
  const r = folderQueries.add(rawPath);
  // Only kick off a scan when there's actual new work to do
  if (r.status === 'added' || r.status === 'subsumed') {
    triggerScan(r.id, r.path, send);
  }
  return r;
}

export function registerIpc(getWindow: () => BrowserWindow | null) {
  const send = (channel: string, payload: unknown) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  ipcMain.handle('folders:list', (): FolderListItem[] => {
    return folderQueries.list().map((f) => ({
      ...f,
      image_count: folderQueries.countImages(f.id)
    }));
  });

  ipcMain.handle('folders:pickAndAdd', async (): Promise<AddFolderResult[]> => {
    const w = getWindow();
    if (!w) return [];
    const r = await dialog.showOpenDialog(w, {
      properties: ['openDirectory', 'multiSelections']
    });
    if (r.canceled || r.filePaths.length === 0) return [];
    return r.filePaths.map((p) => addAndScan(p, send));
  });

  ipcMain.handle('folders:remove', (_e, id: number) => {
    folderQueries.remove(id);
    return true;
  });

  ipcMain.handle('folders:rescan', (_e, id: number) => {
    const all = folderQueries.list();
    const f = all.find((x) => x.id === id);
    if (!f) return false;
    triggerScan(f.id, f.path, send);
    return true;
  });

  ipcMain.handle('folders:addPaths', async (_e, paths: string[]): Promise<AddFolderResult[]> => {
    const fs = await import('node:fs/promises');
    const out: AddFolderResult[] = [];
    for (const p of paths) {
      try {
        const stat = await fs.stat(p);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }
      out.push(addAndScan(p, send));
    }
    return out;
  });

  ipcMain.handle('images:page', (_e, opts: { offset: number; limit: number }) => {
    return imageQueries.page(opts.offset, opts.limit);
  });

  ipcMain.handle('images:count', () => imageQueries.count());

  ipcMain.handle('images:get', (_e, id: number) => imageQueries.getById(id));

  ipcMain.handle('shell:showInFolder', (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
    return true;
  });
}

function triggerScan(
  folderId: number,
  folderPath: string,
  send: (channel: string, payload: unknown) => void
) {
  if (activeScans.has(folderId)) return;
  activeScans.add(folderId);
  scanFolder(folderId, folderPath, (p: ScanProgress) => send('scan:progress', p))
    .catch((err) => {
      console.error('scan failed', err);
      send('scan:progress', {
        folderId,
        phase: 'error',
        scanned: 0,
        total: 0,
        message: String(err)
      } satisfies ScanProgress);
    })
    .finally(() => {
      activeScans.delete(folderId);
    });
}
