import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ImageRow } from '../../electron/preload';

interface Props {
  images: ImageRow[];
  onOpen: (index: number) => void;
}

interface DayGroup {
  dayKey: string; // YYYY-MM-DD
  monthKey: string; // YYYY-MM
  date: Date;
  // images are stored as {row, originalIndex} so click maps back to flat list
  items: { row: ImageRow; idx: number }[];
}

const VI_DAY = ['CN', 'Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7'];
const VI_MONTH = (d: Date) => `Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;

function groupByDay(images: ImageRow[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  images.forEach((row, idx) => {
    const d = new Date(row.resolved_taken_at);
    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const monthKey = dayKey.slice(0, 7);
    let g = map.get(dayKey);
    if (!g) {
      g = { dayKey, monthKey, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), items: [] };
      map.set(dayKey, g);
    }
    g.items.push({ row, idx });
  });
  return Array.from(map.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
}

function formatDayHeader(date: Date) {
  return `${VI_DAY[date.getDay()]}, ${date.getDate()} tháng ${date.getMonth() + 1}, ${date.getFullYear()}`;
}

export function TimelineGrid({ images, onOpen }: Props) {
  const groups = useMemo(() => groupByDay(images), [images]);
  const parentRef = useRef<HTMLDivElement>(null);
  const [stickyMonth, setStickyMonth] = useState<string | null>(null);

  // Estimate row height per group: header (28) + grid rows. Assume 6 columns @ 160px + 4px gap.
  const estimateSize = (i: number) => {
    const g = groups[i];
    const cols = 6;
    const rows = Math.ceil(g.items.length / cols);
    return 28 + rows * 164 + 24; // header + grid + bottom margin
  };

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 4
  });

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const onScroll = () => {
      const items = virtualizer.getVirtualItems();
      if (items.length === 0) return;
      const top = items[0];
      const g = groups[top.index];
      if (g) setStickyMonth(g.monthKey);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [virtualizer, groups]);

  const stickyDate = stickyMonth ? new Date(`${stickyMonth}-01T00:00:00`) : null;

  return (
    <div className="timeline" ref={parentRef}>
      {stickyDate && <div className="sticky-month">{VI_MONTH(stickyDate)}</div>}
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative'
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const g = groups[virtualRow.index];
          return (
            <div
              key={g.dayKey}
              className="day-section"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`
              }}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
            >
              <div className="day-header">{formatDayHeader(g.date)}</div>
              <div className="thumb-grid">
                {g.items.map(({ row, idx }) => (
                  <div key={row.id} className="thumb" onClick={() => onOpen(idx)}>
                    {row.thumb_status === 'ready' ? (
                      <img src={`thumb://${row.id}`} loading="lazy" alt={row.filename} />
                    ) : (
                      <div style={{ color: '#444', display: 'grid', placeItems: 'center', height: '100%', fontSize: 10 }}>
                        {row.thumb_status === 'error' ? '!' : '...'}
                      </div>
                    )}
                    {row.ext === '.nef' && <span className="badge">RAW</span>}
                    {row.resolved_source === 'filename' && <span className="badge" style={{ left: 4, right: 'auto', background: 'rgba(70,130,180,0.7)' }}>N</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
