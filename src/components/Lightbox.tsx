import React, { useEffect, useState } from 'react';
import { useZoomPan } from '../hooks/useZoomPan';
import type { ImageRow } from '../../electron/preload';

interface Props {
  images: ImageRow[];
  index: number;
  onClose: () => void;
  onNav: (newIndex: number) => void;
}

const SOURCE_LABEL: Record<ImageRow['resolved_source'], string> = {
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

export function Lightbox({ images, index, onClose, onNav }: Props) {
  const { containerRef, transform, isDragging, reset, zoomIn, zoomOut } = useZoomPan();
  const [debugOpen, setDebugOpen] = useState(false);
  const row = images[index];

  useEffect(() => {
    reset();
  }, [index, reset]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onNav(index - 1);
      else if (e.key === 'ArrowRight' && index < images.length - 1) onNav(index + 1);
      else if (e.key === '+' || e.key === '=') zoomIn();
      else if (e.key === '-' || e.key === '_') zoomOut();
      else if ((e.ctrlKey || e.metaKey) && e.key === '0') reset();
      else if (e.key === 'i' || e.key === 'I') setDebugOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onClose, onNav, zoomIn, zoomOut, reset]);

  if (!row) return null;

  const date = new Date(row.resolved_taken_at);

  // Debug rows in resolver priority order. The "picked" column flags
  // which one resolveDate actually landed on so the user can see at a
  // glance why this file is at this point in the timeline.
  const debugRows: { label: ImageRow['resolved_source']; ts: number | null }[] = [
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
        <button onClick={zoomOut} title="Zoom out (-)">−</button>
        <button onClick={reset} title="Reset (Ctrl+0)">⊙</button>
        <button onClick={zoomIn} title="Zoom in (+)">+</button>
        <button
          onClick={handleShowInFolder}
          title="Mở trong thư mục"
          style={{ fontSize: 13 }}
        >
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

      <div
        className={`lightbox-img-wrap ${isDragging ? 'dragging' : ''}`}
        ref={containerRef}
      >
        <img
          className="lightbox-img"
          src={`photo://${row.id}`}
          alt={row.filename}
          draggable={false}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
          }}
        />
      </div>

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
            Quy tắc: <b>folder</b> &gt; <b>exif</b> &gt; <b>filename</b> &gt; <b>mtime</b>.
            Khi không có folder, nếu filename cũ hơn EXIF &gt;1 ngày thì filename thắng.
          </div>
        </div>
      )}
    </div>
  );
}
