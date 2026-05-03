import React, { useEffect } from 'react';
import { useZoomPan } from '../hooks/useZoomPan';
import type { ImageRow } from '../../electron/preload';

interface Props {
  images: ImageRow[];
  index: number;
  onClose: () => void;
  onNav: (newIndex: number) => void;
}

export function Lightbox({ images, index, onClose, onNav }: Props) {
  const { containerRef, transform, isDragging, reset, zoomIn, zoomOut } = useZoomPan();
  const row = images[index];

  // Reset zoom on image change
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onClose, onNav, zoomIn, zoomOut, reset]);

  if (!row) return null;

  const date = new Date(row.resolved_taken_at);
  const sourceLabel = {
    filename: 'từ tên file',
    exif: 'EXIF',
    folder: 'từ tên thư mục',
    mtime: 'thời gian file'
  }[row.resolved_source];

  return (
    <div className="lightbox" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lightbox-controls">
        <button onClick={zoomOut} title="Zoom out (-)">−</button>
        <button onClick={reset} title="Reset (Ctrl+0)">⊙</button>
        <button onClick={zoomIn} title="Zoom in (+)">+</button>
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
        {row.filename} · {date.toLocaleString()} · {sourceLabel}
        {row.ext === '.nef' && ' · NEF preview'}
      </div>
    </div>
  );
}
