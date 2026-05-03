import { describe, it, expect } from 'vitest';
import { parseFilenameDate, parseFolderDate, resolveDate } from './metadata';

describe('parseFilenameDate', () => {
  const cases: [string, string | null][] = [
    // [filename, expected ISO date or null]
    ['IMG_20230815_143045.jpg', '2023-08-15T14:30:45'],
    ['IMG-20230815-WA0001.jpg', '2023-08-15T12:00:00'],
    ['PXL_20230815_143045123.jpg', '2023-08-15T14:30:45'],
    ['VID_20230815_143045.mp4', '2023-08-15T14:30:45'],
    ['Screenshot_2023-08-15-14-30-45.png', '2023-08-15T14:30:45'],
    ['Screenshot_20230815-143045.png', '2023-08-15T14:30:45'],
    ['20230815_143045.jpg', '2023-08-15T14:30:45'],
    ['2023-08-15_14-30-45.jpg', '2023-08-15T14:30:45'],
    ['2023-08-15 14.30.45.jpg', '2023-08-15T14:30:45'],
    ['DSC_0001.NEF', null],
    ['IMG_0001.JPG', null],
    ['random.jpg', null],
    ['vacation_20230815.jpg', '2023-08-15T12:00:00'], // date-only fallback
    // Out of range year
    ['IMG_19800101_120000.jpg', null],
    // Invalid month
    ['IMG_20231345_120000.jpg', null]
  ];

  for (const [name, expected] of cases) {
    it(`parses ${name}`, () => {
      const ts = parseFilenameDate(name);
      if (expected === null) {
        expect(ts).toBeNull();
      } else {
        expect(ts).not.toBeNull();
        // Compare with local-time interpretation (constructor uses local TZ)
        const exp = new Date(expected).getTime();
        // Allow for tz interpretation: just compare year/month/day
        const got = new Date(ts!);
        const want = new Date(exp);
        expect(got.getFullYear()).toBe(want.getFullYear());
        expect(got.getMonth()).toBe(want.getMonth());
        expect(got.getDate()).toBe(want.getDate());
      }
    });
  }
});

describe('resolveDate', () => {
  const mtime = new Date('2025-01-01T00:00:00').getTime();
  const exifNew = new Date('2024-06-01T00:00:00').getTime();
  const filenameOld = new Date('2020-01-01T00:00:00').getTime();
  const folderOld = new Date('2015-05-30T12:00:00').getTime();
  const filenameSameAsExif = new Date('2024-06-01T00:00:00').getTime();

  it('prefers filename when filename is meaningfully older than EXIF (edited file scenario)', () => {
    const r = resolveDate(filenameOld, exifNew, null, mtime);
    expect(r.source).toBe('filename');
    expect(r.ts).toBe(filenameOld);
  });

  it('prefers EXIF when both agree (same day)', () => {
    const r = resolveDate(filenameSameAsExif, exifNew, null, mtime);
    expect(r.source).toBe('exif');
    expect(r.ts).toBe(exifNew);
  });

  it('uses EXIF when filename has no date', () => {
    const r = resolveDate(null, exifNew, null, mtime);
    expect(r.source).toBe('exif');
  });

  it('uses filename when EXIF missing', () => {
    const r = resolveDate(filenameOld, null, null, mtime);
    expect(r.source).toBe('filename');
  });

  it('falls back to mtime when all missing', () => {
    const r = resolveDate(null, null, null, mtime);
    expect(r.source).toBe('mtime');
    expect(r.ts).toBe(mtime);
  });

  it('uses folder when EXIF and filename missing', () => {
    const r = resolveDate(null, null, folderOld, mtime);
    expect(r.source).toBe('folder');
    expect(r.ts).toBe(folderOld);
  });

  it('folder wins over EXIF whenever folder is set', () => {
    // folder date + same-day EXIF -> folder still wins (user-requested rule)
    const r = resolveDate(null, exifNew, folderOld, mtime);
    expect(r.source).toBe('folder');
    expect(r.ts).toBe(folderOld);
  });

  it('folder wins over filename whenever folder is set', () => {
    const r = resolveDate(filenameOld, exifNew, folderOld, mtime);
    expect(r.source).toBe('folder');
  });

  it('falls back to EXIF when folder has no date', () => {
    const r = resolveDate(null, exifNew, null, mtime);
    expect(r.source).toBe('exif');
    expect(r.ts).toBe(exifNew);
  });
});

