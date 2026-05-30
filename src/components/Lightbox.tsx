import React, { useEffect, useState } from 'react';
import { useZoomPan } from '../hooks/useZoomPan';
import type { ImageRow, Album, ResolvedSource } from '../../electron/preload';
import { isVideoExt, photoUrl } from '../../electron/media';

interface Props {
  images: ImageRow[];
  index: number;
  albums: Album[];
  onClose: () => void;
  onNav: (newIndex: number) => void;
  onToggleFavorite: (row: ImageRow) => void;
  onSetDate: (row: ImageRow, ts: number | null) => void;
  onAddToAlbum: (row: ImageRow, albumId: number) => void;
}

const SOURCE_LABEL: Record<ResolvedSource, string> = {
  user: 'ngày tự đặt',
  filename: 'từ tên file',
  exif: 'EXIF',
  folder: 'từ tên thư mục',
  mtime: 'thời gian file'
};

function fmt(ts: number | null): string {
  if (ts === null || !Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** ts -> value string accepted by <input type="datetime-local"> (local time). */
function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function Lightbox({
  images,
  index,
  albums,
  onClose,
  onNav,
  onToggleFavorite,
  onSetDate,
  onAddToAlbum
}: Props) {
  const { containerRef, transform, isDragging, reset, zoomIn, zoomOut } = useZoomPan();
  const [debugOpen, setDebugOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);
  const row = images[index];
  const isVideo = row ? isVideoExt(row.ext) : false;

  useEffect(() => {
    reset();
    setDateOpen(false);
    setAlbumOpen(false);
  }, [index, reset]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing in the date editor.
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onNav(index - 1);
      else if (e.key === 'ArrowRight' && index < images.length - 1) onNav(index + 1);
      else if (e.key === '+' || e.key === '=') zoomIn();
      else if (e.key === '-' || e.key === '_') zoomOut();
      else if ((e.ctrlKey || e.metaKey) && e.key === '0') reset();
      else if (e.key === 'i' || e.key === 'I') setDebugOpen((v) => !v);
      else if ((e.key === 'f' || e.key === 'F') && row) onToggleFavorite(row);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onClose, onNav, zoomIn, zoomOut, reset, onToggleFavorite, row]);

  if (!row) return null;

  const date = new Date(row.resolved_taken_at);

  // Debug rows in resolver priority order. The "picked" column flags
  // which one resolveDate actually landed on so the user can see at a
  // glance why this file is at this point in the timeline.
  const debugRows: { label: ResolvedSource; ts: number | null }[] = [
    { label: 'user', ts: row.user_taken_at },
    { label: 'folder', ts: row.folder_taken_at },
    { label: 'exif', ts: row.exif_taken_at },
    { label: 'filename', ts: row.filename_taken_at },
    { label: 'mtime', ts: row.mtime }
  ];

  const handleShowInFolder = () => {
    window.api.shell.showInFolder(row.path);
  };

  return (
    <div className="lightbox" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lightbox-controls">
        <button
          onClick={() => onToggleFavorite(row)}
          title="Yêu thích (F)"
          className={row.favorite ? 'active' : ''}
        >
          {row.favorite ? '♥' : '♡'}
        </button>
        {!isVideo && (
          <>
            <button onClick={zoomOut} title="Zoom out (-)">−</button>
            <button onClick={reset} title="Reset (Ctrl+0)">⊙</button>
            <button onClick={zoomIn} title="Zoom in (+)">+</button>
          </>
        )}
        <button
          onClick={() => {
            setDateOpen((v) => !v);
            setAlbumOpen(false);
          }}
          title="Sửa ngày chụp"
          className={dateOpen ? 'active' : ''}
        >
          🕓
        </button>
        <button
          onClick={() => {
            setAlbumOpen((v) => !v);
            setDateOpen(false);
          }}
          title="Thêm vào album"
          className={albumOpen ? 'active' : ''}
        >
          ＋
        </button>
        <button onClick={handleShowInFolder} title="Mở trong thư mục" style={{ fontSize: 13 }}>
          ⤴
        </button>
        <button
          onClick={() => setDebugOpen((v) => !v)}
          title="Thông tin sort (I)"
          className={debugOpen ? 'active' : ''}
        >
          i
        </button>
        <button onClick={onClose} title="Đóng (Esc)">×</button>
      </div>

      {index > 0 && (
        <button className="lightbox-nav prev" onClick={() => onNav(index - 1)}>‹</button>
      )}
      {index < images.length - 1 && (
        <button className="lightbox-nav next" onClick={() => onNav(index + 1)}>›</button>
      )}

      {isVideo ? (
        <div className="lightbox-img-wrap">
          {/* key forces a fresh element (and reload) when navigating between videos */}
          <video key={row.id} className="lightbox-video" src={photoUrl(row.id)} controls autoPlay />
        </div>
      ) : (
        <div className={`lightbox-img-wrap ${isDragging ? 'dragging' : ''}`} ref={containerRef}>
          <img
            className="lightbox-img"
            src={photoUrl(row.id)}
            alt={row.filename}
            draggable={false}
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
            }}
          />
        </div>
      )}

      <div className="lightbox-info">
        <span className="lightbox-info-name" title={row.path}>{row.filename}</span>
        <span className="lightbox-info-sep">·</span>
        <span>{date.toLocaleString()}</span>
        <span className="lightbox-info-sep">·</span>
        <span>{SOURCE_LABEL[row.resolved_source]}</span>
        {row.ext === '.nef' && (
          <>
            <span className="lightbox-info-sep">·</span>
            <span>NEF preview</span>
          </>
        )}
      </div>

      {dateOpen && (
        <div className="lightbox-popover">
          <div className="lightbox-popover-title">Sửa ngày chụp</div>
          <input
            type="datetime-local"
            defaultValue={toLocalInput(row.resolved_taken_at)}
            step={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = (e.target as HTMLInputElement).value;
                if (v) {
                  onSetDate(row, new Date(v).getTime());
                  setDateOpen(false);
                }
              }
            }}
            id="date-override-input"
          />
          <div className="lightbox-popover-actions">
            <button
              onClick={() => {
                const el = document.getElementById('date-override-input') as HTMLInputElement | null;
                if (el?.value) {
                  onSetDate(row, new Date(el.value).getTime());
                  setDateOpen(false);
                }
              }}
            >
              Lưu
            </button>
            {row.user_taken_at !== null && (
              <button
                className="secondary"
                onClick={() => {
                  onSetDate(row, null);
                  setDateOpen(false);
                }}
              >
                Xoá ghi đè
              </button>
            )}
          </div>
        </div>
      )}

      {albumOpen && (
        <div className="lightbox-popover">
          <div className="lightbox-popover-title">Thêm vào album</div>
          {albums.length === 0 ? (
            <div className="lightbox-popover-empty">
              Chưa có album. Tạo album từ thanh chọn ảnh.
            </div>
          ) : (
            <div className="lightbox-album-list">
              {albums.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    onAddToAlbum(row, a.id);
                    setAlbumOpen(false);
                  }}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {debugOpen && (
        <div className="lightbox-debug">
          <div className="lightbox-debug-title">Sort debug</div>
          <div className="lightbox-debug-path" title={row.path}>{row.path}</div>
          <table>
            <tbody>
              {debugRows.map((r) => {
                const picked = row.resolved_source === r.label;
                return (
                  <tr key={r.label} className={picked ? 'picked' : ''}>
                    <td className="src">{r.label}</td>
                    <td className="val">{fmt(r.ts)}</td>
                    <td className="mark">{picked ? '← picked' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="lightbox-debug-rule">
            Quy tắc: <b>user</b> &gt; <b>folder</b> &gt; <b>exif</b> &gt; <b>filename</b> &gt; <b>mtime</b>.
            Khi không có folder, nếu filename cũ hơn EXIF &gt;1 ngày thì filename thắng.
          </div>
        </div>
      )}
    </div>
  );
}
