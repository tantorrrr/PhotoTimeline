import React from 'react';
import type { FolderListItem } from '../../electron/preload';

interface Props {
  open: boolean;
  folders: FolderListItem[];
  onRemove: (id: number) => void;
  onRescan: (id: number) => void;
}

export function FolderManager({ open, folders, onRemove, onRescan }: Props) {
  return (
    <div className={`folder-panel ${open ? 'open' : ''}`}>
      <h2>Thư mục đã import</h2>
      {folders.length === 0 && (
        <div style={{ color: '#666', fontSize: 12 }}>Chưa có thư mục nào.</div>
      )}
      {folders.map((f) => (
        <div key={f.id} className="folder-item">
          <div className="path">{f.path}</div>
          <div className="meta">
            {f.image_count} ảnh
            {f.last_scan_at
              ? ` · scan ${new Date(f.last_scan_at).toLocaleString()}`
              : ' · chưa scan'}
          </div>
          <div className="actions">
            <button onClick={() => onRescan(f.id)}>Rescan</button>
            <button className="danger" onClick={() => onRemove(f.id)}>
              Xoá
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
