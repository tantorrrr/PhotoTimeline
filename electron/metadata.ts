import exifr from 'exifr';

export type DateSource = 'filename' | 'exif' | 'folder' | 'mtime';

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

/**
 * Try to extract a capture date from a folder name. Many users organise
 * photos into folders named like `21-10-2012`, `tet 2019`, `phuot 5 2 2015`,
 * `dienthoai-06-2014`, `Ki yeu - 30 - 5 -15`. The convention is Vietnamese
 * day-first (DD-MM-YYYY); we fall back to month-first only when DD-MM is
 * not a valid calendar date.
 *
 * Less precise than EXIF: month-only folders pin the date to mid-month
 * (day 15) and year-only folders pin to July 1, so they sort in the middle
 * of the period rather than dominating January.
 */
export function parseFolderDate(folderName: string): number | null {
  const name = folderName.trim();
  if (!name) return null;

  // 1. ISO YYYY-MM-DD (year-first, day last). Most precise format - try first
  //    so it isn't misread as the day-first patterns.
  //    e.g. "2014-05-30", "Trip 2020-01-15", "2019.12.31_archive"
  const mIso = name.match(/(?<!\d)(\d{4})[-./_](\d{1,2})[-./_](\d{1,2})(?!\d)/);
  if (mIso) {
    const ts = isValidDate(+mIso[1], +mIso[2], +mIso[3]);
    if (ts !== null) return ts;
  }

  // 2. Day-Month-FullYear (separators: - . / _ or one+ space)
  //    e.g. "21-10-2012", "30.12.2012", "26 12 2014", "phuot 5 2 2015",
  //    "tot nghiep k5 - dot 1 - 20-06-2015"
  const m1 = name.match(/(?<!\d)(\d{1,2})[-./_ ]+(\d{1,2})[-./_ ]+(\d{4})(?!\d)/);
  if (m1) {
    const ts = tryDayMonthYear(+m1[1], +m1[2], +m1[3]);
    if (ts !== null) return ts;
  }

  // 2. Day-Month-ShortYear
  //    e.g. "03-09-13", "16-12-12", "anh-6-2-13", "Ki yeu - 30 - 5 -15",
  //    "30-08-13.nhaucuoinam.kidsDiThi"
  const m2 = name.match(/(?<!\d)(\d{1,2})[-./_ ]+(\d{1,2})[-./_ ]+(\d{2})(?!\d)/);
  if (m2) {
    const ts = tryDayMonthYear(+m2[1], +m2[2], expandShortYear(+m2[3]));
    if (ts !== null) return ts;
  }

  // 3. Month-FullYear (day defaults to 15)
  //    e.g. "dienthoai-06-2014", "bocapvang 1-2015", "triptrip 2-2015"
  const m3 = name.match(/(?<!\d)(\d{1,2})[-./_ ]+(\d{4})(?!\d)/);
  if (m3) {
    const ts = tryMonthYear(+m3[1], +m3[2]);
    if (ts !== null) return ts;
  }

  // 4. Year only (day defaults to July 1)
  //    e.g. "tet 2019", "noel 2014", "anhTet-2013", "da banh liver 2012"
  const m4 = name.match(/(?<!\d)(19\d{2}|20\d{2})(?!\d)/);
  if (m4) {
    const y = +m4[1];
    if (y >= MIN_YEAR && y <= MAX_YEAR) {
      return new Date(y, 6, 1, 12, 0, 0).getTime();
    }
  }
  return null;
}

function expandShortYear(yy: number): number {
  const cur2 = new Date().getFullYear() % 100;
  return yy <= cur2 + 1 ? 2000 + yy : 1900 + yy;
}

function tryDayMonthYear(a: number, b: number, y: number): number | null {
  // Vietnamese convention: DD-MM-YYYY first
  const dm = isValidDate(y, b, a);
  if (dm !== null) return dm;
  // Fallback to MM-DD-YYYY when day-first doesn't validate
  const md = isValidDate(y, a, b);
  if (md !== null) return md;
  return null;
}

function tryMonthYear(m: number, y: number): number | null {
  if (m < 1 || m > 12) return null;
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  return new Date(y, m - 1, 15, 12, 0, 0).getTime();
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

/**
 * Combine the four candidate sources into a single resolved date.
 *
 * Priority (per user requirement): folder name wins over file-internal
 * sources whenever it parses out a date. The motivation is that folder
 * structure is the most deliberate organisation signal a user gives -
 * `tet 2019/IMG_001.JPG` is meant to live in 2019 even when EXIF was
 * rewritten to today's date by some converter or screenshot tool.
 *
 * When no folder date is detectable we fall back to the file itself:
 * EXIF, with the existing edited-file heuristic that promotes a
 * meaningfully older filename date over a suspiciously new EXIF.
 */
export function resolveDate(
  filenameDate: number | null,
  exifDate: number | null,
  folderDate: number | null,
  mtime: number
): ResolvedDate {
  if (folderDate !== null) {
    return { ts: folderDate, source: 'folder' };
  }
  if (exifDate !== null) {
    if (filenameDate !== null && filenameDate < exifDate - ONE_DAY_MS) {
      return { ts: filenameDate, source: 'filename' };
    }
    return { ts: exifDate, source: 'exif' };
  }
  if (filenameDate !== null) return { ts: filenameDate, source: 'filename' };
  return { ts: mtime, source: 'mtime' };
}

export async function resolveImageDate(
  filePath: string,
  filename: string,
  mtime: number,
  folderDate: number | null = null
): Promise<{
  resolved: ResolvedDate;
  exif: number | null;
  fromName: number | null;
  fromFolder: number | null;
}> {
  const fromName = parseFilenameDate(filename);
  const exif = await readExifDate(filePath);
  return {
    resolved: resolveDate(fromName, exif, folderDate, mtime),
    exif,
    fromName,
    fromFolder: folderDate
  };
}
