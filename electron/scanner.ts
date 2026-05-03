import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import pLimit from 'p-limit';
import { folderQueries, imageQueries } from './db';
import { resolveImageDate, parseFolderDate } from './metadata';
import { generateThumbnail, thumbPathFor } from './thumbnail';
import { normalizePath, pathEquals } from './pathUtil';

// Concurrency tuned for typical desktop SSDs. Metadata phase is dominated
// by EXIF header reads (small IO + JS parse) so it scales to ~2x core
// count. Thumbnail phase is dominated by sharp decode/encode and writes
// the cache file, so saturating CPU cores is enough.
const META_CONCURRENCY = Math.max(8, Math.min(32, os.cpus().length * 2));
const THUMB_CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length));

const SUPPORTED_EXT = new Set(['.jpg', '.jpeg', '.png', '.nef']);

export type ScanProgress = {
  folderId: number;
  phase: 'walking' | 'indexing' | 'thumbnailing' | 'done' | 'error';
  scanned: number;
  total: number;
  message?: string;
};

export type ProgressFn = (p: ScanProgress) => void;

async function* walk(dir: string, visited: Set<string> = new Set()): AsyncGenerator<string> {
  // Guard against symlink/junction loops by tracking realpath.
  let real: string;
  try {
    real = await fs.realpath(dir);
  } catch {
    return;
  }
  const key = process.platform === 'win32' ? real.toLowerCase() : real;
  if (visited.has(key)) return;
  visited.add(key);

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      // For symlinks, isDirectory() may be false; resolve and check.
      try {
        const st = await fs.stat(full);
        if (st.isDirectory()) {
          yield* walk(full, visited);
          continue;
        }
        if (!st.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXT.has(ext)) yield normalizePath(full);
      } catch {
        /* skip unreadable entry */
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXT.has(ext)) yield normalizePath(full);
    }
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk up from the image's parent directory toward (and including) the
 * scan root, returning the deepest folder name that parses as a date.
 * Per-scan cache keeps this cheap when many files share a parent.
 */
function makeFolderDateLookup(rootPath: string) {
  const cache = new Map<string, number | null>();
  return (filePath: string): number | null => {
    let dir = path.dirname(filePath);
    const visited: string[] = [];
    while (true) {
      let ts = cache.get(dir);
      if (ts === undefined) {
        ts = parseFolderDate(path.basename(dir));
        cache.set(dir, ts);
      }
      if (ts !== null) {
        for (const v of visited) cache.set(v, ts);
        return ts;
      }
      visited.push(dir);
      const parent = path.dirname(dir);
      if (pathEquals(dir, rootPath) || parent === dir) break;
      dir = parent;
    }
    return null;
  };
}

export async function scanFolder(
  folderId: number,
  rootPath: string,
  onProgress?: ProgressFn
): Promise<{ added: number; removed: number }> {
  onProgress?.({ folderId, phase: 'walking', scanned: 0, total: 0 });

  // Phase 1: walk (we still buffer the list because we need a final `total`
  // for both progress UI and the deleteMissing diff at the end).
  const files: string[] = [];
  for await (const f of walk(rootPath)) files.push(f);

  onProgress?.({ folderId, phase: 'indexing', scanned: 0, total: files.length });

  const folderDateOf = makeFolderDateLookup(rootPath);
  const limitMeta = pLimit(META_CONCURRENCY);
  const limitThumb = pLimit(THUMB_CONCURRENCY);

  let metaDone = 0;
  let thumbsQueued = 0;
  let thumbsDone = 0;
  let added = 0;

  // Push a thumb job into the limited pool. Returns a promise we collect
  // so we can await all of them at the end.
  const thumbJobs: Promise<void>[] = [];

  const queueThumb = (id: number, p: string, ext: string) => {
    thumbsQueued++;
    onProgress?.({
      folderId,
      phase: 'thumbnailing',
      scanned: thumbsDone,
      total: thumbsQueued
    });
    thumbJobs.push(
      limitThumb(async () => {
        try {
          await generateThumbnail(p, ext);
          imageQueries.setThumbStatus(id, 'ready');
        } catch (err) {
          console.error('thumb error', p, err);
          imageQueries.setThumbStatus(id, 'error');
        } finally {
          thumbsDone++;
          if (thumbsDone % 20 === 0 || thumbsDone === thumbsQueued) {
            onProgress?.({
              folderId,
              phase: 'thumbnailing',
              scanned: thumbsDone,
              total: thumbsQueued
            });
          }
        }
      })
    );
  };

  // Phase 2 + 3 pipeline: metadata workers fire and forget thumbnail jobs
  // into the thumb pool the moment a row is committed, so the two stages
  // overlap instead of running back to back.
  await Promise.all(
    files.map((file) =>
      limitMeta(async () => {
        try {
          const stat = await fs.stat(file);
          const filename = path.basename(file);
          const ext = path.extname(file).toLowerCase();
          const mtime = Math.floor(stat.mtimeMs);

          const existing = imageQueries.getByPath(file);

          // Hot path: row exists, mtime unchanged. Just verify the
          // thumbnail file is on disk; if it isn't, requeue without
          // re-reading EXIF or recomputing the date.
          if (existing && existing.mtime === mtime) {
            if (existing.thumb_status === 'ready') {
              if (!(await fileExists(thumbPathFor(file)))) {
                imageQueries.setThumbStatus(existing.id, 'pending');
                queueThumb(existing.id, file, ext);
              }
            } else if (existing.thumb_status === 'pending') {
              queueThumb(existing.id, file, ext);
            }
            return;
          }

          const fromFolder = folderDateOf(file);
          const { resolved, exif, fromName } = await resolveImageDate(file, filename, mtime, fromFolder);
          const id = imageQueries.upsert({
            folder_id: folderId,
            path: file,
            filename,
            ext,
            size: stat.size,
            mtime,
            exif_taken_at: exif,
            filename_taken_at: fromName,
            folder_taken_at: fromFolder,
            resolved_taken_at: resolved.ts,
            resolved_source: resolved.source,
            width: null,
            height: null,
            thumb_status: 'pending'
          });
          added++;
          queueThumb(id, file, ext);
        } catch (err) {
          console.error('index error', file, err);
        } finally {
          metaDone++;
          if (metaDone % 50 === 0 || metaDone === files.length) {
            onProgress?.({
              folderId,
              phase: 'indexing',
              scanned: metaDone,
              total: files.length
            });
          }
        }
      })
    )
  );

  // All metadata workers have committed. Drain the thumbnail pool.
  await Promise.all(thumbJobs);

  const removed = imageQueries.deleteMissing(folderId, new Set(files));
  folderQueries.markScanned(folderId);

  onProgress?.({ folderId, phase: 'done', scanned: files.length, total: files.length });
  return { added, removed };
}
