import fs from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import { folderQueries, imageQueries, ImageRow } from './db';
import { resolveImageDate } from './metadata';
import { generateThumbnail } from './thumbnail';

const SUPPORTED_EXT = new Set(['.jpg', '.jpeg', '.png', '.nef']);

export type ScanProgress = {
  folderId: number;
  phase: 'walking' | 'indexing' | 'thumbnailing' | 'done' | 'error';
  scanned: number;
  total: number;
  message?: string;
};

export type ProgressFn = (p: ScanProgress) => void;

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXT.has(ext)) yield full;
    }
  }
}

export async function scanFolder(
  folderId: number,
  rootPath: string,
  onProgress?: ProgressFn
): Promise<{ added: number; removed: number }> {
  onProgress?.({ folderId, phase: 'walking', scanned: 0, total: 0 });

  // Phase 1: walk
  const files: string[] = [];
  for await (const f of walk(rootPath)) files.push(f);

  onProgress?.({ folderId, phase: 'indexing', scanned: 0, total: files.length });

  // Phase 2: index metadata (parallel with limit)
  const limitMeta = pLimit(8);
  const newOrUpdated: ImageRow[] = [];
  let scanned = 0;

  await Promise.all(
    files.map((file) =>
      limitMeta(async () => {
        try {
          const stat = await fs.stat(file);
          const filename = path.basename(file);
          const ext = path.extname(file).toLowerCase();
          const mtime = stat.mtimeMs | 0;

          const existing = imageQueries.getByPath(file);
          if (existing && existing.mtime === mtime) {
            scanned++;
            if (scanned % 50 === 0)
              onProgress?.({ folderId, phase: 'indexing', scanned, total: files.length });
            return;
          }

          const { resolved, exif, fromName } = await resolveImageDate(file, filename, mtime);

          const id = imageQueries.upsert({
            folder_id: folderId,
            path: file,
            filename,
            ext,
            size: stat.size,
            mtime,
            exif_taken_at: exif,
            filename_taken_at: fromName,
            resolved_taken_at: resolved.ts,
            resolved_source: resolved.source,
            width: null,
            height: null,
            thumb_status: 'pending'
          });
          newOrUpdated.push({ ...(imageQueries.getById(id) as ImageRow) });
        } catch (err) {
          console.error('index error', file, err);
        } finally {
          scanned++;
          if (scanned % 50 === 0)
            onProgress?.({ folderId, phase: 'indexing', scanned, total: files.length });
        }
      })
    )
  );

  // Remove rows for files that disappeared
  const removed = imageQueries.deleteMissing(folderId, new Set(files));
  folderQueries.markScanned(folderId);

  // Phase 3: thumbnails
  const pending = imageQueries.pendingThumbs(100_000);
  onProgress?.({ folderId, phase: 'thumbnailing', scanned: 0, total: pending.length });

  const limitThumb = pLimit(4);
  let thumbDone = 0;
  await Promise.all(
    pending.map((row) =>
      limitThumb(async () => {
        try {
          await generateThumbnail(row.path, row.ext);
          imageQueries.setThumbStatus(row.id, 'ready');
        } catch (err) {
          console.error('thumb error', row.path, err);
          imageQueries.setThumbStatus(row.id, 'error');
        } finally {
          thumbDone++;
          if (thumbDone % 20 === 0 || thumbDone === pending.length)
            onProgress?.({
              folderId,
              phase: 'thumbnailing',
              scanned: thumbDone,
              total: pending.length
            });
        }
      })
    )
  );

  onProgress?.({ folderId, phase: 'done', scanned: files.length, total: files.length });
  return { added: newOrUpdated.length, removed };
}
