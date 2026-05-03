import { useEffect, useRef, useState, useCallback } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const WHEEL_SENSITIVITY = 0.0015;

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

export function useZoomPan() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<Transform>(IDENTITY);
  const dragging = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const reset = useCallback(() => setT(IDENTITY), []);

  const zoomAt = useCallback((clientX: number, clientY: number, delta: number) => {
    setT((prev) => {
      const el = containerRef.current;
      if (!el) return prev;
      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;

      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * (1 + delta)));
      if (newScale === prev.scale) return prev;

      // Keep the point under the cursor stationary:
      // worldPoint = (clientPoint - translate) / scale
      // we want worldPoint to remain the same after scale change:
      const ratio = newScale / prev.scale;
      const x = px - (px - prev.x) * ratio;
      const y = py - (py - prev.y) * ratio;

      if (newScale === 1) return IDENTITY;
      return { scale: newScale, x, y };
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Trackpad pinch shows up as ctrlKey wheel; both treated the same.
      const delta = -e.deltaY * WHEEL_SENSITIVITY * (e.ctrlKey ? 4 : 1);
      zoomAt(e.clientX, e.clientY, delta);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragging.current = {
        startX: e.clientX,
        startY: e.clientY,
        tx: 0,
        ty: 0
      };
      setIsDragging(true);
      // capture current translate
      setT((prev) => {
        if (dragging.current) {
          dragging.current.tx = prev.x;
          dragging.current.ty = prev.y;
        }
        return prev;
      });
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragging.current.startX;
      const dy = e.clientY - dragging.current.startY;
      setT((prev) => ({ ...prev, x: dragging.current!.tx + dx, y: dragging.current!.ty + dy }));
    };

    const onMouseUp = () => {
      dragging.current = null;
      setIsDragging(false);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [zoomAt]);

  const zoomIn = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.25);
  }, [zoomAt]);

  const zoomOut = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, -0.25);
  }, [zoomAt]);

  return { containerRef, transform: t, isDragging, reset, zoomIn, zoomOut };
}