describe('parseFolderDate', () => {
  // Use day-month-year tuples [Y, M, D] for unambiguous expectation; null = no match.
  const cases: [string, [number, number, number] | null][] = [
    // ISO YYYY-MM-DD (year-first) - highest priority
    ['2014-05-30', [2014, 5, 30]],
    ['2019.12.31_archive', [2019, 12, 31]],
    ['Trip 2020-01-15', [2020, 1, 15]],
    ['2023_06_07', [2023, 6, 7]],
    // Full DD-MM-YYYY with various separators
    ['21-10-2012', [2012, 10, 21]],
    ['10.3.2016', [2016, 3, 10]],
    ['14-2-2013', [2013, 2, 14]],
    ['8-5-2013', [2013, 5, 8]],
    ['30-12-2012', [2012, 12, 30]],
    ['phuot 5 2 2015', [2015, 2, 5]],
    ['khoan luan - 26-12-2014', [2014, 12, 26]],
    ['anh-14-9-2012', [2012, 9, 14]],
    ['tot nghiep k5 - dot 1 - 20-06-2015', [2015, 6, 20]],
    // Short year (DD-MM-YY)
    ['03-09-13', [2013, 9, 3]],
    ['16-12-12', [2012, 12, 16]],
    ['25-12-12 Cuoi-chi-Ninh', [2012, 12, 25]],
    ['27-10-2012', [2012, 10, 27]],
    ['anh-6-2-13', [2013, 2, 6]],
    ['anh-19-7-12', [2012, 7, 19]],
    ['30-08-13.nhaucuoinam.kidsDiThi', [2013, 8, 30]],
    ['Ki yeu - 30 - 5 -15', [2015, 5, 30]],
    // Month-Year (M-YYYY) - day pinned to 15
    ['dienthoai-06-2014', [2014, 6, 15]],
    ['bocapvang 1-2015', [2015, 1, 15]],
    ['triptrip 2-2015', [2015, 2, 15]],
    // Year only - day pinned to July 1
    ['tet 2019', [2019, 7, 1]],
    ['noel 2014', [2014, 7, 1]],
    ['anhTet-2013', [2013, 7, 1]],
    ['da banh liver 2012', [2012, 7, 1]],
    ['album vung tau', null],
    // Should NOT match
    ['art', null],
    ['Anh em be', null],
    ['New folder', null],
    ['Anh Lop  11A1', null],
    ['Lop 10', null],
    ['singapore - polaroid', null],
    ['phu & lan 28 - 01', null],
    ['', null]
  ];

  for (const [name, expected] of cases) {
    it(`parses ${JSON.stringify(name)}`, () => {
      const ts = parseFolderDate(name);
      if (expected === null) {
        expect(ts).toBeNull();
      } else {
        expect(ts).not.toBeNull();
        const got = new Date(ts!);
        expect([got.getFullYear(), got.getMonth() + 1, got.getDate()]).toEqual(expected);
      }
    });
  }

  it('falls back to MM-DD when DD-MM is invalid (e.g. 13-2-2013 = 2 Dec 2013)', () => {
    // 13 cannot be a month in DD-MM, so try MM-DD (Feb 13)
    const ts = parseFolderDate('13-2-2013');
    expect(ts).not.toBeNull();
    const d = new Date(ts!);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2013, 2, 13]);
  });
});
