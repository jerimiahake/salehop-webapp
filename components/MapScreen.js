'use client';

import dynamic from 'next/dynamic';
import { useRef } from 'react';
import ListingSheet from './ListingSheet';

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
  ads,
  favorites,
  selectedSaleId,
  onSelectSale,
  onToggleFavorite,
  favoritedSales,
  onOpenSaved,
  center,
  active = true,
}) {
  const mapWrapRef = useRef(null);
  const selectedSale = sales.find((s) => s.id === selectedSaleId);

  return (
    <div className="map-wrap" ref={mapWrapRef}>
      <LeafletMap
        sales={sales}
        ads={ads}
        favorites={favorites}
        selectedSaleId={selectedSaleId}
        onSelectSale={onSelectSale}
        center={center}
        active={active}
      />

      <div className="map-floating-row">
        <div className="map-chip">📍 {sales.length} nearby</div>
      </div>

      <ListingSheet
        sale={selectedSale}
        favorited={selectedSale ? favorites.includes(selectedSale.id) : false}
        onToggleFavorite={onToggleFavorite}
        onClose={() => onSelectSale(null)}
        containerRef={mapWrapRef}
      />

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
