import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { app } from 'electron';
import { extractNefPreview } from './nef';

const THUMB_SIZE = 256;

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

export async function generateThumbnail(imagePath: string, ext: string): Promise<void> {
  await ensureThumbDir();
  const out = thumbPathFor(imagePath);

  let input: string | Buffer = imagePath;
  if (ext === '.nef') {
    const buf = await extractNefPreview(imagePath);
    if (!buf) throw new Error('NEF preview not found');
    input = buf;
  }

  await sharp(input, { failOn: 'none' })
    .rotate() // honor EXIF orientation
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
    .jpeg({ quality: 80 })
    .toFile(out);
}

export async function generateFullPreview(imagePath: string, ext: string): Promise<Buffer> {
  // For NEF, return embedded JPEG preview as-is (already large enough).
  // For JPG/PNG, return the file bytes.
  if (ext === '.nef') {
    const buf = await extractNefPreview(imagePath);
    if (!buf) throw new Error('NEF preview not found');
    return buf;
  }
  return fs.readFile(imagePath);
}
