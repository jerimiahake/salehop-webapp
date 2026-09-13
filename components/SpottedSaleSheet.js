'use client';

import { useRef, useState } from 'react';
import { formatRelativeTime } from '@/lib/format';

const STATUS_COPY = {
  confirmed: {
    label: 'Confirmed by the community',
    disclaimer: '🚩 A visitor confirmed this sale in person. Just a spotted location, not a full listing yet.',
  },
  unconfirmed: {
    label: 'Unconfirmed sighting',
    disclaimer:
      "🚩 Someone reported a sale near here, but nobody's confirmed it yet. If you find it, add a photo or note below to let others know!",
  },
};

// The detail view for one crowdsourced "spotted sale" (schema-v10/v11) --
// opened from a map pin (LeafletMap.js) or a Browse card
// (SpottedSaleCard.js). Shows whatever's been added so far (photos/notes,
// visible immediately with no admin approval) and lets ANY visitor add
// their own photo/note, as long as they can prove they're actually near
// the spot -- which AppShell.js's onContribute handles by grabbing a
// fresh GPS fix (the photo's own EXIF location, checked server-side, can
// also satisfy this on its own).
export default function SpottedSaleSheet({ spot, loading, error, onClose, onContribute, contributing, contributeError }) {
  const [note, setNote] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const fileInputRef = useRef(null);

  const open = Boolean(spot) || loading || Boolean(error);
  if (!open) return null;

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    e.target.value = '';
  }

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoPreview(null);
  }

  async function handleSubmit() {
    if (!photoFile && !note.trim()) return;
    const ok = await onContribute({ file: photoFile, note: note.trim() });
    if (ok) {
      setNote('');
      clearPhoto();
    }
  }

  const statusInfo = spot ? STATUS_COPY[spot.status] || STATUS_COPY.unconfirmed : null;

  return (
    <div className="spotted-sheet-backdrop" onClick={onClose}>
      <div className="spotted-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-drag-zone" style={{ cursor: 'default' }}>
          <div className="sheet-handle" />
          <div className="sheet-head">
            <div className="thumb" style={{ background: spot?.status === 'confirmed' ? '#E4F3F0' : '#FFF3D6' }}>
              🚩
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="card-title">Spotted Sale</p>
              {statusInfo && (
                <span className={`spotted-status-pill ${spot.status === 'confirmed' ? 'confirmed' : 'unconfirmed'}`}>
                  {spot.status === 'confirmed' ? '✓ Confirmed' : '⚠️ Unconfirmed'}
                </span>
              )}
            </div>
            <div className="sheet-actions">
              <button type="button" className="sheet-share" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>
          </div>
        </div>

        <div className="sheet-scroll">
          {loading && <div className="empty-state">Loading…</div>}
          {error && <div className="empty-state">⚠️ {error}</div>}

          {spot && (
            <>
              <p className="spotted-disclaimer">{statusInfo.disclaimer}</p>
              <p className="hint" style={{ marginTop: -6 }}>Reported {formatRelativeTime(spot.first_reported_at)}.</p>

              {spot.photo_urls.length > 0 && (
                <>
                  <div className="sheet-section-label">Photos</div>
                  <div className="sheet-photos">
                    {spot.photo_urls.map((url) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={url} src={url} alt="" className="sheet-photo" />
                    ))}
                  </div>
                </>
              )}

              {spot.notes.length > 0 && (
                <>
                  <div className="sheet-section-label">Notes from visitors</div>
                  {spot.notes.map((n, i) => (
                    <p key={i} className="spotted-note">
                      {n.text}
                    </p>
                  ))}
                </>
              )}

              <div className="sheet-section-label">Found it? Add a photo or note</div>
              <p className="hint" style={{ marginTop: 0 }}>
                We&apos;ll check your photo&apos;s location (or your current location) to make sure you&apos;re
                actually here before it&apos;s added.
              </p>

              {photoPreview && (
                <div className="photo-thumb" style={{ marginBottom: 10 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoPreview} alt="" />
                  <button type="button" className="x" onClick={clearPhoto} aria-label="Remove photo">
                    ✕
                  </button>
                </div>
              )}

              {!photoPreview && (
                <label
                  className="photo-add"
                  style={{ width: '100%', height: 'auto', flexDirection: 'row', gap: 8, padding: '13px', borderRadius: 12 }}
                >
                  <span style={{ fontSize: 18 }}>📷</span>
                  <span>Add a photo</span>
                  <input ref={fileInputRef} type="file" accept="image/jpeg" hidden onChange={handleFile} />
                </label>
              )}

              <textarea
                placeholder="What do you see? (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                style={{ marginTop: 10, width: '100%', boxSizing: 'border-box' }}
              />

              {contributeError && <p className="error-hint">{contributeError}</p>}
            </>
          )}
        </div>

        {spot && (
          <div className="publish-bar" style={{ position: 'static' }}>
            <button
              type="button"
              className="publish-btn"
              disabled={contributing || (!photoFile && !note.trim())}
              onClick={handleSubmit}
            >
              {contributing ? 'Verifying…' : 'Submit'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
