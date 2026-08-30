'use client';

import { useMemo, useState } from 'react';
import { formatTimeRange, formatDateRange } from '@/lib/format';

// Standard paper sizes a sign can be printed on, in inches, portrait
// (width x height) -- swapped when "Landscape" is picked below. "Large
// Sign" isn't a paper size at all -- it tiles the design across 6 regular
// letter sheets (see the poster section below) for something big enough
// to read from the road, taped together afterward.
const PAPER_SIZES = [
  { id: 'letter', label: '8.5" × 11"', w: 8.5, h: 11 },
  { id: 'tabloid', label: '11" × 17"', w: 11, h: 17 },
  { id: 'superb', label: '13" × 19"', w: 13, h: 19 },
  { id: 'poster', label: 'Large Sign (tape together)', w: null, h: null },
];

const ARROWS = [
  { id: 'right', label: '➜ Right', deg: 0 },
  { id: 'down', label: '➜ Down', deg: 90 },
  { id: 'left', label: '➜ Left', deg: 180 },
  { id: 'up', label: '➜ Up', deg: 270 },
  { id: 'none', label: 'No Arrow', deg: 0 },
];

// A "Large Sign" is 6 ordinary letter sheets (8.5x11 each) that together
// form one big poster -- Portrait arranges them 2 across x 3 down (a
// tall banner), Landscape arranges them 3 across x 2 down (a wide one).
// Each individual sheet still prints as a normal portrait letter page --
// only the arrangement (which slice of the big design lands on which
// sheet) changes with orientation.
const TILE_W_IN = 8.5;
const TILE_H_IN = 11;

function posterGrid(orientation) {
  return orientation === 'landscape' ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
}

export default function SignBuilder({ sale, qrSvg }) {
  const [orientation, setOrientation] = useState('landscape');
  const [arrowId, setArrowId] = useState('right');
  const [paperId, setPaperId] = useState('letter');

  const arrow = ARROWS.find((a) => a.id === arrowId) || ARROWS[0];
  const paper = PAPER_SIZES.find((p) => p.id === paperId) || PAPER_SIZES[0];
  const isPoster = paper.id === 'poster';

  const dateRange = formatDateRange(sale.sale_date, sale.end_date);
  const timeRange = formatTimeRange(sale.start_time, sale.end_time);

  // For the 3 fixed paper sizes: the actual printed width/height in
  // inches, swapped when Landscape is selected. Fed to both the on-screen
  // preview (as a unitless aspect ratio) and the print rules (as real
  // inches) via CSS custom properties -- see .sign-sheet in globals.css.
  const paperDims = useMemo(() => {
    if (isPoster || !paper.w) return null;
    return orientation === 'landscape' ? { w: paper.h, h: paper.w } : { w: paper.w, h: paper.h };
  }, [isPoster, paper, orientation]);

  const grid = useMemo(() => posterGrid(orientation), [orientation]);
  const tiles = useMemo(() => {
    const list = [];
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        list.push({ row, col });
      }
    }
    return list;
  }, [grid]);

  return (
    <>
      {/* ---------- On-screen controls (hidden when printing) ---------- */}
      <div className="sign-options no-print">
        <p className="sign-options-label">Orientation</p>
        <div className="sign-options-row">
          <button
            type="button"
            className={`chip ${orientation === 'portrait' ? 'on' : ''}`}
            onClick={() => setOrientation('portrait')}
          >
            📄 Portrait
          </button>
          <button
            type="button"
            className={`chip ${orientation === 'landscape' ? 'on' : ''}`}
            onClick={() => setOrientation('landscape')}
          >
            📃 Landscape
          </button>
        </div>

        <p className="sign-options-label">Arrow Direction</p>
        <div className="sign-options-row">
          {ARROWS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`chip ${arrowId === a.id ? 'on' : ''}`}
              onClick={() => setArrowId(a.id)}
            >
              {a.id === 'none' ? (
                'No Arrow'
              ) : (
                <span style={{ display: 'inline-block', transform: `rotate(${a.deg}deg)` }}>➜</span>
              )}
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: -6, marginBottom: 4 }}>
          Posting somewhere that isn&apos;t pointing toward the sale (like a community board)? Pick &quot;No
          Arrow.&quot;
        </p>

        <p className="sign-options-label">Paper Size</p>
        <div className="sign-options-row">
          {PAPER_SIZES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${paperId === p.id ? 'on' : ''}`}
              onClick={() => setPaperId(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {isPoster && (
          <p className="hint" style={{ marginTop: -6 }}>
            Prints as {grid.cols * grid.rows} separate letter-size pages ({grid.cols} across × {grid.rows} down).
            Print all of them, then tape them together in order using the tile numbers in each corner.
          </p>
        )}
        {!isPoster && (
          <p className="hint" style={{ marginTop: -6 }}>
            This sets the page size for printing or saving as a PDF. If your printer prompts you to choose paper,
            pick the matching size there too.
          </p>
        )}

        <button type="button" className="sign-print-btn" onClick={() => window.print()} style={{ marginTop: 14 }}>
          🖨️ Print This Sign
        </button>
      </div>

      {/* ---------- Printable content ---------- */}
      {!isPoster && paperDims && (
        <>
          <style>{`@page { size: ${paperDims.w}in ${paperDims.h}in; margin: 0.35in; }`}</style>
          <div
            className="sign-sheet"
            style={{ '--paper-w-in': paperDims.w, '--paper-h-in': paperDims.h }}
          >
            <div className="sign-logo marker-font">
              Sale<span>Hop</span>
            </div>

            <h1 className="sign-title">{sale.title}</h1>
            <p className="sign-addr">📍 {sale.address}</p>
            <p className="sign-datetime">
              {dateRange}
              <br />
              {timeRange}
            </p>

            {arrow.id !== 'none' && (
              <div className="sign-arrow" style={{ transform: `rotate(${arrow.deg}deg)` }}>
                ➜
              </div>
            )}

            <div className="sign-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <p className="sign-qr-caption">Scan for photos, full details &amp; directions</p>
            <p className="sign-brand">salehop.app</p>
          </div>
        </>
      )}

      {isPoster && (
        <>
          <style>{`@page { size: ${TILE_W_IN}in ${TILE_H_IN}in; margin: 0.3in; }`}</style>
          <div
            className={`poster-wrap grid-cols-${grid.cols}`}
            style={{ '--tile-w-in': TILE_W_IN, '--tile-h-in': TILE_H_IN, '--cols': grid.cols, '--rows': grid.rows }}
          >
            {tiles.map(({ row, col }, i) => (
              <div className="tile-page" key={`${row}-${col}`}>
                <div className="tile-label">
                  Tile {i + 1} of {tiles.length} — row {row + 1}, col {col + 1}
                </div>
                <div
                  className="poster-canvas"
                  style={{ left: `calc(var(--tile-w-in) * -${col} * 1in)`, top: `calc(var(--tile-h-in) * -${row} * 1in)` }}
                >
                  <div className="poster-logo marker-font">
                    Sale<span>Hop</span>
                  </div>
                  {arrow.id !== 'none' && (
                    <div className="poster-arrow" style={{ transform: `rotate(${arrow.deg}deg)` }}>
                      ➜
                    </div>
                  )}
                  <h1 className="poster-title">{sale.title}</h1>
                  <p className="poster-addr">📍 {sale.address}</p>
                  <p className="poster-datetime">
                    {dateRange}
                    <br />
                    {timeRange}
                  </p>
                  <div className="poster-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                  <p className="poster-brand">salehop.app — scan for details</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
