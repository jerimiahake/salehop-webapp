'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { sampleSales, MAP_CENTER } from '@/lib/sampleData';
import { nextNDays, distanceMiles, toDateKey, dateInRange } from '@/lib/format';
import { SITE_URL } from '@/lib/site';
import { getOrCreateDeviceId } from '@/lib/deviceId';
import BrowseScreen from './BrowseScreen';
import MapScreen from './MapScreen';
import PostScreen from './PostScreen';
import SavedScreen from './SavedScreen';
import AccountScreen from './AccountScreen';
import BottomNav from './BottomNav';
import Toast from './Toast';
import ShareToFacebookButton from './ShareToFacebookButton';
import WelcomeOverlay from './WelcomeOverlay';
import SpottedSaleSheet from './SpottedSaleSheet';

const FAVORITES_KEY = 'salehop:favorites';
const ONBOARDING_KEY = 'salehop:onboardingSeen';

export default function AppShell() {
  const [activeScreen, setActiveScreen] = useState('browse');
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [ads, setAds] = useState([]);
  const [adInterval, setAdInterval] = useState(4);
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

  // First-visit welcome carousel (WelcomeOverlay.js) -- shown once ever per
  // browser, then never again on its own (see ONBOARDING_KEY above).
  // Reachable again anytime via the "❓ What is SaleHop?" link on the
  // Account screen, which calls handleShowWelcome below without touching
  // localStorage -- only dismissing it (Skip or finishing the carousel)
  // writes the "don't auto-show again" flag.
  const [showWelcome, setShowWelcome] = useState(false);

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

  // Crowdsourced "spotted a sale" reporting (schema-v10) -- anyone can tap
  // "🚩 Spot a Sale" on the Map screen to report a sighting from their
  // current location, no account needed. `spottedSales` is the public
  // list of pins (unconfirmed + confirmed); `spotSettings` is the
  // admin-adjustable clustering/confirm radius (see /admin's Spotted
  // Sales settings panel). `liveLocation` is a continuous GPS watch, only
  // running while the Map screen is active, used to notice when someone
  // has physically arrived near an unconfirmed spot -- separate from the
  // one-shot `userLocation` above, which only needs a single fix for
  // distance sorting. `promptedSpottedIds` remembers which spots this
  // browser has already been prompted about this session, so lingering
  // near one doesn't re-prompt every time location updates.
  const [spottedSales, setSpottedSales] = useState([]);
  const [spotSettings, setSpotSettings] = useState({ radiusFt: 300 });
  const [liveLocation, setLiveLocation] = useState(null);
  const [promptedSpottedIds, setPromptedSpottedIds] = useState(() => new Set());
  const [confirmPromptSale, setConfirmPromptSale] = useState(null);
  const [confirmingSpotted, setConfirmingSpotted] = useState(false);
  const [reportingSpot, setReportingSpot] = useState(false);

  // The spotted-sale detail sheet (schema-v11) -- opened by tapping a 🚩
  // pin on the map or a spotted-sale card on Browse. `spottedDetail` holds
  // the full row (photos/notes included) once loaded from
  // GET /api/spotted-sales/[id] -- separate from the lightweight
  // `spottedSales` list above, which only carries counts for the map pins
  // and Browse cards. `contributeSpottedError` is scoped to the sheet's
  // own add-a-photo/note form, distinct from the general `toast`.
  const [selectedSpottedId, setSelectedSpottedId] = useState(null);
  const [spottedDetail, setSpottedDetail] = useState(null);
  const [spottedDetailLoading, setSpottedDetailLoading] = useState(false);
  const [spottedDetailError, setSpottedDetailError] = useState(null);
  const [contributingSpotted, setContributingSpotted] = useState(false);
  const [contributeSpottedError, setContributeSpottedError] = useState(null);

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
  // ads rather than breaking anything. `adsLoaded` (only ever set true on
  // a successful load, see the stale-favorites cleanup effect below) lets
  // that effect know it's safe to treat "not found in `ads`" as "this
  // favorited ad is really gone," rather than "ads just haven't loaded yet."
  const [adsLoaded, setAdsLoaded] = useState(false);
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
        setAdsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Load the ad-frequency setting (how often an ad card is mixed into the
  // Browse list) -- admin-adjustable via schema-v8's `app_settings` table.
  // Falls back to the same default of 4 the app always used if this fails,
  // or if the migration hasn't been run yet, so nothing breaks either way.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let cancelled = false;

    supabase
      .from('app_settings')
      .select('ad_interval')
      .eq('id', 1)
      .single()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        if (Number.isInteger(data.ad_interval) && data.ad_interval > 0) {
          setAdInterval(data.ad_interval);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Load the crowdsourced "spotted a sale" pins (unconfirmed + confirmed --
  // see schema-v10). Pulled out to a stable function, same reasoning as
  // loadSales above, so reporting/confirming one can refresh the list
  // without a full page reload.
  const loadSpottedSales = useCallback(async () => {
    try {
      const res = await fetch('/api/spotted-sales');
      if (!res.ok) return;
      const data = await res.json();
      setSpottedSales(Array.isArray(data) ? data : []);
    } catch {
      // Quietly no-op -- spotted sales are a nice-to-have map overlay,
      // not core to Browse/Map working at all.
    }
  }, []);

  useEffect(() => {
    loadSpottedSales();
  }, [loadSpottedSales]);

  // Load the spotted-sale clustering/confirm radius (schema-v10, admin-
  // adjustable). Kept as its own query, separate from the ad_interval
  // fetch above, so a site that hasn't run this migration yet doesn't
  // also break ad_interval loading (selecting a column that doesn't
  // exist yet would fail the whole query if they were combined).
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let cancelled = false;

    supabase
      .from('app_settings')
      .select('spotted_sale_radius_ft')
      .eq('id', 1)
      .single()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        if (Number.isFinite(data.spotted_sale_radius_ft)) {
          setSpotSettings({ radiusFt: data.spotted_sale_radius_ft });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Continuous location while the Map screen is active -- needed so
  // "Jane driving toward the spot" actually gets noticed as her position
  // updates, unlike the one-shot `userLocation` fix above. Only runs on
  // Map (battery/perf reasons) and stops the moment she navigates away.
  useEffect(() => {
    if (activeScreen !== 'map' || !('geolocation' in navigator)) return undefined;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setLiveLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeScreen]);

  // The actual proximity check -- whenever her live location or the
  // spotted-sales list changes, see if she's now within the confirm
  // radius of an unconfirmed spot she hasn't already been asked about.
  // In-app prompt only (no background push) -- this only ever fires while
  // she has the app open on the Map screen.
  useEffect(() => {
    if (!liveLocation || confirmPromptSale) return;
    const match = spottedSales.find((spot) => {
      if (spot.status !== 'unconfirmed' || promptedSpottedIds.has(spot.id)) return false;
      const distanceFt = (distanceMiles(liveLocation, spot) ?? Infinity) * 5280;
      return distanceFt <= spotSettings.radiusFt;
    });
    if (match) {
      setPromptedSpottedIds((prev) => new Set(prev).add(match.id));
      setConfirmPromptSale(match);
    }
  }, [liveLocation, spottedSales, spotSettings, confirmPromptSale, promptedSpottedIds]);

  // Load saved favorites (route stops) from this browser -- no account needed.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITES_KEY);
      if (raw) setFavorites(JSON.parse(raw));
    } catch {
      // ignore malformed/blocked storage
    }
  }, []);

  // Show the first-visit welcome carousel unless this browser has already
  // dismissed it (or storage is blocked/unavailable -- in that case it just
  // won't auto-show, same fail-safe-quiet approach as favorites above).
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(ONBOARDING_KEY)) {
        setShowWelcome(true);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleDismissWelcome = useCallback(() => {
    setShowWelcome(false);
    try {
      window.localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  // Reopen on demand (Account screen's "❓ What is SaleHop?" link) --
  // doesn't touch localStorage, so dismissing it again afterward doesn't
  // change anything about the automatic first-visit behavior.
  const handleShowWelcome = useCallback(() => setShowWelcome(true), []);

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

  // A favorited sale can go stale two different ways, and both used to
  // leave a permanent "phantom" entry in `favorites` (the raw id list
  // persisted to localStorage) with no in-app way to ever un-star it
  // again, since there's nothing left to tap the star on: (1) it gets
  // deleted or un-approved entirely (a seller removes it, or /admin
  // rejects it after the fact), or (2) -- reported directly by Jerimiah,
  // and the more common case day-to-day -- its sale_date/end_date simply
  // passes, since sales are never auto-deleted (they just fall out of
  // Browse's day-pill filter on their own, see build_status's "no
  // automatic listing expiry" note) so an old approved sale sticks around
  // in the database, and used to stick around in Your Route, forever.
  // Either way, the Saved nav badge (`favorites.length`) kept counting it
  // forever while Your Route (`favoritedSales` above) showed fewer real
  // stops than that badge claimed -- all the way down to a confusingly
  // empty screen if every favorite had gone stale. Once both sales and ads
  // have loaded for real (not just their empty initial state), this
  // quietly drops any favorited sale whose last day has passed, or any
  // favorited id that no longer matches a sale OR an ad at all -- a
  // physical-location ad (a store, not a one-time event) never expires by
  // date, so those are only ever dropped for reason (1).
  useEffect(() => {
    if (loading || !adsLoaded || favorites.length === 0) return;
    const todayKey = toDateKey(new Date());
    const adIds = new Set(ads.map((a) => a.id));
    const salesById = new Map(sales.map((s) => [s.id, s]));
    const pruned = favorites.filter((id) => {
      if (adIds.has(id)) return true;
      const sale = salesById.get(id);
      if (!sale) return false;
      return (sale.end_date || sale.sale_date) >= todayKey;
    });
    // Only ever persists when something actually got dropped, so once
    // `favorites` reflects the pruned list this converges immediately
    // instead of looping -- safe to depend on `favorites` here even
    // though this effect is also what changes it.
    if (pruned.length !== favorites.length) {
      persistFavorites(pruned);
    }
  }, [loading, adsLoaded, sales, ads, favorites, persistFavorites]);

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

  // Same list Map already shows as pins, but sorted by distance for
  // Browse's list-view cards (SpottedSaleCard.js) -- the API's GET already
  // excludes rejected/stale-unconfirmed spots, this just adds `distance`
  // and orders them the same way real listings are ordered below.
  const spottedSalesForBrowse = useMemo(
    () =>
      spottedSales
        .map((spot) => ({ ...spot, distance: distanceMiles(referenceLocation, spot) }))
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity)),
    [spottedSales, referenceLocation]
  );

  // Order ads closest-first for whoever's browsing, not by whatever order
  // they happen to come back from Supabase (previously just insertion
  // order, effectively random from a buyer's perspective). A small random
  // "jitter" is added to each physical ad's distance before sorting -- a
  // few miles' worth -- so two/three similarly-close places don't always
  // show up in the exact same order every time, without letting a
  // genuinely far-away one jump ahead of a genuinely close one. Ads with
  // no real location yet (online-only, or a physical ad that hasn't been
  // geocoded via the /admin edit-and-save step -- see AdCard.js) have no
  // proximity to sort by, so those are just shuffled and placed after the
  // location-sorted ones.
  const JITTER_MILES = 3;
  const orderedAds = useMemo(() => {
    if (!ads || ads.length === 0) return ads;
    const withLocation = [];
    const withoutLocation = [];
    ads.forEach((ad) => {
      const hasLocation = ad.location_type === 'physical' && Number.isFinite(ad.lat) && Number.isFinite(ad.lng);
      if (hasLocation) {
        const distance = distanceMiles(referenceLocation, ad) ?? 0;
        withLocation.push({ ad, sortKey: distance + Math.random() * JITTER_MILES });
      } else {
        withoutLocation.push({ ad, sortKey: Math.random() });
      }
    });
    withLocation.sort((a, b) => a.sortKey - b.sortKey);
    withoutLocation.sort((a, b) => a.sortKey - b.sortKey);
    return [...withLocation, ...withoutLocation].map((x) => x.ad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ads, referenceLocation]);

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

  // "🚩 Spot a Sale" on the Map screen -- Bob's side of the crowdsourced
  // flow. Grabs a fresh GPS fix and reports it; the server does the
  // clustering (merge into a nearby existing report, or start a new pin)
  // and tells us whether this just crossed the auto-confirm threshold.
  const handleReportSpot = useCallback(() => {
    if (!('geolocation' in navigator)) {
      showToast("Your browser doesn't support location -- can't report a sale from here.");
      return;
    }
    setReportingSpot(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const deviceId = getOrCreateDeviceId();
          const res = await fetch('/api/spotted-sales', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude, deviceId }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not report that sale.');
          if (data.alreadyReported) {
            showToast("You've already reported a sale near here -- thanks!");
          } else if (data.justConfirmed) {
            showToast('🎉 Enough people have reported this spot -- it just got confirmed!');
          } else {
            showToast('🚩 Thanks! Reported -- someone driving by can go confirm it.');
          }
          loadSpottedSales();
        } catch (err) {
          showToast(`Couldn't report that: ${err.message}`);
        } finally {
          setReportingSpot(false);
        }
      },
      () => {
        showToast('Location access is needed to report a sale.');
        setReportingSpot(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [showToast, loadSpottedSales]);

  // Jane's side -- responds to the proximity prompt below. `accept=false`
  // just dismisses it (already marked "prompted" so it won't nag again
  // this session); `accept=true` grabs her current precise location and
  // sends it as the confirmation, which also becomes the spot's new,
  // presumably more accurate, location.
  const handleConfirmSpotted = useCallback(
    (accept) => {
      if (!accept) {
        setConfirmPromptSale(null);
        return;
      }
      if (!confirmPromptSale) return;
      if (!('geolocation' in navigator)) {
        showToast("Your browser doesn't support location -- can't confirm from here.");
        setConfirmPromptSale(null);
        return;
      }
      setConfirmingSpotted(true);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const res = await fetch(`/api/spotted-sales/${confirmPromptSale.id}/confirm`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not confirm that sale.');
            showToast(
              data.alreadyDone ? 'Someone already confirmed this one -- thanks anyway!' : '🎉 Thanks -- confirmed!'
            );
            loadSpottedSales();
          } catch (err) {
            showToast(`Couldn't confirm: ${err.message}`);
          } finally {
            setConfirmingSpotted(false);
            setConfirmPromptSale(null);
          }
        },
        () => {
          showToast('Location access is needed to confirm a sale.');
          setConfirmingSpotted(false);
          setConfirmPromptSale(null);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    },
    [confirmPromptSale, showToast, loadSpottedSales]
  );

  // Opens the spotted-sale detail sheet (map pin tap, or a Browse card
  // tap) and loads its full detail (photos/notes) -- the list-view data
  // in `spottedSales` only ever carries counts, not the actual content.
  const handleOpenSpotted = useCallback((id) => {
    setSelectedSpottedId(id);
    setSpottedDetail(null);
    setSpottedDetailError(null);
    setContributeSpottedError(null);
    setSpottedDetailLoading(true);
    fetch(`/api/spotted-sales/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load that.');
        setSpottedDetail(data);
      })
      .catch((err) => setSpottedDetailError(err.message))
      .finally(() => setSpottedDetailLoading(false));
  }, []);

  const handleCloseSpotted = useCallback(() => {
    setSelectedSpottedId(null);
    setSpottedDetail(null);
    setSpottedDetailError(null);
    setContributeSpottedError(null);
  }, []);

  // Best-effort current location for the "prove you're here" check on a
  // photo/note contribution below -- unlike handleReportSpot/
  // handleConfirmSpotted (which show an error and bail if location isn't
  // available), this one quietly resolves to null instead: a contribution
  // with a photo can still be verified purely from that photo's own EXIF
  // GPS data server-side, so missing live location shouldn't block it
  // outright -- the API route is what ultimately decides if either signal
  // was good enough.
  function getCurrentPositionSafe(timeout = 10000) {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout }
      );
    });
  }

  // Anyone who proves they're at a spotted sale can add a photo and/or a
  // note, at any time, and it shows up immediately (server-side rules in
  // app/api/spotted-sales/[id]/photos/route.js) -- returns true/false so
  // SpottedSaleSheet.js knows whether to clear its form.
  const handleContributeSpotted = useCallback(
    async ({ file, note }) => {
      if (!selectedSpottedId) return false;
      setContributingSpotted(true);
      setContributeSpottedError(null);
      try {
        const location = await getCurrentPositionSafe();
        const formData = new FormData();
        if (file) formData.append('file', file);
        if (note) formData.append('note', note);
        if (location) {
          formData.append('lat', String(location.lat));
          formData.append('lng', String(location.lng));
        }

        const res = await fetch(`/api/spotted-sales/${selectedSpottedId}/photos`, {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not add that.');

        setSpottedDetail(data);
        loadSpottedSales();
        showToast('✅ Added -- thanks for helping out!');
        return true;
      } catch (err) {
        setContributeSpottedError(err.message);
        return false;
      } finally {
        setContributingSpotted(false);
      }
    },
    [selectedSpottedId, loadSpottedSales, showToast]
  );

  return (
    <div className="device">
      <div className="notch" />
      <div className="app-screens">
        <div className={`screen ${activeScreen === 'browse' ? 'active' : ''}`}>
          <BrowseScreen
            sales={filteredSales}
            ads={orderedAds}
            adInterval={adInterval}
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
            spottedSales={spottedSalesForBrowse}
            onOpenSpotted={handleOpenSpotted}
          />
        </div>
        <div className={`screen ${activeScreen === 'map' ? 'active' : ''}`}>
          <MapScreen
            sales={filteredSales}
            ads={ads}
            spottedSales={spottedSales}
            favorites={favorites}
            selectedSaleId={selectedSaleId}
            onSelectSale={setSelectedSaleId}
            onSelectSpotted={handleOpenSpotted}
            onToggleFavorite={toggleFavorite}
            favoritedSales={favoritedSales}
            onOpenSaved={() => setActiveScreen('saved')}
            center={referenceLocation}
            active={activeScreen === 'map'}
            session={session}
            onManageListing={(sale) => setManageMenuSale(sale)}
            onReportSpot={handleReportSpot}
            reportingSpot={reportingSpot}
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
            onShowWelcome={handleShowWelcome}
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

      {confirmPromptSale && (
        <div className="manage-menu-backdrop" onClick={() => !confirmingSpotted && handleConfirmSpotted(false)}>
          <div className="manage-menu" onClick={(e) => e.stopPropagation()}>
            <div className="manage-menu-title">Spotted sale nearby</div>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', textAlign: 'center', margin: '0 0 4px' }}>
              Looks like you&apos;re near a sale someone reported. Are you here?
            </p>
            <button
              type="button"
              className="manage-menu-item"
              disabled={confirmingSpotted}
              onClick={() => handleConfirmSpotted(true)}
            >
              {confirmingSpotted ? 'Confirming…' : '✅ Yes, I found it'}
            </button>
            <button
              type="button"
              className="manage-menu-cancel"
              disabled={confirmingSpotted}
              onClick={() => handleConfirmSpotted(false)}
            >
              Not here
            </button>
          </div>
        </div>
      )}

      {selectedSpottedId && (
        <SpottedSaleSheet
          spot={spottedDetail}
          loading={spottedDetailLoading}
          error={spottedDetailError}
          onClose={handleCloseSpotted}
          onContribute={handleContributeSpotted}
          contributing={contributingSpotted}
          contributeError={contributeSpottedError}
        />
      )}

      {showWelcome && <WelcomeOverlay onDismiss={handleDismissWelcome} />}
    </div>
  );
}
