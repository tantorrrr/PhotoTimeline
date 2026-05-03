import { contextBridge, ipcRenderer, webUtils } from 'electron';

export type FolderListItem = {
  id: number;
  path: string;
  added_at: number;
  last_scan_at: number | null;
  image_count: number;
};

export type ImageRow = {
  id: number;
  folder_id: number;
  path: string;
  filename: string;
  ext: string;
  size: number | null;
  mtime: number | null;
  exif_taken_at: number | null;
  filename_taken_at: number | null;
  resolved_taken_at: number;
  resolved_source: 'filename' | 'exif' | 'mtime';
  width: number | null;
  height: number | null;
  thumb_status: 'pending' | 'ready' | 'error';
};

export type ScanProgress = {
  folderId: number;
  phase: 'walking' | 'indexing' | 'thumbnailing' | 'done' | 'error';
  scanned: number;
  total: number;
  message?: string;
};

const api = {
  folders: {
    list: (): Promise<FolderListItem[]> => ipcRenderer.invoke('folders:list'),
    pickAndAdd: (): Promise<{ id: number; path: string }[]> =>
      ipcRenderer.invoke('folders:pickAndAdd'),
    addPaths: (paths: string[]): Promise<{ id: number; path: string }[]> =>
      ipcRenderer.invoke('folders:addPaths', paths),
    remove: (id: number): Promise<boolean> => ipcRenderer.invoke('folders:remove', id),
    rescan: (id: number): Promise<boolean> => ipcRenderer.invoke('folders:rescan', id)
  },
  pathForDroppedFile: (file: File): string => webUtils.getPathForFile(file),
  images: {
    page: (offset: number, limit: number): Promise<ImageRow[]> =>
      ipcRenderer.invoke('images:page', { offset, limit }),
    count: (): Promise<number> => ipcRenderer.invoke('images:count'),
    get: (id: number): Promise<ImageRow | undefined> => ipcRenderer.invoke('images:get', id)
  },
  onScanProgress: (cb: (p: ScanProgress) => void) => {
    const listener = (_e: unknown, p: ScanProgress) => cb(p);
    ipcRenderer.on('scan:progress', listener);
    return () => ipcRenderer.off('scan:progress', listener);
  }
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
