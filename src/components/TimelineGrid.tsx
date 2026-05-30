import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ImageRow } from '../../electron/preload';
import { isVideoExt, thumbUrl } from '../../electron/media';

interface Props {
  images: ImageRow[];
  onOpen: (index: number) => void;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  /** When a selection exists, a plain click extends it instead of opening. */
  selectionMode: boolean;
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

/** Renders a single image/video cell. */
function Thumb({
  row,
  selected,
  selectionMode,
  onOpen,
  onToggleSelect
}: {
  row: ImageRow;
  selected: boolean;
  selectionMode: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
}) {
  const isVideo = isVideoExt(row.ext);
  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || selectionMode) {
      onToggleSelect();
    } else {
      onOpen();
    }
  };
  return (
    <div className={`thumb ${selected ? 'selected' : ''}`} onClick={handleClick}>
      {isVideo ? (
        <div className="thumb-video">
          <span className="thumb-video-name">{row.filename}</span>
          <span className="play-icon">▶</span>
        </div>
      ) : row.thumb_status === 'ready' ? (
        <img src={thumbUrl(row.id)} loading="lazy" alt={row.filename} />
      ) : (
        <div className="thumb-placeholder">{row.thumb_status === 'error' ? '!' : '...'}</div>
      )}

      <span
        className={`select-dot ${selected ? 'on' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        title={selected ? 'Bỏ chọn' : 'Chọn'}
      >
        {selected ? '✓' : ''}
      </span>

      {row.favorite ? <span className="badge fav-badge">♥</span> : null}
      {isVideo && <span className="badge">VIDEO</span>}
      {row.ext === '.nef' && <span className="badge">RAW</span>}
      {row.resolved_source === 'filename' && (
        <span className="badge src-badge" style={{ left: 4, right: 'auto' }}>N</span>
      )}
      {row.resolved_source === 'user' && (
        <span className="badge src-badge" style={{ left: 4, right: 'auto' }}>✎</span>
      )}
    </div>
  );
}

/**
 * Vertical date scrubber pinned to the right edge. Years are labelled at the
 * fractional position of their first photo; clicking/dragging the track jumps
 * the timeline to the corresponding day group. A live thumb mirrors the
 * current scroll position.
 */
function Scrubber({
  groups,
  topIndex,
  onJump
}: {
  groups: DayGroup[];
  topIndex: number;
  onJump: (index: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [bubble, setBubble] = useState<{ y: number; label: string } | null>(null);
  const dragging = useRef(false);

  const yearMarks = useMemo(() => {
    const marks: { year: number; frac: number }[] = [];
    let lastYear: number | null = null;
    groups.forEach((g, i) => {
      const y = g.date.getFullYear();
      if (y !== lastYear) {
        marks.push({ year: y, frac: groups.length <= 1 ? 0 : i / (groups.length - 1) });
        lastYear = y;
      }
    });
    return marks;
  }, [groups]);

  const indexFromEvent = useCallback(
    (clientY: number): number => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      return Math.round(frac * (groups.length - 1));
    },
    [groups.length]
  );

  const apply = useCallback(
    (clientY: number) => {
      const idx = indexFromEvent(clientY);
      const g = groups[idx];
      if (!g) return;
      onJump(idx);
      const el = trackRef.current;
      const rect = el?.getBoundingClientRect();
      setBubble({ y: rect ? clientY - rect.top : 0, label: VI_MONTH(g.date) });
    },
    [groups, indexFromEvent, onJump]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) apply(e.clientY);
    };
    const onUp = () => {
      dragging.current = false;
      setBubble(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [apply]);

  if (groups.length < 2) return null;
  const thumbFrac = topIndex / (groups.length - 1);

  return (
    <div
      className="scrubber"
      ref={trackRef}
      onMouseDown={(e) => {
        dragging.current = true;
        apply(e.clientY);
      }}
    >
      {yearMarks.map((m) => (
        <span key={m.year} className="scrubber-year" style={{ top: `${m.frac * 100}%` }}>
          {m.year}
        </span>
      ))}
      <span className="scrubber-thumb" style={{ top: `${thumbFrac * 100}%` }} />
      {bubble && (
        <span className="scrubber-bubble" style={{ top: bubble.y }}>
          {bubble.label}
        </span>
      )}
    </div>
  );
}

export function TimelineGrid({ images, onOpen, selected, onToggleSelect, selectionMode }: Props) {
  const groups = useMemo(() => groupByDay(images), [images]);
  const parentRef = useRef<HTMLDivElement>(null);
  const [stickyMonth, setStickyMonth] = useState<string | null>(null);
  const [topIndex, setTopIndex] = useState(0);

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
      setTopIndex(top.index);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [virtualizer, groups]);

  const handleJump = useCallback(
    (index: number) => virtualizer.scrollToIndex(index, { align: 'start' }),
    [virtualizer]
  );

  const stickyDate = stickyMonth ? new Date(`${stickyMonth}-01T00:00:00`) : null;

  return (
    <div className="timeline-wrap">
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
                    <Thumb
                      key={row.id}
                      row={row}
                      selected={selected.has(row.id)}
                      selectionMode={selectionMode}
                      onOpen={() => onOpen(idx)}
                      onToggleSelect={() => onToggleSelect(row.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Scrubber groups={groups} topIndex={topIndex} onJump={handleJump} />
    </div>
  );
}
