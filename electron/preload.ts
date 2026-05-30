import { contextBridge, ipcRenderer, webUtils } from 'electron';

export type FolderListItem = {
  id: number;
  path: string;
  added_at: number;
  last_scan_at: number | null;
  image_count: number;
};

export type ResolvedSource = 'user' | 'filename' | 'exif' | 'folder' | 'mtime';

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
  folder_taken_at: number | null;
  user_taken_at: number | null;
  resolved_taken_at: number;
  resolved_source: ResolvedSource;
  width: number | null;
  height: number | null;
  thumb_status: 'pending' | 'ready' | 'error';
  favorite: number;
  phash: string | null;
};

export type Album = {
  id: number;
  name: string;
  created_at: number;
  image_count?: number;
};

export type DuplicateGroup = {
  phash: string;
  images: ImageRow[];
};

export type ScanProgress = {
  folderId: number;
  phase: 'walking' | 'indexing' | 'thumbnailing' | 'done' | 'error';
  scanned: number;
  total: number;
  message?: string;
};

export type AddFolderStatus = 'added' | 'duplicate' | 'absorbed' | 'subsumed';

export type AddFolderResult = {
  id: number;
  status: AddFolderStatus;
  path: string;
  subsumedPaths?: string[];
};

const api = {
  folders: {
    list: (): Promise<FolderListItem[]> => ipcRenderer.invoke('folders:list'),
    pickAndAdd: (): Promise<AddFolderResult[]> =>
      ipcRenderer.invoke('folders:pickAndAdd'),
    addPaths: (paths: string[]): Promise<AddFolderResult[]> =>
      ipcRenderer.invoke('folders:addPaths', paths),
    remove: (id: number): Promise<boolean> => ipcRenderer.invoke('folders:remove', id),
    rescan: (id: number): Promise<boolean> => ipcRenderer.invoke('folders:rescan', id)
  },
  pathForDroppedFile: (file: File): string => webUtils.getPathForFile(file),
  shell: {
    showInFolder: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke('shell:showInFolder', filePath)
  },
  images: {
    page: (offset: number, limit: number): Promise<ImageRow[]> =>
      ipcRenderer.invoke('images:page', { offset, limit }),
    count: (): Promise<number> => ipcRenderer.invoke('images:count'),
    get: (id: number): Promise<ImageRow | undefined> => ipcRenderer.invoke('images:get', id),
    setFavorite: (id: number, favorite: boolean): Promise<boolean> =>
      ipcRenderer.invoke('images:setFavorite', id, favorite),
    setDate: (id: number, ts: number | null): Promise<ImageRow | null> =>
      ipcRenderer.invoke('images:setDate', id, ts),
    findDuplicates: (): Promise<DuplicateGroup[]> => ipcRenderer.invoke('images:findDuplicates'),
    trash: (ids: number[]): Promise<{ trashed: number; failed: number[] }> =>
      ipcRenderer.invoke('images:trash', ids),
    exportTo: (ids: number[]): Promise<{ copied: number; dest: string | null }> =>
      ipcRenderer.invoke('images:exportTo', ids)
  },
  albums: {
    list: (): Promise<Album[]> => ipcRenderer.invoke('albums:list'),
    create: (name: string): Promise<Album> => ipcRenderer.invoke('albums:create', name),
    remove: (id: number): Promise<boolean> => ipcRenderer.invoke('albums:remove', id),
    addImages: (albumId: number, imageIds: number[]): Promise<boolean> =>
      ipcRenderer.invoke('albums:addImages', albumId, imageIds),
    removeImage: (albumId: number, imageId: number): Promise<boolean> =>
      ipcRenderer.invoke('albums:removeImage', albumId, imageId),
    imageIds: (albumId: number): Promise<number[]> =>
      ipcRenderer.invoke('albums:imageIds', albumId)
  },
  onScanProgress: (cb: (p: ScanProgress) => void) => {
    const listener = (_e: unknown, p: ScanProgress) => cb(p);
    ipcRenderer.on('scan:progress', listener);
    return () => ipcRenderer.off('scan:progress', listener);
  }
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
