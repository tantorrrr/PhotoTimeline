import { describe, it, expect } from 'vitest';
import { parseFilenameDate, resolveDate } from './metadata';

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
  const filenameSameAsExif = new Date('2024-06-01T00:00:00').getTime();

  it('prefers filename when filename is meaningfully older than EXIF (edited file scenario)', () => {
    const r = resolveDate(filenameOld, exifNew, mtime);
    expect(r.source).toBe('filename');
    expect(r.ts).toBe(filenameOld);
  });

  it('prefers EXIF when both agree (same day)', () => {
    const r = resolveDate(filenameSameAsExif, exifNew, mtime);
    expect(r.source).toBe('exif');
    expect(r.ts).toBe(exifNew);
  });

  it('uses EXIF when filename has no date', () => {
    const r = resolveDate(null, exifNew, mtime);
    expect(r.source).toBe('exif');
  });

  it('uses filename when EXIF missing', () => {
    const r = resolveDate(filenameOld, null, mtime);
    expect(r.source).toBe('filename');
  });

  it('falls back to mtime when both missing', () => {
    const r = resolveDate(null, null, mtime);
    expect(r.source).toBe('mtime');
    expect(r.ts).toBe(mtime);
  });
});
