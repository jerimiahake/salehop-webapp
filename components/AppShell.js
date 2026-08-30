'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { sampleSales, MAP_CENTER } from '@/lib/sampleData';
import { nextNDays, distanceMiles, toDateKey, dateInRange } from '@/lib/format';
import BrowseScreen from './BrowseScreen';
import MapScreen from './MapScreen';
import PostScreen from './PostScreen';
import SavedScreen from './SavedScreen';
import AccountScreen from './AccountScreen';
import BottomNav from './BottomNav';
import Toast from './Toast';

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
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load sales (from Supabase once configured, sample data until then).
  useEffect(() => {
    let cancelled = false;

    async function loadSales() {
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

      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setSales([]);
      } else {
        setSales(data || []);
      }
      setLoading(false);
    }

    loadSales();
    return () => {
      cancelled = true;
    };
  }, []);

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
    setSelectedSaleId(id);
    setActiveScreen('map');
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
          <AccountScreen session={session} showToast={showToast} onEditingChange={setEditingListing} />
        </div>
      </div>

      <BottomNav
        active={activeScreen}
        onChange={setActiveScreen}
        savedCount={favorites.length}
        hidden={editingListing}
      />
      <Toast toast={toast} />
    </div>
  );
}
