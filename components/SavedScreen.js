'use client';

import dynamic from 'next/dynamic';
import { buildGoogleMapsUrl, buildAppleMapsUrl, MAPS_EXPORT_MAX_STOPS } from '@/lib/mapsExport';
import { MAP_CENTER } from '@/lib/sampleData';
import { formatTimeRange } from '@/lib/format';

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false, loading: () => null });

export default function SavedScreen({ favoritedSales, onRemove, onMove, showToast }) {
  const stops = favoritedSales.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  const google = buildGoogleMapsUrl(stops);
  const apple = buildAppleMapsUrl(stops);
  const missingCoords = favoritedSales.length - stops.length;

  const mapCenter =
    stops.length > 0
      ? { lat: stops[0].lat, lng: stops[0].lng }
      : MAP_CENTER;

  function handleExportClick(e, built, label) {
    if (!built.url) {
      e.preventDefault();
      return;
    }
    if (built.truncated) {
      showToast?.(`Route capped at the first ${MAPS_EXPORT_MAX_STOPS} stops for ${label} — reorder if you need different ones included.`);
    }
  }

  return (
    <>
      <div className="header" style={{ borderBottomColor: 'var(--red)' }}>
        <div className="header-row">
          <div className="logo marker-font" style={{ fontSize: 17 }}>
            Your <span>Route</span>
          </div>
        </div>
      </div>

      {favoritedSales.length > 0 && (
        <div className="route-map-mini">
          <LeafletMap sales={stops} favorites={stops.map((s) => s.id)} center={mapCenter} interactive={false} />
        </div>
      )}

      <div className="route-list">
        {favoritedSales.length === 0 ? (
          <div className="empty-state">
            <div className="big">★</div>
            Tap the star on any sale to add it to your route. We&apos;ll map the shortest path between your stops.
          </div>
        ) : (
          <>
            {favoritedSales.map((sale, i) => (
              <div className="stop-row" key={sale.id}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button
                    type="button"
                    className="handle"
                    style={{ background: 'none', border: 'none' }}
                    disabled={i === 0}
                    onClick={() => onMove(sale.id, -1)}
                    aria-label="Move up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="handle"
                    style={{ background: 'none', border: 'none' }}
                    disabled={i === favoritedSales.length - 1}
                    onClick={() => onMove(sale.id, 1)}
                    aria-label="Move down"
                  >
                    ▼
                  </button>
                </div>
                <div className="n">{i + 1}</div>
                <div className="stop-body">
                  <p className="stop-title">{sale.title}</p>
                  <p className="stop-addr">
                    {sale.address} · {sale.time || formatTimeRange(sale.start_time, sale.end_time)}
                  </p>
                </div>
                <button type="button" className="remove" onClick={() => onRemove(sale.id)} aria-label="Remove stop">
                  ✕
                </button>
              </div>
            ))}

            <div className="route-summary">
              {stops.length} stop{stops.length === 1 ? '' : 's'} on the map
              {missingCoords > 0 ? ` · ${missingCoords} stop${missingCoords > 1 ? 's' : ''} couldn't be located and won't appear in the exported route` : ''}
            </div>

            <div className="maps-export-row">
              <a
                className="maps-btn google"
                href={google.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => handleExportClick(e, google, 'Google Maps')}
                aria-disabled={!google.url}
              >
                Open in Google Maps →
              </a>
              <a
                className="maps-btn apple"
                href={apple.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => handleExportClick(e, apple, 'Apple Maps')}
                aria-disabled={!apple.url}
              >
                Open in Apple Maps →
              </a>
            </div>
          </>
        )}
      </div>
    </>
  );
}
