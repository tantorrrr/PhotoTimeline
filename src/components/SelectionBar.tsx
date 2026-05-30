import React, { useState } from 'react';
import type { Album } from '../../electron/preload';

interface Props {
  count: number;
  albums: Album[];
  onClear: () => void;
  onFavorite: (fav: boolean) => void;
  onExport: () => void;
  onTrash: () => void;
  onAddToAlbum: (albumId: number) => void;
  onCreateAlbumAndAdd: (name: string) => void;
}

export function SelectionBar({
  count,
  albums,
  onClear,
  onFavorite,
  onExport,
  onTrash,
  onAddToAlbum,
  onCreateAlbumAndAdd
}: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const submitNew = () => {
    const trimmed = name.trim();
    if (trimmed) onCreateAlbumAndAdd(trimmed);
    setName('');
    setCreating(false);
  };

  return (
    <div className="selectionbar">
      <span className="sel-count">{count} đã chọn</span>

      <button onClick={() => onFavorite(true)} title="Đánh dấu yêu thích">♥</button>
      <button onClick={() => onFavorite(false)} title="Bỏ yêu thích">♡</button>
      <button onClick={onExport} title="Sao chép ra thư mục khác">Export</button>

      {creating ? (
        <span className="sel-newalbum">
          <input
            autoFocus
            placeholder="Tên album mới"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNew();
              if (e.key === 'Escape') {
                setCreating(false);
                setName('');
              }
            }}
          />
          <button onClick={submitNew}>Tạo &amp; thêm</button>
        </span>
      ) : (
        <select
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__new__') setCreating(true);
            else if (v) onAddToAlbum(Number(v));
            e.target.value = '';
          }}
          title="Thêm vào album"
        >
          <option value="">+ Album…</option>
          {albums.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          <option value="__new__">Tạo album mới…</option>
        </select>
      )}

      <button className="danger" onClick={onTrash} title="Chuyển vào thùng rác">Xoá</button>
      <div className="spacer" />
      <button onClick={onClear}>Bỏ chọn</button>
    </div>
  );
}
