import React, { useMemo } from 'react';
import type { ImageRow } from '../../electron/preload';
import { isVideoExt, thumbUrl } from '../../electron/media';

interface Props {
  images: ImageRow[];
  onOpen: (list: ImageRow[], index: number) => void;
}

/**
 * "Ngày này năm xưa" - photos whose resolved date falls on today's
 * month/day in any previous year. Surfaced as a dismissible strip above the
 * timeline; hidden entirely when there are no matches.
 */
export function OnThisDay({ images, onOpen }: Props) {
  const matches = useMemo(() => {
    const now = new Date();
    const m = now.getMonth();
    const d = now.getDate();
    const y = now.getFullYear();
    return images
      .filter((row) => {
        const t = new Date(row.resolved_taken_at);
        return t.getMonth() === m && t.getDate() === d && t.getFullYear() < y;
      })
      .sort((a, b) => b.resolved_taken_at - a.resolved_taken_at);
  }, [images]);

  if (matches.length === 0) return null;

  return (
    <div className="onthisday">
      <div className="onthisday-head">
        <span className="onthisday-title">Ngày này năm xưa</span>
        <span className="onthisday-sub">{matches.length} ảnh</span>
      </div>
      <div className="onthisday-strip">
        {matches.slice(0, 30).map((row, i) => {
          const year = new Date(row.resolved_taken_at).getFullYear();
          return (
            <div key={row.id} className="onthisday-cell" onClick={() => onOpen(matches, i)}>
              {isVideoExt(row.ext) ? (
                <div className="thumb-video small">
                  <span className="play-icon">▶</span>
                </div>
              ) : row.thumb_status === 'ready' ? (
                <img src={thumbUrl(row.id)} loading="lazy" alt={row.filename} />
              ) : (
                <div className="thumb-placeholder">…</div>
              )}
              <span className="onthisday-year">{year}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
