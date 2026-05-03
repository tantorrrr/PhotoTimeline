import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { app } from 'electron';
import { extractNefPreview } from './nef';

const THUMB_SIZE = 256;

// Each sharp call internally uses libvips threads. Because we run several
// thumbnail jobs in parallel via p-limit, capping libvips at 1 thread per
// op gives the OS scheduler a fair shot and avoids 16+ threads contending
// for the same cores.
sharp.concurrency(1);

let cacheDir: string | null = null;

export function thumbDir(): string {
  if (cacheDir) return cacheDir;
  cacheDir = path.join(app.getPath('userData'), 'thumbs');
  return cacheDir;
}

export function thumbPathFor(imagePath: string): string {
  const hash = crypto.createHash('sha1').update(imagePath).digest('hex');
  return path.join(thumbDir(), `${hash}.jpg`);
}

export async function ensureThumbDir(): Promise<void> {
  await fs.mkdir(thumbDir(), { recursive: true });
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate (or reuse) the on-disk thumbnail for an image.
 * Returns true if the cache hit and no work was done, false if regenerated.
 */
export async function generateThumbnail(imagePath: string, ext: string): Promise<boolean> {
  await ensureThumbDir();
  const out = thumbPathFor(imagePath);

  // Cache hit - skip the expensive decode/resize/encode.
  if (await exists(out)) return true;

  let input: string | Buffer = imagePath;
  if (ext === '.nef') {
    const buf = await extractNefPreview(imagePath);
    if (!buf) throw new Error('NEF preview not found');
    input = buf;
  }

  await sharp(input, { failOn: 'none' })
    .rotate()
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
    .jpeg({ quality: 80 })
    .toFile(out);
  return false;
}

export async function generateFullPreview(imagePath: string, ext: string): Promise<Buffer> {
  if (ext === '.nef') {
    const buf = await extractNefPreview(imagePath);
    if (!buf) throw new Error('NEF preview not found');
    return buf;
  }
  return fs.readFile(imagePath);
}
