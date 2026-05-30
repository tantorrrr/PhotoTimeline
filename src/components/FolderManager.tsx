import React from 'react';
import type { FolderListItem, Album } from '../../electron/preload';

interface Props {
  open: boolean;
  folders: FolderListItem[];
  albums: Album[];
  onRemove: (id: number) => void;
  onRescan: (id: number) => void;
  onRemoveAlbum: (id: number) => void;
}

export function FolderManager({ open, folders, albums, onRemove, onRescan, onRemoveAlbum }: Props) {
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

      <h2 style={{ marginTop: 20 }}>Album</h2>
      {albums.length === 0 && (
        <div style={{ color: '#666', fontSize: 12 }}>
          Chưa có album. Chọn ảnh rồi tạo album từ thanh bên dưới.
        </div>
      )}
      {albums.map((a) => (
        <div key={a.id} className="folder-item">
          <div className="path">{a.name}</div>
          <div className="meta">{a.image_count ?? 0} ảnh</div>
          <div className="actions">
            <button className="danger" onClick={() => onRemoveAlbum(a.id)}>
              Xoá album
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
