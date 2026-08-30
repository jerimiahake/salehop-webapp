'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { sampleSales, MAP_CENTER } from '@/lib/sampleData';
import { nextNDays, distanceMiles, toDateKey, dateInRange } from '@/lib/format';
import { SITE_URL } from '@/lib/site';
import BrowseScreen from './BrowseScreen';
import MapScreen from './MapScreen';
import PostScreen from './PostScreen';
import SavedScreen from './SavedScreen';
import AccountScreen from './AccountScreen';
import BottomNav from './BottomNav';
import Toast from './Toast';
import ShareToFacebookButton from './ShareToFacebookButton';

const FAVORITES_KEY = 'salehop:favorites';

export default function AppShell() {
  const [activeScreen, setActiveScreen] = useState('browse');
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [ads, setAds] = useState([]);
  const dayOptions = useMemo(() => nextNDays(7), []);
  // Multi-select: most sales run 2-3 days, so Browse lets you pick several
  // days at once and see anything running on any of them. Always at least
  // one day selected -- toggleDate below guards against clearing the last one.
  const [selectedDates, setSelectedDates] = useState(() => [toDateKey(new Date())]);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState([]);
  const [selectedSaleId, setSelectedSaleId] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [toast, setToast] = useState(null);
  const [session, setSession] = useState(null);
  const [editingListing, setEditingListing] = useState(false);
  // Set true when Supabase reports a PASSWORD_RECOVERY event (the visitor
  // clicked a "reset your password" email link) -- routes them straight to
  // Account's "set a new password" form instead of the normal signed-in
  // view, even though that click also gave them a valid session.
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  // A seller's own listings (every status, not just approved -- unlike
  // `sales` above) plus the shared edit/feature/delete state for them.
  // These used to live inside AccountScreen, but the Map screen's "Manage"
  // menu (see manageMenuSale below) needs to trigger the exact same
  // actions on a listing without necessarily being on the Account screen,
  // so the data and the mutations that touch it live here and get passed
  // down to both AccountScreen and the manage menu.
  const [listings, setListings] = useState([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingsLoadError, setListingsLoadError] = useState(null);
  const [listingsRefreshKey, setListingsRefreshKey] = useState(0);
  const [editingSale, setEditingSale] = useState(null);
  // id of whichever listing's "Feature — $10" button was just tapped, so
  // only that one button/menu shows a loading state while checkout starts.
  const [featuringId, setFeaturingId] = useState(null);
  // Which listing (if any) is showing the small Edit/Print/Feature/
  // Share/Delete action menu, opened from the wrench button on the Map
  // screen's preview sheet (see ListingSheet's onManage). Rendered at this
  // top level (like Toast below) rather than inside the sheet itself, so
  // it isn't clipped by the sheet's/map's own overflow:hidden.
  const [manageMenuSale, setManageMenuSale] = useState(null);

  const showToast = useCallback((message) => {
    setToast({ message, key: Date.now() });
  }, []);

  // Track the signed-in seller's session (magic-link auth). Supabase's
  // client persists the session in localStorage and also picks up the
  // token from the URL automatically when someone lands here after
  // clicking their magic-link email -- both are reflected here.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
        setActiveScreen('account');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Backup for the "sign in from a second tab" flow (see the email-link
  // splash at app/auth/callback/page.js): Supabase's client already syncs
  // a new sign-in across same-browser tabs on its own, so this is normally
  // redundant -- but re-checking whenever someone actually switches back
  // to this tab costs nothing and catches it even if that sync didn't
  // fire for some reason, which is exactly the moment a visitor cares
  // about seeing themselves signed in here.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    function recheckSession() {
      if (document.visibilityState === 'visible') {
        supabase.auth.getSession().then(({ data }) => setSession(data.session));
      }
    }

    document.addEventListener('visibilitychange', recheckSession);
    window.addEventListener('focus', recheckSession);
    return () => {
      document.removeEventListener('visibilitychange', recheckSession);
      window.removeEventListener('focus', recheckSession);
    };
  }, []);

  // Load sales (from Supabase once configured, sample data until then).
  // Pulled out to a stable function (rather than only living inside the
  // mount effect below) so a listing edit/delete/feature can also trigger
  // a fresh load, keeping Browse/Map in sync with changes made from the
  // Account screen or the Map's manage menu without needing a full reload.
  const loadSales = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setSales(sampleSales);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('sales')
      .select('*')
      .eq('status', 'approved')
      .order('sale_date', { ascending: true });

    if (error) {
      setLoadError(error.message);
      setSales([]);
    } else {
      setSales(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  // Load the signed-in seller's own listings -- every status (pending,
  // approved, rejected), not just approved like `sales` above. Used by
  // AccountScreen's "My Listings" list and by the Map screen's manage menu
  // (to know a listing's current feature/status when deciding what the
  // menu should show).
  useEffect(() => {
    if (!session || !isSupabaseConfigured) {
      setListings([]);
      return undefined;
    }
    let cancelled = false;

    async function loadListings() {
      setListingsLoading(true);
      const { data, error } = await supabase
        .from('sales')
        .select('*')
        .eq('user_id', session.user.id)
        .order('sale_date', { ascending: false });

      if (cancelled) return;
      if (error) {
        setListingsLoadError(error.message);
      } else {
        setListingsLoadError(null);
        setListings(data || []);
      }
      setListingsLoading(false);
    }

    loadListings();
    return () => {
      cancelled = true;
    };
  }, [session, listingsRefreshKey]);

  // Load active ads (sponsored cards mixed into Browse). Not critical if
  // this fails or Supabase isn't configured yet -- the app just shows no
  // ads rather than breaking anything.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let cancelled = false;

    supabase
      .from('ads')
      .select('*')
      .eq('active', true)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setAds(data || []);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Load saved favorites (route stops) from this browser -- no account needed.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITES_KEY);
      if (raw) setFavorites(JSON.parse(raw));
    } catch {
      // ignore malformed/blocked storage
    }
  }, []);

  // Stripe redirects back here (full page reload) after a "Feature this
  // listing" checkout finishes -- success_url/cancel_url in
  // /api/stripe/create-checkout-session both just point at "/" with a
  // ?featured=... marker. This picks that up once on mount, shows a toast,
  // jumps to Account (where the listing lives), and then strips the query
  // param so refreshing/sharing the URL later doesn't replay the message.
  // The actual "mark it featured" already happened server-side in the
  // Stripe webhook by the time this redirect lands -- this is just the
  // user-facing landing, not what does the marking.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const featured = params.get('featured');
    if (!featured) return;

    if (featured === 'success') {
      showToast('🌟 Payment received -- your listing is now featured at the top of Browse!');
      setActiveScreen('account');
    } else if (featured === 'cancelled') {
      setActiveScreen('account');
    }

    params.delete('featured');
    const rest = params.toString();
    window.history.replaceState({}, '', rest ? `?${rest}` : window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Best-effort location for distance sorting; silently no-ops if denied.
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 8000 }
    );
  }, []);

  const persistFavorites = useCallback((next) => {
    setFavorites(next);
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const toggleFavorite = useCallback(
    (id) => {
      const next = favorites.includes(id)
        ? favorites.filter((x) => x !== id)
        : [...favorites, id];
      persistFavorites(next);
    },
    [favorites, persistFavorites]
  );

  const moveFavorite = useCallback(
    (id, direction) => {
      const idx = favorites.indexOf(id);
      if (idx === -1) return;
      const swapWith = idx + direction;
      if (swapWith < 0 || swapWith >= favorites.length) return;
      const next = [...favorites];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      persistFavorites(next);
    },
    [favorites, persistFavorites]
  );

  const referenceLocation = userLocation || MAP_CENTER;

  // Toggle a day pill on/off, but never down to zero selected days --
  // Browse always needs at least one day to filter against.
  const toggleDate = useCallback((date) => {
    setSelectedDates((prev) => {
      if (prev.includes(date)) {
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== date);
      }
      return [...prev, date];
    });
  }, []);

  const filteredSales = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const todayKey = toDateKey(new Date());
    return sales
      .filter((s) => selectedDates.some((d) => dateInRange(d, s.sale_date, s.end_date)))
      .filter((s) => {
        if (!q) return true;
        return (
          s.title.toLowerCase().includes(q) ||
          s.address.toLowerCase().includes(q) ||
          (s.neighborhood_name || '').toLowerCase().includes(q)
        );
      })
      .map((s) => ({
        ...s,
        distance: distanceMiles(referenceLocation, s),
        // "Featured" until the paid-for window (set by the Stripe webhook,
        // see supabase/schema-v5-featured-listings.sql) actually lapses --
        // the `featured` flag alone can stay true past that date, this is
        // what both the sort below and the badge in SaleCard/ListingSheet
        // actually check.
        isFeatured: Boolean(s.featured && s.featured_until && s.featured_until >= todayKey),
      }))
      .sort((a, b) => {
        if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
        return (a.distance ?? 0) - (b.distance ?? 0);
      });
  }, [sales, selectedDates, searchQuery, referenceLocation]);

  // Favorites are just a flat list of ids -- can be a sale OR a
  // favoritable physical-location ad (see components/AdCard.js). This
  // normalizes an ad into the same {id, title, address, lat, lng} shape
  // SavedScreen/LeafletMap/mapsExport already expect from a sale, tagged
  // `isAd` so the route list can show it a little differently (no
  // date/time -- a store doesn't run on a single sale_date the way a
  // garage sale does).
  const favoritedSales = useMemo(
    () =>
      favorites
        .map((id) => {
          const sale = sales.find((s) => s.id === id);
          if (sale) return sale;
          const ad = ads.find((a) => a.id === id);
          if (ad) {
            return {
              id: ad.id,
              title: ad.title,
              address: ad.address,
              lat: ad.lat,
              lng: ad.lng,
              isAd: true,
            };
          }
          return null;
        })
        .filter(Boolean),
    [favorites, sales, ads]
  );

  function openSaleOnMap(id) {
    // Map only shows/finds sales that pass the current day filter + search
    // box (see filteredSales above) -- fine when you tapped a card that was
    // already showing on Browse, but a listing opened from Account (e.g. a
    // seller previewing their own sale) might run on a day that isn't
    // currently selected, or get hidden by leftover search text. Clear the
    // search and make sure the sale's own date is one of the selected days
    // so it's guaranteed to actually be there when the sheet opens.
    const sale = sales.find((s) => s.id === id);
    setSearchQuery('');
    if (sale) {
      setSelectedDates((prev) => (prev.includes(sale.sale_date) ? prev : [...prev, sale.sale_date]));
    }
    setSelectedSaleId(id);
    setActiveScreen('map');
  }

  // Shared "manage this listing" actions -- used by AccountScreen's My
  // Listings row AND the Map screen's manage menu below, so a seller gets
  // the same Edit/Feature/Delete regardless of where they opened a
  // listing from.

  function isSaleCurrentlyFeatured(sale) {
    return Boolean(sale?.featured && sale?.featured_until && sale.featured_until >= toDateKey(new Date()));
  }

  async function handleDeleteSale(sale) {
    const confirmed = window.confirm(`Delete "${sale.title}"? This can't be undone.`);
    if (!confirmed) return;
    try {
      const { error: deleteError } = await supabase.from('sales').delete().eq('id', sale.id);
      if (deleteError) throw deleteError;

      // Best-effort cleanup of any uploaded photos -- not critical if it fails.
      if (sale.photo_urls && sale.photo_urls.length > 0) {
        const paths = sale.photo_urls.map((url) => url.split('/sale-photos/')[1]).filter(Boolean);
        if (paths.length > 0) {
          supabase.storage.from('sale-photos').remove(paths).catch(() => {});
        }
      }

      setListings((ls) => ls.filter((l) => l.id !== sale.id));
      setSales((ss) => ss.filter((s) => s.id !== sale.id));
      if (selectedSaleId === sale.id) setSelectedSaleId(null);
      if (manageMenuSale?.id === sale.id) setManageMenuSale(null);
      showToast('Listing deleted.');
    } catch (err) {
      showToast(`Couldn't delete that listing: ${err.message}`);
    }
  }

  // Starts a Stripe Checkout Session for pinning this listing to the top
  // of Browse for $10, then redirects the whole tab to Stripe's hosted
  // checkout page. The listing doesn't actually get marked featured until
  // the Stripe webhook confirms payment server-side (see
  // app/api/stripe/webhook/route.js) -- this only ever starts checkout.
  async function handleFeatureSale(sale) {
    setFeaturingId(sale.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Please sign in again.');

      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sale_id: sale.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start checkout.');
      window.location.href = data.url;
    } catch (err) {
      showToast(`Couldn't start checkout: ${err.message}`);
      setFeaturingId(null);
    }
  }

  function handleEditSale(sale) {
    setManageMenuSale(null);
    setSelectedSaleId(null);
    setEditingSale(sale);
    setActiveScreen('account');
  }

  function handleCancelEdit() {
    setEditingSale(null);
  }

  function handleEditDone(message) {
    setEditingSale(null);
    setListingsRefreshKey((k) => k + 1);
    loadSales();
    showToast(message);
  }

  function handlePublished(message) {
    setActiveScreen('browse');
    showToast(message || '🎉 Thanks! Your sale was submitted and is awaiting a quick review before it goes live.');
  }

  return (
    <div className="device">
      <div className="notch" />
      <div className="app-screens">
        <div className={`screen ${activeScreen === 'browse' ? 'active' : ''}`}>
          <BrowseScreen
            sales={filteredSales}
            ads={ads}
            loading={loading}
            loadError={loadError}
            dayOptions={dayOptions}
            selectedDates={selectedDates}
            onToggleDate={toggleDate}
            searchQuery={searchQuery}
            onSearch={setSearchQuery}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onOpenSale={openSaleOnMap}
          />
        </div>
        <div className={`screen ${activeScreen === 'map' ? 'active' : ''}`}>
          <MapScreen
            sales={filteredSales}
            ads={ads}
            favorites={favorites}
            selectedSaleId={selectedSaleId}
            onSelectSale={setSelectedSaleId}
            onToggleFavorite={toggleFavorite}
            favoritedSales={favoritedSales}
            onOpenSaved={() => setActiveScreen('saved')}
            center={referenceLocation}
            active={activeScreen === 'map'}
            session={session}
            onManageListing={(sale) => setManageMenuSale(sale)}
          />
        </div>
        <div className={`screen ${activeScreen === 'post' ? 'active' : ''}`}>
          <PostScreen
            session={session}
            onCancel={() => setActiveScreen('browse')}
            onPublished={handlePublished}
            onGoToAccount={() => setActiveScreen('account')}
          />
        </div>
        <div className={`screen ${activeScreen === 'saved' ? 'active' : ''}`}>
          <SavedScreen
            favoritedSales={favoritedSales}
            onRemove={toggleFavorite}
            onMove={moveFavorite}
            showToast={showToast}
          />
        </div>
        <div className={`screen ${activeScreen === 'account' ? 'active' : ''}`}>
          <AccountScreen
            session={session}
            showToast={showToast}
            onEditingChange={setEditingListing}
            passwordRecovery={passwordRecovery}
            onPasswordRecoveryDone={() => setPasswordRecovery(false)}
            onOpenSale={openSaleOnMap}
            listings={listings}
            listingsLoading={listingsLoading}
            listingsLoadError={listingsLoadError}
            editingSale={editingSale}
            onEditSale={handleEditSale}
            onCancelEdit={handleCancelEdit}
            onEditDone={handleEditDone}
            onDeleteSale={handleDeleteSale}
            onFeatureSale={handleFeatureSale}
            featuringId={featuringId}
          />
        </div>
      </div>

      <BottomNav
        active={activeScreen}
        onChange={setActiveScreen}
        savedCount={favorites.length}
        hidden={editingListing}
      />
      <Toast toast={toast} />

      {manageMenuSale && (
        <div className="manage-menu-backdrop" onClick={() => setManageMenuSale(null)}>
          <div className="manage-menu" onClick={(e) => e.stopPropagation()}>
            <div className="manage-menu-title">{manageMenuSale.title}</div>

            <button
              type="button"
              className="manage-menu-item"
              onClick={() => handleEditSale(manageMenuSale)}
            >
              ✏️ Edit Listing
            </button>

            <a
              className="manage-menu-item"
              href={`/listing/${manageMenuSale.id}/sign`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setManageMenuSale(null)}
            >
              🖨️ Print Sign
            </a>

            <button
              type="button"
              className="manage-menu-item"
              disabled={featuringId === manageMenuSale.id || isSaleCurrentlyFeatured(manageMenuSale)}
              onClick={() => handleFeatureSale(manageMenuSale)}
            >
              {isSaleCurrentlyFeatured(manageMenuSale)
                ? '✓ Currently Featured'
                : featuringId === manageMenuSale.id
                ? 'Starting checkout…'
                : '⭐ Feature — $10'}
            </button>

            <div className="manage-menu-item manage-menu-share" onClick={() => setManageMenuSale(null)}>
              <ShareToFacebookButton
                url={`${SITE_URL}/listing/${manageMenuSale.id}`}
                quote={manageMenuSale.title}
                label="Share"
              />
            </div>

            <button
              type="button"
              className="manage-menu-item danger"
              onClick={() => handleDeleteSale(manageMenuSale)}
            >
              🗑️ Delete
            </button>

            <button type="button" className="manage-menu-cancel" onClick={() => setManageMenuSale(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
