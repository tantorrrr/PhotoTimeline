import path from 'node:path';

const isWin = process.platform === 'win32';

/**
 * Canonical form for a folder/image path:
 *  - resolve to absolute
 *  - strip trailing separator (except root like "C:\" or "/")
 *  - normalize separators to the platform default
 *
 * On Windows callers must still compare with `pathEquals` because the
 * filesystem is case-insensitive but the original casing should be
 * preserved for display.
 */
export function normalizePath(p: string): string {
  let r = path.resolve(p);
  // path.resolve already normalizes separators on Windows, but be defensive
  r = r.replace(/[\\/]+/g, path.sep);
  // strip trailing separator unless it's a root (length <= 3 covers "C:\" and "/")
  if (r.length > 3 && r.endsWith(path.sep)) r = r.slice(0, -1);
  return r;
}

export function pathEquals(a: string, b: string): boolean {
  return isWin ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** True iff `child` is strictly inside `parent` (not equal). */
export function isAncestor(parent: string, child: string): boolean {
  if (pathEquals(parent, child)) return false;
  const p = isWin ? parent.toLowerCase() : parent;
  const c = isWin ? child.toLowerCase() : child;
  const prefix = p.endsWith(path.sep) ? p : p + path.sep;
  return c.startsWith(prefix);
}
