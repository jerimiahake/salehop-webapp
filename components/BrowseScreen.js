'use client';

import SaleCard from './SaleCard';

export default function BrowseScreen({
  sales,
  loading,
  loadError,
  dayOptions,
  selectedDate,
  onSelectDate,
  searchQuery,
  onSearch,
  favorites,
  onToggleFavorite,
  onOpenSale,
}) {
  let routeIdx = 0;

  return (
    <>
      <div className="header">
        <div className="header-row">
          <div className="logo marker-font">
            Sale<span>Hop</span>
          </div>
          <div className="icon-btn">ðŸ””</div>
        </div>
        <div className="search">
          ðŸ”{' '}
          <input
            placeholder="Search neighborhood or addressâ€¦"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <div className="day-pills">
          {dayOptions.map((opt) => (
            <div
              key={opt.date}
              className={`pill ${selectedDate === opt.date ? 'active' : ''}`}
              onClick={() => onSelectDate(opt.date)}
            >
              {opt.label}
            </div>
          ))}
        </div>
        <div className="count-row">
          <b>{sales.length}</b>&nbsp;sale{sales.length === 1 ? '' : 's'} near you
        </div>
      </div>

      <div className="list-scroll">
        <div className="sidebar-label">Nearby Sales â€” Sorted by Distance</div>

        {loading && <div className="empty-state">Loading nearby salesâ€¦</div>}

        {!loading && loadError && (
          <div className="empty-state">
            <div className="big">âš ï¸</div>
            Couldn&apos;t load sales right now.
            <br />
            {loadError}
          </div>
        )}

        {!loading && !loadError && sales.length === 0 && (
          <div className="empty-state">
            <div className="big">ðŸ§­</div>
            No sales posted for this day yet. Be the first â€” tap the + button below.
          </div>
        )}

        {!loading &&
          !loadError &&
          sales.map((sale) => {
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
              />
            );
          })}
      </div>
    </>
  );
}
