'use client';

import { formatTimeRange, formatDateRange } from '@/lib/format';

export default function SaleCard({ sale, favorited, routeNum, onClick, onToggleFavorite, onFilterNeighborhood }) {
  const time = sale.time || (sale.start_time ? formatTimeRange(sale.start_time, sale.end_time) : '');
  const cover = sale.photo_urls && sale.photo_urls.length > 0 ? sale.photo_urls[0] : null;
  // Only shown once a sale actually has a real sale_date to range from --
  // sample/demo sales that only set `time` (no sale_date) skip it.
  const dateRange = sale.sale_date ? formatDateRange(sale.sale_date, sale.end_date) : null;

  return (
    <div className={`card ${favorited ? 'favorited' : ''} ${sale.isFeatured ? 'featured' : ''}`} onClick={onClick}>
      {favorited && <div className="route-num">{routeNum}</div>}
      <div className="thumb" style={{ background: favorited ? '#e4f0e6' : '#faf1d8' }}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" />
        ) : (
          sale.icon || '🏷️'
        )}
      </div>
      <div className="card-body">
        <p className="card-title">{sale.title}</p>
        <p className="card-addr">
          {sale.address}
          {Number.isFinite(sale.distance) ? ` · ${sale.distance.toFixed(1)} mi` : ''}
        </p>
        <div className="card-meta">
          {sale.isFeatured && <span className="featured-badge">⭐ Featured</span>}
          {dateRange && <span className="time-badge mono">{dateRange}</span>}
          <span className="time-badge mono">{time}</span>
          {(sale.tags || []).map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
        </div>
        {sale.is_neighborhood_sale && sale.neighborhood_name && (
          <button
            type="button"
            className="neighborhood-badge"
            onClick={(e) => {
              e.stopPropagation();
              onFilterNeighborhood?.(sale.neighborhood_name);
            }}
          >
            🏘️ Part of {sale.neighborhood_name}
          </button>
        )}
      </div>
      <button
        type="button"
        className={`fav-btn ${favorited ? 'on' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(sale.id);
        }}
        aria-label={favorited ? 'Remove from route' : 'Add to route'}
      >
        ★
      </button>
    </div>
  );
}
