import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { normalizePath, pathEquals, isAncestor } from './pathUtil';

const isWin = process.platform === 'win32';

describe('normalizePath', () => {
  it('strips trailing separator', () => {
    const p = isWin ? 'C:\\Photos\\' : '/photos/';
    const expected = isWin ? 'C:\\Photos' : '/photos';
    expect(normalizePath(p)).toBe(expected);
  });

  it('preserves root separator', () => {
    if (isWin) {
      expect(normalizePath('C:\\').toUpperCase()).toMatch(/^C:\\/);
    } else {
      expect(normalizePath('/')).toBe('/');
    }
  });

  it('unifies separators', () => {
    if (isWin) {
      expect(normalizePath('C:/Photos/2023')).toBe('C:\\Photos\\2023');
    }
  });
});

describe('pathEquals', () => {
  it('case-insensitive on Windows, sensitive elsewhere', () => {
    if (isWin) {
      expect(pathEquals('C:\\Photos', 'c:\\photos')).toBe(true);
    } else {
      expect(pathEquals('/Photos', '/photos')).toBe(false);
    }
  });

  it('exact equal', () => {
    expect(pathEquals('/a/b', '/a/b')).toBe(true);
  });
});

describe('isAncestor', () => {
  it('parent is ancestor of child', () => {
    const parent = isWin ? 'C:\\Photos' : '/photos';
    const child = isWin ? 'C:\\Photos\\2023' : '/photos/2023';
    expect(isAncestor(parent, child)).toBe(true);
  });

  it('equal is not ancestor', () => {
    expect(isAncestor('/a/b', '/a/b')).toBe(false);
  });

  it('sibling is not ancestor', () => {
    const a = isWin ? 'C:\\Photos' : '/photos';
    const b = isWin ? 'C:\\Photos2' : '/photos2';
    // critical: prefix match without separator must not count
    expect(isAncestor(a, b)).toBe(false);
  });

  it('descendant several levels deep', () => {
    const parent = isWin ? 'C:\\A' : '/a';
    const child = isWin ? 'C:\\A\\B\\C\\D' : '/a/b/c/d';
    expect(isAncestor(parent, child)).toBe(true);
  });

  it('case-insensitive on Windows', () => {
    if (isWin) {
      expect(isAncestor('C:\\Photos', 'c:\\photos\\2023')).toBe(true);
    }
  });

  it('child cannot be ancestor of parent', () => {
    const parent = isWin ? 'C:\\Photos' : '/photos';
    const child = isWin ? 'C:\\Photos\\2023' : '/photos/2023';
    expect(isAncestor(child, parent)).toBe(false);
  });
});
