'use client';

import SaleCard from './SaleCard';
import AdCard from './AdCard';

// Fallback if the app_settings row hasn't loaded yet (or the schema-v8
// migration hasn't been run) -- matches the old hardcoded behavior so
// nothing changes for anyone who hasn't touched the new admin setting.
const DEFAULT_AD_INTERVAL = 4;

function buildFeed(sales, ads, adInterval) {
  const feed = sales.map((sale) => ({ type: 'sale', sale }));
  if (!ads || ads.length === 0 || sales.length === 0) return feed;

  // Guard against a bad/unset value (0, negative, not-a-number) rather
  // than dividing by it or spamming an ad after every single listing.
  const interval = Number.isInteger(adInterval) && adInterval > 0 ? adInterval : DEFAULT_AD_INTERVAL;

  const withAds = [];
  let adIdx = 0;
  feed.forEach((item, i) => {
    withAds.push(item);
    if ((i + 1) % interval === 0) {
      withAds.push({ type: 'ad', ad: ads[adIdx % ads.length], key: `ad-${i}` });
      adIdx += 1;
    }
  });
  return withAds;
}

export default function BrowseScreen({
  sales,
  ads,
  adInterval,
  loading,
  loadError,
  dayOptions,
  selectedDates,
  onToggleDate,
  searchQuery,
  onSearch,
  favorites,
  onToggleFavorite,
  onOpenSale,
}) {
  let routeIdx = 0;
  // The same physical-location ad can appear more than once in a long
  // feed (buildFeed cycles through `ads` every `adInterval` items) -- this
  // remembers the route number already assigned to a favorited ad the
  // first time it showed up, so a repeat further down the list shows the
  // same number instead of counting itself again.
  const seenAdRouteNum = new Map();
  const feed = buildFeed(sales, ads, adInterval);

  return (
    <>
      <div className="header">
        <div className="header-row">
          <div className="logo marker-font">
            Sale<span>Hop</span>
          </div>
          <div className="icon-btn">🔔</div>
        </div>
        <div className="search">
          🔍{' '}
          <input
            placeholder="Search neighborhood or address…"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear"
              onClick={() => onSearch('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        <div className="day-pills">
          {dayOptions.map((opt) => (
            <div
              key={opt.date}
              className={`pill ${selectedDates.includes(opt.date) ? 'active' : ''}`}
              onClick={() => onToggleDate(opt.date)}
            >
              {opt.label}
            </div>
          ))}
        </div>
        <div className="count-row">
          <b>{sales.length}</b>&nbsp;sale{sales.length === 1 ? '' : 's'} near you
        </div>
        {searchQuery && (
          <div className="clear-filter-row">
            <button type="button" className="clear-filter-pill" onClick={() => onSearch('')}>
              ✕ Show All Sales
            </button>
          </div>
        )}
      </div>

      <div className="list-scroll">
        <div className="sidebar-label">Nearby Sales — Sorted by Distance</div>

        {loading && <div className="empty-state">Loading nearby sales…</div>}

        {!loading && loadError && (
          <div className="empty-state">
            <div className="big">⚠️</div>
            Couldn&apos;t load sales right now.
            <br />
            {loadError}
          </div>
        )}

        {!loading && !loadError && sales.length === 0 && (
          <div className="empty-state">
            <div className="big">🧭</div>
            No sales posted for this day yet. Be the first — tap the + button below.
          </div>
        )}

        {!loading &&
          !loadError &&
          feed.map((item) => {
            if (item.type === 'ad') {
              const adFavorited = favorites.includes(item.ad.id);
              let adRouteNum = null;
              if (adFavorited) {
                if (seenAdRouteNum.has(item.ad.id)) {
                  adRouteNum = seenAdRouteNum.get(item.ad.id);
                } else {
                  routeIdx += 1;
                  adRouteNum = routeIdx;
                  seenAdRouteNum.set(item.ad.id, adRouteNum);
                }
              }
              return (
                <AdCard
                  key={item.key}
                  ad={item.ad}
                  favorited={adFavorited}
                  routeNum={adRouteNum}
                  onToggleFavorite={onToggleFavorite}
                />
              );
            }
            const sale = item.sale;
            const favorited = favorites.includes(sale.id);
            if (favorited) routeIdx += 1;
            return (
              <SaleCard
                key={sale.id}
                sale={sale}
                favorited={favorited}
                routeNum={routeIdx}
                onClick={() => onOpenSale(sale.id)}
                onToggleFavorite={onToggleFavorite}
                onFilterNeighborhood={onSearch}
              />
            );
          })}
      </div>
    </>
  );
}
