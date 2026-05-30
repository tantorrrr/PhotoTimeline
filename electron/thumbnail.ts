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
    // 'inside' preserves the full frame (no crop) so the grid tile matches
    // the image you see when opening it; the renderer letterboxes the
    // non-square result into a square cell via object-fit: contain.
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
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

/**
 * Compute a 64-bit difference hash (dHash) for an image, returned as 16 hex
 * chars. The image is reduced to greyscale 9x8 and each pixel is compared
 * to its right neighbour, yielding 8x8 = 64 bits. Visually identical images
 * (re-encodes, copies, minor resizes) collapse to the same or a very close
 * hash, which the duplicate finder groups on. NEF goes through its embedded
 * preview so RAW files hash consistently with their JPEG siblings.
 */
export async function perceptualHash(imagePath: string, ext: string): Promise<string | null> {
  try {
    let input: string | Buffer = imagePath;
    if (ext === '.nef') {
      const buf = await extractNefPreview(imagePath);
      if (!buf) return null;
      input = buf;
    }
    const { data } = await sharp(input, { failOn: 'none' })
      .greyscale()
      .resize(9, 8, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Row-major 9 wide x 8 tall. Compare each pixel with its right neighbour.
    let hex = '';
    for (let y = 0; y < 8; y++) {
      let nibble = 0;
      let bitsInNibble = 0;
      for (let x = 0; x < 8; x++) {
        const i = y * 9 + x;
        nibble = (nibble << 1) | (data[i] > data[i + 1] ? 1 : 0);
        if (++bitsInNibble === 4) {
          hex += nibble.toString(16);
          nibble = 0;
          bitsInNibble = 0;
        }
      }
    }
    return hex;
  } catch {
    return null;
  }
}
