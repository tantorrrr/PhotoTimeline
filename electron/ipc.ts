import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {
  folderQueries,
  imageQueries,
  albumQueries,
  AddFolderResult,
  Album,
  DuplicateGroup
} from './db';
import { scanFolder, ScanProgress } from './scanner';
import { resolveDate } from './metadata';

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

  // --- favorites & manual date override ---
  ipcMain.handle('images:setFavorite', (_e, id: number, favorite: boolean) => {
    imageQueries.setFavorite(id, favorite);
    return true;
  });

  // Set (or clear, with null) a manual capture date. We recompute the
  // resolved date here so the row re-sorts immediately, mirroring the
  // precedence the scanner uses.
  ipcMain.handle('images:setDate', (_e, id: number, ts: number | null) => {
    const row = imageQueries.getById(id);
    if (!row) return null;
    const resolved = resolveDate(
      row.filename_taken_at,
      row.exif_taken_at,
      row.folder_taken_at,
      row.mtime ?? Date.now(),
      ts
    );
    imageQueries.setResolved(id, ts, resolved.ts, resolved.source);
    return imageQueries.getById(id);
  });

  // --- duplicate finder ---
  ipcMain.handle('images:findDuplicates', (): DuplicateGroup[] => {
    return imageQueries.duplicateGroups();
  });

  // Move the given images' files to the OS trash (recoverable) and drop
  // them from the index. Originals are never silently unlinked.
  ipcMain.handle('images:trash', async (_e, ids: number[]) => {
    let trashed = 0;
    const failed: number[] = [];
    for (const id of ids) {
      const row = imageQueries.getById(id);
      if (!row) continue;
      try {
        await shell.trashItem(row.path);
        imageQueries.deleteById(id);
        trashed++;
      } catch (err) {
        console.error('trash failed', row.path, err);
        failed.push(id);
      }
    }
    return { trashed, failed };
  });

  // Copy the given images' originals into a user-picked folder (export).
  ipcMain.handle('images:exportTo', async (_e, ids: number[]) => {
    const w = getWindow();
    if (!w) return { copied: 0, dest: null };
    const r = await dialog.showOpenDialog(w, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Chọn thư mục để xuất ảnh'
    });
    if (r.canceled || r.filePaths.length === 0) return { copied: 0, dest: null };
    const dest = r.filePaths[0];
    let copied = 0;
    for (const id of ids) {
      const row = imageQueries.getById(id);
      if (!row) continue;
      try {
        // Avoid clobbering files that share a basename across source folders.
        let target = path.join(dest, row.filename);
        let n = 1;
        while (await pathExists(target)) {
          const ext = path.extname(row.filename);
          const stem = path.basename(row.filename, ext);
          target = path.join(dest, `${stem} (${n++})${ext}`);
        }
        await fsp.copyFile(row.path, target);
        copied++;
      } catch (err) {
        console.error('export failed', row.path, err);
      }
    }
    return { copied, dest };
  });

  // --- albums ---
  ipcMain.handle('albums:list', (): Album[] => albumQueries.list());
  ipcMain.handle('albums:create', (_e, name: string): Album => albumQueries.create(name));
  ipcMain.handle('albums:remove', (_e, id: number) => {
    albumQueries.remove(id);
    return true;
  });
  ipcMain.handle('albums:addImages', (_e, albumId: number, imageIds: number[]) => {
    albumQueries.addImages(albumId, imageIds);
    return true;
  });
  ipcMain.handle('albums:removeImage', (_e, albumId: number, imageId: number) => {
    albumQueries.removeImage(albumId, imageId);
    return true;
  });
  ipcMain.handle('albums:imageIds', (_e, albumId: number): number[] =>
    albumQueries.imageIds(albumId)
  );
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
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
