'use client';

import { useEffect, useRef, useState } from 'react';
import { formatTimeRange, formatDateRange } from '@/lib/format';
import { SITE_URL } from '@/lib/site';
import ShareButton from './ShareButton';

const HALF_FRACTION = 0.42;
const FULL_FRACTION = 0.88;
const DISMISS_FRACTION = 0.2;
const TAP_THRESHOLD_PX = 6; // pointer movement under this counts as a tap, not a drag

// A draggable bottom sheet over the map. Tapping a sale (from Browse, or a
// pin on the map itself) opens this parked at "half" height showing a
// compact preview. Dragging (or tapping) the handle bar expands it to
// "full" (photos + full description) or collapses it back to "half";
// dragging past a dismiss threshold closes it entirely, same as the X
// button.
//
// Height changes are applied directly to the DOM node during a drag (via
// sheetRef), not through React state, so every pointermove doesn't trigger
// a re-render -- state ("mode") only updates once the drag settles, which
// keeps the gesture smooth on a real phone. The sheet's wrapper div is
// always rendered (even before any sale has ever been selected) so
// sheetRef.current already exists the first time a sale opens -- otherwise
// that very first open couldn't animate in.
export default function ListingSheet({ sale, favorited, onToggleFavorite, onClose, containerRef }) {
  const sheetRef = useRef(null);
  const [activeSale, setActiveSale] = useState(sale || null);
  const [mode, setMode] = useState('closed'); // 'closed' | 'half' | 'full'
  const dragState = useRef(null); // { startY, startHeight, moved } while a drag is in progress

  useEffect(() => {
    if (sale) {
      setActiveSale(sale);
      applyHeight(heightFor('half'), true);
      setMode('half');
    } else {
      applyHeight(0, true);
      setMode('closed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale?.id]);

  function containerHeight() {
    return containerRef.current?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 800);
  }

  function heightFor(m) {
    const h = containerHeight();
    if (m === 'full') return h * FULL_FRACTION;
    if (m === 'half') return h * HALF_FRACTION;
    return 0;
  }

  function applyHeight(px, animate) {
    const el = sheetRef.current;
    if (!el) return;
    el.classList.toggle('dragging', !animate);
    el.style.height = `${px}px`;
    if (!animate) {
      // Next frame, let the CSS transition resume for future (non-drag)
      // height changes -- keeping it off for one frame avoids the browser
      // trying to animate the drag's own manual updates.
      requestAnimationFrame(() => el.classList.remove('dragging'));
    }
  }

  function settle(nextMode) {
    setMode(nextMode);
    applyHeight(heightFor(nextMode), true);
    if (nextMode === 'closed') onClose?.();
  }

  function handlePointerDown(e) {
    dragState.current = { startY: e.clientY, startHeight: heightFor(mode), moved: 0 };
    applyHeight(heightFor(mode), false);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e) {
    const drag = dragState.current;
    if (!drag) return;
    const delta = e.clientY - drag.startY; // positive = moving down
    drag.moved = Math.max(drag.moved, Math.abs(delta));
    const h = containerHeight();
    const next = Math.max(0, Math.min(h * 0.96, drag.startHeight - delta));
    applyHeight(next, false);
  }

  function handlePointerUp() {
    const drag = dragState.current;
    dragState.current = null;
    if (!drag) return;

    if (drag.moved < TAP_THRESHOLD_PX) {
      // A tap on the handle, not a drag -- toggle instead of snapping to
      // whatever the pointer position happened to be.
      settle(mode === 'full' ? 'half' : 'full');
      return;
    }

    const h = containerHeight();
    const currentPx = sheetRef.current?.getBoundingClientRect().height ?? 0;
    if (currentPx < h * DISMISS_FRACTION) {
      settle('closed');
      return;
    }
    const midpoint = h * ((HALF_FRACTION + FULL_FRACTION) / 2);
    settle(currentPx > midpoint ? 'full' : 'half');
  }

  const cover = activeSale?.photo_urls && activeSale.photo_urls.length > 0 ? activeSale.photo_urls[0] : null;
  const dateRange = activeSale?.sale_date ? formatDateRange(activeSale.sale_date, activeSale.end_date) : null;
  const time = activeSale
    ? activeSale.time || (activeSale.start_time ? formatTimeRange(activeSale.start_time, activeSale.end_time) : '')
    : '';

  return (
    <div ref={sheetRef} className="listing-sheet" style={{ height: 0 }}>
      {activeSale && (
        <>
          <div
            className="sheet-drag-zone"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <div className="sheet-handle" />
            <div className="sheet-head">
              <div className="thumb" style={{ background: favorited ? '#e4f0e6' : '#faf1d8' }}>
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="" />
                ) : (
                  activeSale.icon || '🏷️'
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="card-title">{activeSale.title}</p>
                <p className="card-addr">{activeSale.address}</p>
                <div className="card-meta">
                  {activeSale.isFeatured && <span className="featured-badge">⭐ Featured</span>}
                  {dateRange && <span className="time-badge mono">{dateRange}</span>}
                  {time && <span className="time-badge mono">{time}</span>}
                </div>
              </div>
              <div
                className="sheet-actions"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <ShareButton url={`${SITE_URL}/listing/${activeSale.id}`} title={activeSale.title} />
                <button
                  type="button"
                  className={`sheet-fav ${favorited ? 'on' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite?.(activeSale.id);
                  }}
                  aria-label={favorited ? 'Remove from route' : 'Add to route'}
                >
                  ★
                </button>
              </div>
            </div>
            <div className="expand-hint">
              {mode === 'full' ? '▼ drag or tap to collapse ▼' : '▲ drag or tap to expand ▲'}
            </div>
          </div>

          <div className="sheet-scroll">
            {activeSale.is_neighborhood_sale && activeSale.neighborhood_name && (
              <div className="neighborhood-badge" style={{ cursor: 'default', marginTop: 0, marginBottom: 12 }}>
                🏘️ Part of {activeSale.neighborhood_name}
              </div>
            )}

            {(activeSale.tags || []).length > 0 && (
              <div className="card-meta" style={{ marginBottom: 4 }}>
                {activeSale.tags.map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
            )}

            {activeSale.photo_urls && activeSale.photo_urls.length > 0 && (
              <>
                <div className="sheet-section-label">Photos</div>
                <div className="sheet-photos">
                  {activeSale.photo_urls.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={url} src={url} alt="" className="sheet-photo" />
                  ))}
                </div>
              </>
            )}

            {activeSale.description && (
              <>
                <div className="sheet-section-label">Description</div>
                <p className="sheet-desc">{activeSale.description}</p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
