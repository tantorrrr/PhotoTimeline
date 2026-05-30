// Shared, dependency-free media helpers. Imported by the main process
// (scanner, protocols) and the renderer alike, so it must NOT pull in any
// electron/node-only APIs.

export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.nef']);
export const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm']);

/** Every extension the scanner will index. */
export const SUPPORTED_EXT = new Set<string>([...IMAGE_EXT, ...VIDEO_EXT]);

export function isVideoExt(ext: string): boolean {
  return VIDEO_EXT.has(ext.toLowerCase());
}

export function isRawExt(ext: string): boolean {
  return ext.toLowerCase() === '.nef';
}

/** Content-type for serving an image's raw bytes over the photo:// protocol. */
export function imageMime(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

export function videoMime(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.m4v':
      return 'video/x-m4v';
    default:
      return 'video/mp4';
  }
}
