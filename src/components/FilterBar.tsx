import React from 'react';
import type { Album } from '../../electron/preload';

export type MediaType = 'all' | 'photo' | 'video' | 'raw';

export interface FilterState {
  text: string;
  type: MediaType;
  favOnly: boolean;
  albumId: number | null;
}

interface Props {
  filter: FilterState;
  setFilter: (f: FilterState) => void;
  albums: Album[];
  shown: number;
  total: number;
  onOpenDuplicates: () => void;
}

export function FilterBar({ filter, setFilter, albums, shown, total, onOpenDuplicates }: Props) {
  const active =
    filter.text !== '' || filter.type !== 'all' || filter.favOnly || filter.albumId !== null;

  return (
    <div className="filterbar">
      <input
        className="filter-search"
        type="search"
        placeholder="Tìm theo tên file…"
        value={filter.text}
        onChange={(e) => setFilter({ ...filter, text: e.target.value })}
      />

      <select
        value={filter.type}
        onChange={(e) => setFilter({ ...filter, type: e.target.value as MediaType })}
        title="Loại media"
      >
        <option value="all">Tất cả</option>
        <option value="photo">Ảnh</option>
        <option value="video">Video</option>
        <option value="raw">RAW</option>
      </select>

      <button
        className={filter.favOnly ? 'chip active' : 'chip'}
        onClick={() => setFilter({ ...filter, favOnly: !filter.favOnly })}
        title="Chỉ ảnh yêu thích"
      >
        {filter.favOnly ? '♥' : '♡'} Yêu thích
      </button>

      <select
        value={filter.albumId ?? ''}
        onChange={(e) =>
          setFilter({ ...filter, albumId: e.target.value === '' ? null : Number(e.target.value) })
        }
        title="Lọc theo album"
      >
        <option value="">Mọi album</option>
        {albums.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.image_count ?? 0})
          </option>
        ))}
      </select>

      {active && (
        <button
          className="chip"
          onClick={() => setFilter({ text: '', type: 'all', favOnly: false, albumId: null })}
        >
          Xoá lọc
        </button>
      )}

      <span className="filter-count">
        {active ? `${shown}/${total}` : `${total}`} mục
      </span>

      <div className="spacer" />
      <button className="chip" onClick={onOpenDuplicates} title="Tìm ảnh trùng lặp">
        Ảnh trùng
      </button>
    </div>
  );
}
