import React, { useEffect, useState, useCallback } from 'react';
import type { DuplicateGroup, ImageRow } from '../../electron/preload';
import { isVideoExt } from '../../electron/media';

interface Props {
  onClose: () => void;
  /** Called after files are trashed so the parent can refresh its index. */
  onChanged: () => void;
  onOpen: (list: ImageRow[], index: number) => void;
}

function fmtSize(n: number | null): string {
  if (!n) return '';
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export function DuplicatesView({ onClose, onChanged, onOpen }: Props) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  // ids the user has marked for deletion (default: every image except the
  // first/largest in each group, which we suggest keeping).
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const g = await window.api.images.findDuplicates();
    setGroups(g);
    const m = new Set<number>();
    for (const grp of g) grp.images.slice(1).forEach((img) => m.add(img.id));
    setMarked(m);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id: number) =>
    setMarked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const totalDupes = groups?.reduce((n, g) => n + g.images.length, 0) ?? 0;

  const handleTrash = async () => {
    if (marked.size === 0) return;
    const ok = window.confirm(
      `Chuyển ${marked.size} tệp vào thùng rác của hệ điều hành? (có thể khôi phục)`
    );
    if (!ok) return;
    setBusy(true);
    const res = await window.api.images.trash(Array.from(marked));
    setBusy(false);
    onChanged();
    if (res.failed.length > 0) {
      window.alert(`Đã xoá ${res.trashed}, lỗi ${res.failed.length} tệp.`);
    }
    await load();
  };

  return (
    <div className="dup-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dup-modal">
        <div className="dup-head">
          <h2>Ảnh trùng lặp</h2>
          <div className="spacer" />
          {groups && (
            <span className="dup-summary">
              {groups.length} nhóm · {totalDupes} ảnh · chọn xoá {marked.size}
            </span>
          )}
          <button
            className="danger"
            disabled={busy || marked.size === 0}
            onClick={handleTrash}
          >
            Xoá {marked.size} đã chọn
          </button>
          <button onClick={onClose}>Đóng</button>
        </div>

        <div className="dup-body">
          {groups === null && <div className="dup-empty">Đang quét…</div>}
          {groups && groups.length === 0 && (
            <div className="dup-empty">Không tìm thấy ảnh trùng lặp 🎉</div>
          )}
          {groups?.map((g) => (
            <div key={g.phash} className="dup-group">
              <div className="dup-group-meta">
                {g.images.length} bản · giữ bản đầu (lớn nhất)
              </div>
              <div className="dup-group-items">
                {g.images.map((img, i) => {
                  const isMarked = marked.has(img.id);
                  return (
                    <div
                      key={img.id}
                      className={`dup-cell ${isMarked ? 'marked' : ''} ${i === 0 ? 'keep' : ''}`}
                    >
                      <div className="dup-thumb" onClick={() => onOpen(g.images, i)}>
                        {isVideoExt(img.ext) ? (
                          <div className="thumb-video small"><span className="play-icon">▶</span></div>
                        ) : img.thumb_status === 'ready' ? (
                          <img src={`thumb://${img.id}`} loading="lazy" alt={img.filename} />
                        ) : (
                          <div className="thumb-placeholder">…</div>
                        )}
                        {i === 0 && <span className="dup-keep-badge">GIỮ</span>}
                      </div>
                      <div className="dup-cell-name" title={img.path}>{img.filename}</div>
                      <div className="dup-cell-sub">{fmtSize(img.size)}</div>
                      <label className="dup-cell-check">
                        <input
                          type="checkbox"
                          checked={isMarked}
                          onChange={() => toggle(img.id)}
                        />
                        xoá
                      </label>
                      <button
                        className="dup-reveal"
                        onClick={() => window.api.shell.showInFolder(img.path)}
                        title="Mở trong thư mục"
                      >
                        ⤴
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
