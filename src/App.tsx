import React, { useEffect, useState, useCallback } from 'react';
import { TimelineGrid } from './components/TimelineGrid';
import { FolderManager } from './components/FolderManager';
import { Lightbox } from './components/Lightbox';
import type { ImageRow, ScanProgress, FolderListItem } from '../electron/preload';

export function App() {
  const [folders, setFolders] = useState<FolderListItem[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const refreshFolders = useCallback(async () => {
    const list = await window.api.folders.list();
    setFolders(list);
  }, []);

  const refreshImages = useCallback(async () => {
    const count = await window.api.images.count();
    if (count === 0) {
      setImages([]);
      return;
    }
    // Load all rows (paged in 1000-row chunks).
    const all: ImageRow[] = [];
    const PAGE = 1000;
    for (let off = 0; off < count; off += PAGE) {
      const page = await window.api.images.page(off, PAGE);
      all.push(...page);
      if (page.length < PAGE) break;
    }
    setImages(all);
  }, []);

  useEffect(() => {
    refreshFolders();
    refreshImages();
  }, [refreshFolders, refreshImages, reloadKey]);

  useEffect(() => {
    const off = window.api.onScanProgress((p) => {
      setProgress(p);
      if (p.phase === 'done' || p.phase === 'error') {
        setTimeout(() => setProgress(null), 2000);
        setReloadKey((k) => k + 1);
      }
      if (p.phase === 'thumbnailing' && p.scanned > 0 && p.scanned % 100 === 0) {
        setReloadKey((k) => k + 1);
      }
    });
    return off;
  }, []);

  const handleAdd = async () => {
    const r = await window.api.folders.pickAndAdd();
    if (r.length > 0) {
      await refreshFolders();
    }
  };

  const handleRemove = async (id: number) => {
    await window.api.folders.remove(id);
    setReloadKey((k) => k + 1);
  };

  const handleRescan = async (id: number) => {
    await window.api.folders.rescan(id);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const paths: string[] = [];
    for (const item of Array.from(e.dataTransfer.files)) {
      const p = window.api.pathForDroppedFile(item);
      if (p) paths.push(p);
    }
    if (paths.length === 0) return;
    const r = await window.api.folders.addPaths(paths);
    if (r.length > 0) await refreshFolders();
  };

  const progressLabel = progress
    ? progress.phase === 'walking'
      ? 'Đang quét thư mục...'
      : progress.phase === 'indexing'
        ? `Đang đọc metadata ${progress.scanned}/${progress.total}`
        : progress.phase === 'thumbnailing'
          ? `Tạo thumbnail ${progress.scanned}/${progress.total}`
          : progress.phase === 'done'
            ? 'Hoàn tất'
            : 'Lỗi'
    : null;

  return (
    <div
      className={`app ${dragOver ? 'drag-over' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <div className="topbar">
        <h1>Photo Timeline</h1>
        <div className="spacer" />
        {progressLabel && <span className="progress">{progressLabel}</span>}
        <button onClick={handleAdd} title="Thêm 1 thư mục qua hộp thoại. Để thêm nhiều thư mục cùng lúc: kéo-thả các thư mục vào cửa sổ.">+ Thêm thư mục</button>
        <button onClick={() => setPanelOpen((o) => !o)}>
          {panelOpen ? 'Đóng' : `Thư mục (${folders.length})`}
        </button>
      </div>
      <div className="main">
        {images.length === 0 ? (
          <div className="empty">
            <div>Chưa có ảnh nào.</div>
            <div style={{ fontSize: 12, color: '#777' }}>
              Bấm nút bên trên hoặc <b>kéo-thả nhiều thư mục</b> vào đây.
            </div>
            <button onClick={handleAdd}>+ Thêm thư mục đầu tiên</button>
          </div>
        ) : (
          <TimelineGrid images={images} onOpen={(idx) => setLightboxIdx(idx)} />
        )}

        <FolderManager
          open={panelOpen}
          folders={folders}
          onRemove={handleRemove}
          onRescan={handleRescan}
        />

        {lightboxIdx !== null && (
          <Lightbox
            images={images}
            index={lightboxIdx}
            onClose={() => setLightboxIdx(null)}
            onNav={(i) => setLightboxIdx(i)}
          />
        )}
      </div>
    </div>
  );
}
