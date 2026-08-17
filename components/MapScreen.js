'use client';

import dynamic from 'next/dynamic';
import { formatTimeRange } from '@/lib/format';

const LeafletMap = dynamic(() => import('./LeafletMap'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ink-soft)' }}>
      Loading map…
    </div>
  ),
});

export default function MapScreen({
  sales,
  favorites,
  selectedSaleId,
  onSelectSale,
  onToggleFavorite,
  favoritedSales,
  onOpenSaved,
  center,
  active = true,
}) {
  const selectedSale = sales.find((s) => s.id === selectedSaleId);

  return (
    <div className="map-wrap">
      <LeafletMap
        sales={sales}
        favorites={favorites}
        selectedSaleId={selectedSaleId}
        onSelectSale={onSelectSale}
        center={center}
        active={active}
      />

      <div className="map-floating-row">
        <div className="map-chip">📍 {sales.length} nearby</div>
      </div>

      {selectedSale && (
        <div className={`map-peek ${favorites.includes(selectedSale.id) ? 'favorited' : ''}`}>
          <div className="thumb" style={{ background: favorites.includes(selectedSale.id) ? '#e4f0e6' : '#faf1d8' }}>
            {selectedSale.icon || '🏷️'}
          </div>
          <div className="card-body">
            <p className="card-title">{selectedSale.title}</p>
            <p className="card-addr">{selectedSale.address}</p>
            <div className="card-meta">
              <span className="time-badge mono">
                {selectedSale.time || formatTimeRange(selectedSale.start_time, selectedSale.end_time)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className={`fav-btn ${favorites.includes(selectedSale.id) ? 'on' : ''}`}
            onClick={() => onToggleFavorite(selectedSale.id)}
          >
            ★
          </button>
        </div>
      )}

      {!selectedSale && favoritedSales.length > 0 && (
        <button type="button" className="route-pill" onClick={onOpenSaved}>
          <div className="dot" />
          <span>
            {favoritedSales.length} stop{favoritedSales.length > 1 ? 's' : ''} on your route
          </span>
          <span className="go">Open ▸</span>
        </button>
      )}
    </div>
  );
}
