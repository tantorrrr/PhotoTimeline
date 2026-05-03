import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let db: Database.Database;

export interface Folder {
  id: number;
  path: string;
  added_at: number;
  last_scan_at: number | null;
}

export interface ImageRow {
  id: number;
  folder_id: number;
  path: string;
  filename: string;
  ext: string;
  size: number | null;
  mtime: number | null;
  exif_taken_at: number | null;
  filename_taken_at: number | null;
  resolved_taken_at: number;
  resolved_source: 'filename' | 'exif' | 'mtime';
  width: number | null;
  height: number | null;
  thumb_status: 'pending' | 'ready' | 'error';
}

export function initDb(dbPath?: string): Database.Database {
  const file = dbPath ?? path.join(app.getPath('userData'), 'index.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      added_at INTEGER NOT NULL,
      last_scan_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY,
      folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      path TEXT UNIQUE NOT NULL,
      filename TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER,
      mtime INTEGER,
      exif_taken_at INTEGER,
      filename_taken_at INTEGER,
      resolved_taken_at INTEGER NOT NULL,
      resolved_source TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      thumb_status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE INDEX IF NOT EXISTS idx_images_resolved ON images(resolved_taken_at DESC);
    CREATE INDEX IF NOT EXISTS idx_images_folder ON images(folder_id);
  `);

  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized');
  return db;
}

// --- folder queries ---
export const folderQueries = {
  list(): Folder[] {
    return getDb().prepare('SELECT * FROM folders ORDER BY added_at DESC').all() as Folder[];
  },
  add(p: string): number {
    const stmt = getDb().prepare(
      'INSERT INTO folders (path, added_at) VALUES (?, ?) ON CONFLICT(path) DO NOTHING'
    );
    const info = stmt.run(p, Date.now());
    if (info.changes === 0) {
      const existing = getDb().prepare('SELECT id FROM folders WHERE path = ?').get(p) as { id: number };
      return existing.id;
    }
    return info.lastInsertRowid as number;
  },
  remove(id: number): void {
    getDb().prepare('DELETE FROM folders WHERE id = ?').run(id);
  },
  markScanned(id: number): void {
    getDb().prepare('UPDATE folders SET last_scan_at = ? WHERE id = ?').run(Date.now(), id);
  },
  countImages(id: number): number {
    const r = getDb().prepare('SELECT COUNT(*) AS n FROM images WHERE folder_id = ?').get(id) as { n: number };
    return r.n;
  }
};

// --- image queries ---
export const imageQueries = {
  upsert(row: Omit<ImageRow, 'id'>): number {
    const stmt = getDb().prepare(`
      INSERT INTO images (folder_id, path, filename, ext, size, mtime,
        exif_taken_at, filename_taken_at, resolved_taken_at, resolved_source,
        width, height, thumb_status)
      VALUES (@folder_id, @path, @filename, @ext, @size, @mtime,
        @exif_taken_at, @filename_taken_at, @resolved_taken_at, @resolved_source,
        @width, @height, @thumb_status)
      ON CONFLICT(path) DO UPDATE SET
        mtime = excluded.mtime,
        size = excluded.size,
        exif_taken_at = excluded.exif_taken_at,
        filename_taken_at = excluded.filename_taken_at,
        resolved_taken_at = excluded.resolved_taken_at,
        resolved_source = excluded.resolved_source,
        width = excluded.width,
        height = excluded.height
      RETURNING id
    `);
    const r = stmt.get(row) as { id: number };
    return r.id;
  },
  setThumbStatus(id: number, status: ImageRow['thumb_status']): void {
    getDb().prepare('UPDATE images SET thumb_status = ? WHERE id = ?').run(status, id);
  },
  getById(id: number): ImageRow | undefined {
    return getDb().prepare('SELECT * FROM images WHERE id = ?').get(id) as ImageRow | undefined;
  },
  getByPath(p: string): ImageRow | undefined {
    return getDb().prepare('SELECT * FROM images WHERE path = ?').get(p) as ImageRow | undefined;
  },
  page(offset: number, limit: number): ImageRow[] {
    return getDb()
      .prepare('SELECT * FROM images ORDER BY resolved_taken_at DESC, id DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as ImageRow[];
  },
  count(): number {
    const r = getDb().prepare('SELECT COUNT(*) AS n FROM images').get() as { n: number };
    return r.n;
  },
  pendingThumbs(limit = 100): ImageRow[] {
    return getDb()
      .prepare("SELECT * FROM images WHERE thumb_status = 'pending' LIMIT ?")
      .all(limit) as ImageRow[];
  },
  deleteMissing(folderId: number, existingPaths: Set<string>): number {
    const all = getDb()
      .prepare('SELECT id, path FROM images WHERE folder_id = ?')
      .all(folderId) as { id: number; path: string }[];
    const del = getDb().prepare('DELETE FROM images WHERE id = ?');
    let n = 0;
    const tx = getDb().transaction(() => {
      for (const r of all) {
        if (!existingPaths.has(r.path)) {
          del.run(r.id);
          n++;
        }
      }
    });
    tx();
    return n;
  }
};
