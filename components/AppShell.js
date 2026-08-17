'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { sampleSales, MAP_CENTER } from '@/lib/sampleData';
import { nextNDays, distanceMiles, toDateKey } from '@/lib/format';
import BrowseScreen from './BrowseScreen';
import MapScreen from './MapScreen';
import PostScreen from './PostScreen';
import SavedScreen from './SavedScreen';
import BottomNav from './BottomNav';
import Toast from './Toast';

const FAVORITES_KEY = 'salehop:favorites';

export default function AppShell() {
  const [activeScreen, setActiveScreen] = useState('browse');
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const dayOptions = useMemo(() => nextNDays(7), []);
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState([]);
  const [selectedSaleId, setSelectedSaleId] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message) => {
    setToast({ message, key: Date.now() });
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

  // Load saved favorites (route stops) from this browser -- no account needed.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITES_KEY);
      if (raw) setFavorites(JSON.parse(raw));
    } catch {
      // ignore malformed/blocked storage
    }
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

  const filteredSales = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sales
      .filter((s) => s.sale_date === selectedDate)
      .filter((s) => {
        if (!q) return true;
        return s.title.toLowerCase().includes(q) || s.address.toLowerCase().includes(q);
      })
      .map((s) => ({ ...s, distance: distanceMiles(referenceLocation, s) }))
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  }, [sales, selectedDate, searchQuery, referenceLocation]);

  const favoritedSales = useMemo(
    () => favorites.map((id) => sales.find((s) => s.id === id)).filter(Boolean),
    [favorites, sales]
  );

  function openSaleOnMap(id) {
    setSelectedSaleId(id);
    setActiveScreen('map');
  }

  function handlePublished(message) {
    setActiveScreen('browse');
    showToast(message || 'ðŸŽ‰ Thanks! Your sale was submitted and is awaiting a quick review before it goes live.');
  }

  return (
    <div className="device">
      <div className="notch" />
      <div className="app-screens">
        <div className={`screen ${activeScreen === 'browse' ? 'active' : ''}`}>
          <BrowseScreen
            sales={filteredSales}
            loading={loading}
            loadError={loadError}
            dayOptions={dayOptions}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
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
            favorites={favorites}
            selectedSaleId={selectedSaleId}
            onSelectSale={setSelectedSaleId}
            onToggleFavorite={toggleFavorite}
            favoritedSales={favoritedSales}
            onOpenSaved={() => setActiveScreen('saved')}
            center={referenceLocation}
          />
        </div>
        <div className={`screen ${activeScreen === 'post' ? 'active' : ''}`}>
          <PostScreen onCancel={() => setActiveScreen('browse')} onPublished={handlePublished} showToast={showToast} />
        </div>
        <div className={`screen ${activeScreen === 'saved' ? 'active' : ''}`}>
          <SavedScreen
            favoritedSales={favoritedSales}
            onRemove={toggleFavorite}
            onMove={moveFavorite}
            showToast={showToast}
          />
        </div>
      </div>

      <BottomNav active={activeScreen} onChange={setActiveScreen} savedCount={favorites.length} />
      <Toast toast={toast} />
    </div>
  );
}
