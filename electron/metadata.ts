import exifr from 'exifr';

export type DateSource = 'filename' | 'exif' | 'mtime';

export interface ResolvedDate {
  ts: number;
  source: DateSource;
}

const MIN_YEAR = 1990;
const MAX_YEAR = new Date().getFullYear() + 1;

function isValidDate(y: number, m: number, d: number, hh = 12, mm = 0, ss = 0): number | null {
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null;
  const date = new Date(y, m - 1, d, hh, mm, ss);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  )
    return null;
  return date.getTime();
}

interface Pattern {
  re: RegExp;
  // Returns [Y,M,D,h?,m?,s?] from match groups
  extract: (m: RegExpMatchArray) => [number, number, number, number?, number?, number?] | null;
}

const PATTERNS: Pattern[] = [
  // Pixel: PXL_20230815_143045123 (sub-second optional)
  {
    re: /PXL[_-](\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/i,
    extract: (m) => [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]]
  },
  // WhatsApp: IMG-20230815-WA0001
  {
    re: /IMG-(\d{4})(\d{2})(\d{2})-WA\d+/i,
    extract: (m) => [+m[1], +m[2], +m[3]]
  },
  // Screenshot Android: Screenshot_2023-08-15-14-30-45 or Screenshot_20230815-143045
  {
    re: /Screenshot[_-](\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[-_. ]?(\d{2})?[-_.:]?(\d{2})?[-_.:]?(\d{2})?/i,
    extract: (m) => [+m[1], +m[2], +m[3], m[4] ? +m[4] : undefined, m[5] ? +m[5] : undefined, m[6] ? +m[6] : undefined]
  },
  // ISO with separators: 2023-08-15_14-30-45 or 2023-08-15 14.30.45
  {
    re: /(?<!\d)(\d{4})[-_.](\d{2})[-_.](\d{2})(?:[ _T-](\d{2})[-_.:](\d{2})(?:[-_.:](\d{2}))?)?/,
    extract: (m) => [+m[1], +m[2], +m[3], m[4] ? +m[4] : undefined, m[5] ? +m[5] : undefined, m[6] ? +m[6] : undefined]
  },
  // iPhone/Android compact: IMG_20230815_143045 / VID_20230815_143045 / MVIMG_...
  {
    re: /(?:IMG|VID|MVIMG|MV)[_-]?(\d{4})(\d{2})(\d{2})[_-]?(\d{2})?(\d{2})?(\d{2})?/i,
    extract: (m) => [+m[1], +m[2], +m[3], m[4] ? +m[4] : undefined, m[5] ? +m[5] : undefined, m[6] ? +m[6] : undefined]
  },
  // Compact start: 20230815_143045 or 20230815-143045
  {
    re: /(?<!\d)(\d{4})(\d{2})(\d{2})[-_ ](\d{2})(\d{2})(\d{2})(?!\d)/,
    extract: (m) => [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]]
  },
  // Generic 8-digit YYYYMMDD anywhere (fallback)
  {
    re: /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/,
    extract: (m) => [+m[1], +m[2], +m[3]]
  }
];

export function parseFilenameDate(filename: string): number | null {
  // Strip extension
  const base = filename.replace(/\.[^./\\]+$/, '');
  for (const p of PATTERNS) {
    const m = base.match(p.re);
    if (!m) continue;
    const parts = p.extract(m);
    if (!parts) continue;
    const [y, mo, d, hh, mm, ss] = parts;
    const ts = isValidDate(y, mo, d, hh, mm, ss);
    if (ts !== null) return ts;
  }
  return null;
}

export async function readExifDate(filePath: string): Promise<number | null> {
  try {
    const data = await exifr.parse(filePath, {
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'],
      // NEF: tiff/IFD0 needed
      tiff: true,
      ifd0: true,
      exif: true
    });
    if (!data) return null;
    const d: Date | undefined = data.DateTimeOriginal ?? data.CreateDate ?? data.ModifyDate;
    if (!d) return null;
    const ts = d instanceof Date ? d.getTime() : new Date(d).getTime();
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

const ONE_DAY_MS = 86_400_000;

export function resolveDate(
  filenameDate: number | null,
  exifDate: number | null,
  mtime: number
): ResolvedDate {
  if (filenameDate !== null && exifDate !== null) {
    // If filename is meaningfully older than EXIF, prefer filename
    // (assumption: file was edited/converted, EXIF overwritten, name preserves original capture date)
    if (filenameDate < exifDate - ONE_DAY_MS) {
      return { ts: filenameDate, source: 'filename' };
    }
    return { ts: exifDate, source: 'exif' };
  }
  if (exifDate !== null) return { ts: exifDate, source: 'exif' };
  if (filenameDate !== null) return { ts: filenameDate, source: 'filename' };
  return { ts: mtime, source: 'mtime' };
}

export async function resolveImageDate(
  filePath: string,
  filename: string,
  mtime: number
): Promise<{ resolved: ResolvedDate; exif: number | null; fromName: number | null }> {
  const fromName = parseFilenameDate(filename);
  const exif = await readExifDate(filePath);
  return { resolved: resolveDate(fromName, exif, mtime), exif, fromName };
}
