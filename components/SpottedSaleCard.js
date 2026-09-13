'use client';

import { formatRelativeTime } from '@/lib/format';

// A crowdsourced sighting shown in Browse's list view alongside real
// listings (schema-v10/v11) -- visually distinct (dashed border, no
// title/address, a disclaimer instead) so nobody mistakes it for an
// actual seller-posted sale. Tapping it opens SpottedSaleSheet.js, same
// as tapping its map pin does.
export default function SpottedSaleCard({ spot, onClick }) {
  const confirmed = spot.status === 'confirmed';

  return (
    <div className={`card spotted-card ${confirmed ? 'confirmed' : 'unconfirmed'}`} onClick={onClick}>
      <div className="thumb" style={{ background: confirmed ? '#E4F3F0' : '#FFF3D6' }}>
        🚩
      </div>
      <div className="card-body">
        <p className="card-title">Spotted Sale</p>
        <p className="card-addr">
          {confirmed ? 'Confirmed by the community' : "Unconfirmed — worth a look!"}
          {Number.isFinite(spot.distance) ? ` · ${spot.distance.toFixed(1)} mi` : ''}
        </p>
        <div className="card-meta">
          <span className={`spotted-status-pill ${confirmed ? 'confirmed' : 'unconfirmed'}`}>
            {confirmed ? '✓ Confirmed' : '⚠️ Unconfirmed'}
          </span>
          {spot.photo_count > 0 && <span className="time-badge mono">📷 {spot.photo_count}</span>}
          {spot.note_count > 0 && <span className="time-badge mono">📝 {spot.note_count}</span>}
          <span className="time-badge mono">{formatRelativeTime(spot.first_reported_at)}</span>
        </div>
      </div>
    </div>
  );
}
