import fs from 'node:fs/promises';
import exifr from 'exifr';

/**
 * Extract the largest embedded JPEG preview from a NEF (Nikon RAW) file
 * by walking the TIFF tag tree manually.
 *
 * NEF is a TIFF container. Different Nikon bodies stash the full-size
 * preview JPEG in different places:
 *   - IFD0 with JPEGInterchangeFormat (0x0201) + length (0x0202)
 *   - one of several SubIFDs (tag 0x014A in IFD0) carrying the same pair
 *   - the small reduced thumbnail in IFD1
 *
 * exifr's high-level parse() doesn't surface SubIFD entries, and its
 * thumbnail() typically returns only the IFD1 ~160px thumbnail. To get
 * the big preview reliably we read the TIFF header, walk every IFD and
 * SubIFD we can reach, collect (offset, length) pairs that look like
 * JPEGs, and return the biggest one.
 *
 * If no preview is found, fall back to exifr.thumbnail() so the UI gets
 * at least something rather than a broken image.
 */
export async function extractNefPreview(filePath: string): Promise<Buffer | null> {
  const big = await extractLargestEmbeddedJpeg(filePath);
  if (big) return big;
  try {
    const thumb = await exifr.thumbnail(filePath);
    if (thumb) return Buffer.from(thumb);
  } catch {
    /* fall through */
  }
  return null;
}

interface JpegRef {
  offset: number;
  length: number;
}

async function extractLargestEmbeddedJpeg(filePath: string): Promise<Buffer | null> {
  let fh;
  try {
    fh = await fs.open(filePath, 'r');
  } catch {
    return null;
  }

  try {
    const header = Buffer.alloc(8);
    await fh.read(header, 0, 8, 0);
    const bo = header.toString('ascii', 0, 2);
    if (bo !== 'II' && bo !== 'MM') return null;
    const isLE = bo === 'II';
    const u16 = (b: Buffer, o: number) => (isLE ? b.readUInt16LE(o) : b.readUInt16BE(o));
    const u32 = (b: Buffer, o: number) => (isLE ? b.readUInt32LE(o) : b.readUInt32BE(o));

    const magic = u16(header, 2);
    if (magic !== 42) return null;
    const ifd0Offset = u32(header, 4);

    const candidates: JpegRef[] = [];
    const visited = new Set<number>();

    // Iterative walk of an IFD chain starting at `start`. Each IFD may
    // expose SubIFDs (tag 0x014A) which we queue up for inspection too.
    const queue: number[] = [ifd0Offset];

    while (queue.length > 0) {
      const ifdOffset = queue.shift()!;
      if (ifdOffset === 0 || visited.has(ifdOffset)) continue;
      visited.add(ifdOffset);

      // Cap recursion to defend against malformed files
      if (visited.size > 64) break;

      const countBuf = Buffer.alloc(2);
      try {
        await fh.read(countBuf, 0, 2, ifdOffset);
      } catch {
        continue;
      }
      const count = u16(countBuf, 0);
      if (count === 0 || count > 4096) continue;

      const entriesLen = count * 12 + 4;
      const entries = Buffer.alloc(entriesLen);
      try {
        await fh.read(entries, 0, entriesLen, ifdOffset + 2);
      } catch {
        continue;
      }

      let jpegOffset: number | null = null;
      let jpegLength: number | null = null;

      for (let i = 0; i < count; i++) {
        const off = i * 12;
        const tag = u16(entries, off);
        const cnt = u32(entries, off + 4);
        const val = u32(entries, off + 8);

        switch (tag) {
          case 0x0201: // JPEGInterchangeFormat
          case 0x01b4: // PreviewImageStart (some Nikons)
            jpegOffset = val;
            break;
          case 0x0202: // JPEGInterchangeFormatLength
          case 0x01b5: // PreviewImageLength
            jpegLength = val;
            break;
          case 0x014a: {
            // SubIFDs: array of LONG offsets. For cnt=1 the value field
            // IS the offset; for cnt>1 the value field points to an
            // external array.
            if (cnt === 1) {
              queue.push(val);
            } else if (cnt > 1 && cnt < 64) {
              const arr = Buffer.alloc(cnt * 4);
              try {
                await fh.read(arr, 0, cnt * 4, val);
                for (let j = 0; j < cnt; j++) queue.push(u32(arr, j * 4));
              } catch {
                /* ignore */
              }
            }
            break;
          }
        }
      }

      if (jpegOffset && jpegLength && jpegLength > 1024) {
        candidates.push({ offset: jpegOffset, length: jpegLength });
      }

      // Continue to next IFD in the chain (for the top-level walk).
      const next = u32(entries, count * 12);
      if (next !== 0) queue.push(next);
    }

    if (candidates.length === 0) return null;

    // Largest preview wins. Sanity-check the JPEG SOI marker.
    candidates.sort((a, b) => b.length - a.length);
    for (const c of candidates) {
      const buf = Buffer.alloc(c.length);
      try {
        await fh.read(buf, 0, c.length, c.offset);
      } catch {
        continue;
      }
      if (buf[0] === 0xff && buf[1] === 0xd8) return buf;
    }
    return null;
  } finally {
    await fh.close();
  }
}
