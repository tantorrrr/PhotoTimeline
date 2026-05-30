import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { TimelineGrid } from './components/TimelineGrid';
import { FolderManager } from './components/FolderManager';
import { Lightbox } from './components/Lightbox';
import { FilterBar, FilterState } from './components/FilterBar';
import { SelectionBar } from './components/SelectionBar';
import { OnThisDay } from './components/OnThisDay';
import { DuplicatesView } from './components/DuplicatesView';
import type {
  ImageRow,
  ScanProgress,
  FolderListItem,
  AddFolderResult,
  Album
} from '../electron/preload';
import { isVideoExt } from '../electron/media';

function summarizeAdd(results: AddFolderResult[]): string | null {
  if (results.length === 0) return null;
  const parts: string[] = [];
  const added = results.filter((r) => r.status === 'added');
  const dup = results.filter((r) => r.status === 'duplicate');
  const absorbed = results.filter((r) => r.status === 'absorbed');
  const subsumed = results.filter((r) => r.status === 'subsumed');
  if (added.length) parts.push(`${added.length} thư mục đã thêm`);
  if (subsumed.length) {
    const total = subsumed.reduce((n, r) => n + (r.subsumedPaths?.length ?? 0), 0);
    parts.push(`${subsumed.length} thư mục cha thay thế ${total} thư mục con đã import`);
  }
  if (dup.length) parts.push(`${dup.length} đã tồn tại (bỏ qua)`);
  if (absorbed.length) parts.push(`${absorbed.length} nằm trong thư mục đã import (bỏ qua)`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

const EMPTY_FILTER: FilterState = { text: '', type: 'all', favOnly: false, albumId: null };

export function App() {
  const [folders, setFolders] = useState<FolderListItem[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [lightbox, setLightbox] = useState<{ ids: number[]; index: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [albumMemberIds, setAlbumMemberIds] = useState<number[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dupOpen, setDupOpen] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  }, []);

  const refreshFolders = useCallback(async () => {
    setFolders(await window.api.folders.list());
  }, []);

  const refreshAlbums = useCallback(async () => {
    setAlbums(await window.api.albums.list());
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
    refreshAlbums();
    refreshImages();
  }, [refreshFolders, refreshAlbums, refreshImages, reloadKey]);

  // Fetch album membership whenever the active album filter changes.
  useEffect(() => {
    if (filter.albumId === null) {
      setAlbumMemberIds(null);
      return;
    }
    let cancelled = false;
    window.api.albums.imageIds(filter.albumId).then((ids) => {
      if (!cancelled) setAlbumMemberIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [filter.albumId, reloadKey]);

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
    return () => {
      off();
    };
  }, []);

  const byId = useMemo(() => new Map(images.map((r) => [r.id, r])), [images]);

  const filtered = useMemo(() => {
    const q = filter.text.trim().toLowerCase();
    const albumSet =
      filter.albumId !== null && albumMemberIds ? new Set(albumMemberIds) : null;
    return images.filter((r) => {
      if (q && !r.filename.toLowerCase().includes(q) && !r.path.toLowerCase().includes(q))
        return false;
      if (filter.favOnly && !r.favorite) return false;
      if (filter.type === 'video' && !isVideoExt(r.ext)) return false;
      if (filter.type === 'raw' && r.ext !== '.nef') return false;
      if (filter.type === 'photo' && isVideoExt(r.ext)) return false;
      if (albumSet && !albumSet.has(r.id)) return false;
      return true;
    });
  }, [images, filter, albumMemberIds]);

  const patchImage = useCallback((id: number, partial: Partial<ImageRow>) => {
    setImages((prev) => prev.map((r) => (r.id === id ? { ...r, ...partial } : r)));
  }, []);

  // --- lightbox helpers ---
  const openLightbox = useCallback((list: ImageRow[], index: number) => {
    setLightbox({ ids: list.map((r) => r.id), index });
  }, []);
  const lightboxImages = useMemo(
    () => (lightbox ? (lightbox.ids.map((id) => byId.get(id)).filter(Boolean) as ImageRow[]) : []),
    [lightbox, byId]
  );

  // --- selection ---
  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // --- folder handlers ---
  const handleAdd = async () => {
    const r = await window.api.folders.pickAndAdd();
    if (r.length > 0) await refreshFolders();
    const msg = summarizeAdd(r);
    if (msg) showToast(msg);
  };
  const handleRemove = async (id: number) => {
    await window.api.folders.remove(id);
    setReloadKey((k) => k + 1);
  };
  const handleRescan = async (id: number) => {
    await window.api.folders.rescan(id);
  };
  const handleRemoveAlbum = async (id: number) => {
    await window.api.albums.remove(id);
    if (filter.albumId === id) setFilter({ ...filter, albumId: null });
    await refreshAlbums();
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
    const msg = summarizeAdd(r);
    if (msg) showToast(msg);
  };

  // --- per-image actions ---
  const handleToggleFavorite = useCallback(
    async (row: ImageRow) => {
      const fav = !row.favorite;
      await window.api.images.setFavorite(row.id, fav);
      patchImage(row.id, { favorite: fav ? 1 : 0 });
    },
    [patchImage]
  );
  const handleSetDate = useCallback(
    async (row: ImageRow, ts: number | null) => {
      const updated = await window.api.images.setDate(row.id, ts);
      if (updated) patchImage(row.id, updated);
    },
    [patchImage]
  );
  const handleAddToAlbum = useCallback(
    async (row: ImageRow, albumId: number) => {
      await window.api.albums.addImages(albumId, [row.id]);
      await refreshAlbums();
      showToast('Đã thêm vào album');
    },
    [refreshAlbums, showToast]
  );

  // --- batch actions ---
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const handleBatchFavorite = useCallback(
    async (fav: boolean) => {
      await Promise.all(selectedIds.map((id) => window.api.images.setFavorite(id, fav)));
      selectedIds.forEach((id) => patchImage(id, { favorite: fav ? 1 : 0 }));
      showToast(`${selectedIds.length} ảnh ${fav ? 'đã yêu thích' : 'bỏ yêu thích'}`);
    },
    [selectedIds, patchImage, showToast]
  );
  const handleBatchExport = useCallback(async () => {
    const r = await window.api.images.exportTo(selectedIds);
    if (r.dest) showToast(`Đã sao chép ${r.copied} tệp`);
  }, [selectedIds, showToast]);
  const handleBatchTrash = useCallback(async () => {
    const ok = window.confirm(
      `Chuyển ${selectedIds.length} tệp vào thùng rác? (có thể khôi phục từ Recycle Bin)`
    );
    if (!ok) return;
    const r = await window.api.images.trash(selectedIds);
    clearSelection();
    setLightbox(null);
    setReloadKey((k) => k + 1);
    showToast(`Đã chuyển ${r.trashed} tệp vào thùng rác`);
  }, [selectedIds, clearSelection, showToast]);
  const handleAddSelectedToAlbum = useCallback(
    async (albumId: number) => {
      await window.api.albums.addImages(albumId, selectedIds);
      await refreshAlbums();
      showToast(`Đã thêm ${selectedIds.length} ảnh vào album`);
    },
    [selectedIds, refreshAlbums, showToast]
  );
  const handleCreateAlbumAndAdd = useCallback(
    async (name: string) => {
      const a = await window.api.albums.create(name);
      await window.api.albums.addImages(a.id, selectedIds);
      await refreshAlbums();
      showToast(`Đã tạo album "${name}" với ${selectedIds.length} ảnh`);
    },
    [selectedIds, refreshAlbums, showToast]
  );

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

      {images.length > 0 && (
        <FilterBar
          filter={filter}
          setFilter={setFilter}
          albums={albums}
          shown={filtered.length}
          total={images.length}
          onOpenDuplicates={() => setDupOpen(true)}
        />
      )}

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
          <>
            {filter.albumId === null && !filter.favOnly && (
              <OnThisDay images={images} onOpen={openLightbox} />
            )}
            {filtered.length === 0 ? (
              <div className="empty">Không có mục nào khớp bộ lọc.</div>
            ) : (
              <TimelineGrid
                images={filtered}
                onOpen={(idx) => openLightbox(filtered, idx)}
                selected={selected}
                onToggleSelect={toggleSelect}
                selectionMode={selected.size > 0}
              />
            )}
          </>
        )}

        <FolderManager
          open={panelOpen}
          folders={folders}
          albums={albums}
          onRemove={handleRemove}
          onRescan={handleRescan}
          onRemoveAlbum={handleRemoveAlbum}
        />

        {lightbox && lightboxImages.length > 0 && (
          <Lightbox
            images={lightboxImages}
            index={Math.min(lightbox.index, lightboxImages.length - 1)}
            albums={albums}
            onClose={() => setLightbox(null)}
            onNav={(i) => setLightbox((lb) => (lb ? { ...lb, index: i } : lb))}
            onToggleFavorite={handleToggleFavorite}
            onSetDate={handleSetDate}
            onAddToAlbum={handleAddToAlbum}
          />
        )}

        {selected.size > 0 && (
          <SelectionBar
            count={selected.size}
            albums={albums}
            onClear={clearSelection}
            onFavorite={handleBatchFavorite}
            onExport={handleBatchExport}
            onTrash={handleBatchTrash}
            onAddToAlbum={handleAddSelectedToAlbum}
            onCreateAlbumAndAdd={handleCreateAlbumAndAdd}
          />
        )}

        {dupOpen && (
          <DuplicatesView
            onClose={() => setDupOpen(false)}
            onChanged={() => setReloadKey((k) => k + 1)}
            onOpen={openLightbox}
          />
        )}

        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  );
}
