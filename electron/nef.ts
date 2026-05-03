import fs from 'node:fs/promises';
import exifr from 'exifr';

/**
 * Extract embedded preview JPEG from a NEF (Nikon RAW) file.
 *
 * NEF is a TIFF container. There is typically a full-size JPEG preview
 * stored in a SubIFD (`PreviewImageStart` / `PreviewImageLength` tags),
 * plus a smaller thumbnail in IFD0/IFD1.
 *
 * Strategy:
 *   1. Try `exifr.parse` to get preview offset/length from SubIFDs.
 *   2. If found, read those bytes from disk -> JPEG buffer.
 *   3. Otherwise fall back to `exifr.thumbnail()` (smaller, ~160px but usable).
 */
export async function extractNefPreview(filePath: string): Promise<Buffer | null> {
  // Attempt 1: full-size preview via SubIFDs
  try {
    const meta: any = await exifr.parse(filePath, {
      tiff: true,
      ifd0: true,
      ifd1: true,
      exif: false,
      gps: false,
      interop: false,
      mergeOutput: true,
      // Need raw access to less-common tags; ask exifr to expose makernote/subIFDs
      makerNote: false
    });
    // exifr exposes PreviewImageStart / PreviewImageLength when present
    const offset: number | undefined = meta?.PreviewImageStart ?? meta?.JpgFromRawStart;
    const length: number | undefined = meta?.PreviewImageLength ?? meta?.JpgFromRawLength;
    if (typeof offset === 'number' && typeof length === 'number' && length > 1024) {
      const fh = await fs.open(filePath, 'r');
      try {
        const buf = Buffer.alloc(length);
        await fh.read(buf, 0, length, offset);
        // Quick sanity check: JPEG SOI marker
        if (buf[0] === 0xff && buf[1] === 0xd8) return buf;
      } finally {
        await fh.close();
      }
    }
  } catch {
    /* fall through */
  }

  // Attempt 2: small embedded thumbnail
  try {
    const thumb = await exifr.thumbnail(filePath);
    if (thumb) return Buffer.from(thumb);
  } catch {
    /* ignore */
  }

  return null;
}
