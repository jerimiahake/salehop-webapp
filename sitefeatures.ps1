# Adds ads, neighborhood sales, and Facebook sharing to SaleHop:
#   - Sponsored "ad" cards mixed into the Browse list (highlighted, no
#     address, clearly marked "AD")
#   - A "part of a neighborhood sale" checkbox on the Post form, with
#     autocomplete of neighborhood names other sellers already used
#   - A real, individually-shareable page for each approved sale
#     (salehop.app/listing/...), with a "Share to Facebook" button --
#     shown right after posting (once approved) and from My Listings
#
# This is step 1 of 2 -- run admin-content.ps1 afterward to get the
# "+ Add Listing" / "+ Add Ad" buttons in the admin panel.
#
# IMPORTANT: before running this, open
# supabase-schema-v3-ads-and-neighborhoods.sql (delivered alongside this
# script) in the Supabase SQL Editor and click Run. This script only
# changes app code -- the database needs that SQL change first.
#
# Safe to re-run if something fails partway through.

$projectPath = "C:\Users\Bastian\Documents\WebDesign\SaleHop-app\salehopproject\salehop"

Write-Host "Moving into $projectPath ..." -ForegroundColor Cyan
if (-not (Test-Path $projectPath)) {
    Write-Host "ERROR: That folder doesn't exist. Double-check the path and edit it at the top of this script." -ForegroundColor Red
    exit 1
}
Set-Location $projectPath

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: git isn't installed (or not on PATH)." -ForegroundColor Red
    exit 1
}

Write-Host "Copying supabase/schema-v3-ads-and-neighborhoods.sql into the repo (for reference/history) ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "supabase" | Out-Null
if (Test-Path ".\supabase-schema-v3-ads-and-neighborhoods.sql") {
    Copy-Item ".\supabase-schema-v3-ads-and-neighborhoods.sql" "supabase\schema-v3-ads-and-neighborhoods.sql" -Force
} else {
    Write-Host "  (supabase-schema-v3-ads-and-neighborhoods.sql not found next to this script -- skipping, not required for the app to work)" -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path "lib" | Out-Null
New-Item -ItemType Directory -Force -Path "components" | Out-Null
New-Item -ItemType Directory -Force -Path "app\api\neighborhood-suggest" | Out-Null
New-Item -ItemType Directory -Force -Path "app\api\admin\sales" | Out-Null

Write-Host "Writing lib\site.js ..." -ForegroundColor Cyan
@'
// The site's canonical production URL, used anywhere a full, shareable
// link is needed (Facebook share links, Open Graph metadata for the
// listing detail pages). Centralized here so there's exactly one place to
// change it if the domain ever changes.
export const SITE_URL = 'https://salehop.app';
'@ | Set-Content -Encoding UTF8 "lib\site.js"

Write-Host "Writing lib\getSaleForShare.js ..." -ForegroundColor Cyan
@'
import { cache } from 'react';
import { createClient } from '@supabase/supabase-js';

// Server-only fetch used by the /listing/[id] share page. Wrapped in
// React's `cache()` so that generateMetadata() and the page component --
// which both need the same sale -- only actually hit Supabase once per
// request instead of twice.
//
// Uses the public anon key (not the service-role key), so it's naturally
// restricted by the same "Public can view approved sales" RLS policy the
// rest of the site's anonymous visitors use -- a listing only becomes
// shareable once it's been approved. This file is only ever imported from
// server components/functions (never a 'use client' file), so that's safe.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const getSaleForShare = cache(async function getSaleForShare(id) {
  if (!supabaseUrl || !supabaseAnonKey || !id) return null;

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });

  const { data } = await client
    .from('sales')
    .select('*')
    .eq('id', id)
    .eq('status', 'approved')
    .maybeSingle();

  return data || null;
});
'@ | Set-Content -Encoding UTF8 "lib\getSaleForShare.js"

Write-Host "Writing components\ShareToFacebookButton.js ..." -ForegroundColor Cyan
@'
'use client';

// A plain-link share button -- no Facebook SDK, no app registration, no
// login required. Facebook's sharer.php endpoint just needs a public URL
// (it fetches that page's Open Graph tags itself to build the preview),
// so this works for free with zero setup and no ongoing cost.
export default function ShareToFacebookButton({ url, quote, className, label = 'Share to Facebook' }) {
  function handleShare() {
    const params = new URLSearchParams({ u: url });
    if (quote) params.set('quote', quote);
    const shareUrl = `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
    window.open(shareUrl, 'salehop-fb-share', 'width=580,height=520,noopener,noreferrer');
  }

  return (
    <button type="button" className={className || 'fb-share-btn'} onClick={handleShare}>
      📘 {label}
    </button>
  );
}
'@ | Set-Content -Encoding UTF8 "components\ShareToFacebookButton.js"

Write-Host "Writing components\AdCard.js ..." -ForegroundColor Cyan
@'
'use client';

// Styled to echo SaleCard's layout (so it fits naturally in the scrolling
// list) but visually distinct: a highlighted gold background/border and an
// "AD" badge, no address (it's not a real sale), and tapping it opens the
// sponsor's link in a new tab instead of previewing on the map.
export default function AdCard({ ad }) {
  const cover = ad.image_url || null;

  function handleClick() {
    window.open(ad.link_url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="card ad-card" onClick={handleClick}>
      <div className="thumb" style={{ background: '#FCE9B8' }}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" />
        ) : (
          '📣'
        )}
      </div>
      <div className="card-body">
        <p className="card-title">{ad.title}</p>
        {ad.sponsor_name && <p className="ad-sponsor">Sponsored by {ad.sponsor_name}</p>}
        <div className="card-meta">
          <span className="ad-badge">AD</span>
        </div>
      </div>
    </div>
  );
}
'@ | Set-Content -Encoding UTF8 "components\AdCard.js"

Write-Host "Writing components\SaleCard.js ..." -ForegroundColor Cyan
@'
'use client';

import { formatTimeRange } from '@/lib/format';

export default function SaleCard({ sale, favorited, routeNum, onClick, onToggleFavorite, onFilterNeighborhood }) {
  const time = sale.time || (sale.start_time ? formatTimeRange(sale.start_time, sale.end_time) : '');
  const cover = sale.photo_urls && sale.photo_urls.length > 0 ? sale.photo_urls[0] : null;

  return (
    <div className={`card ${favorited ? 'favorited' : ''}`} onClick={onClick}>
      {favorited && <div className="route-num">{routeNum}</div>}
      <div className="thumb" style={{ background: favorited ? '#e4f0e6' : '#faf1d8' }}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" />
        ) : (
          sale.icon || '🏷️'
        )}
      </div>
      <div className="card-body">
        <p className="card-title">{sale.title}</p>
        <p className="card-addr">
          {sale.address}
          {Number.isFinite(sale.distance) ? ` · ${sale.distance.toFixed(1)} mi` : ''}
        </p>
        <div className="card-meta">
          <span className="time-badge mono">{time}</span>
          {(sale.tags || []).map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
        </div>
        {sale.is_neighborhood_sale && sale.neighborhood_name && (
          <button
            type="button"
            className="neighborhood-badge"
            onClick={(e) => {
              e.stopPropagation();
              onFilterNeighborhood?.(sale.neighborhood_name);
            }}
          >
            🏘️ Part of {sale.neighborhood_name}
          </button>
        )}
      </div>
      <button
        type="button"
        className={`fav-btn ${favorited ? 'on' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(sale.id);
        }}
        aria-label={favorited ? 'Remove from route' : 'Add to route'}
      >
        ★
      </button>
    </div>
  );
}
'@ | Set-Content -Encoding UTF8 "components\SaleCard.js"

Write-Host "Writing components\BrowseScreen.js ..." -ForegroundColor Cyan
@'
'use client';

import SaleCard from './SaleCard';
import AdCard from './AdCard';

// How often an ad card appears in the scrolling list -- every 4th real
// listing. Ads never appear if there are zero matching sales (nothing to
// interleave between), so a slow day never turns into an ads-only list.
const AD_INTERVAL = 4;

function buildFeed(sales, ads) {
  const feed = sales.map((sale) => ({ type: 'sale', sale }));
  if (!ads || ads.length === 0 || sales.length === 0) return feed;

  const withAds = [];
  let adIdx = 0;
  feed.forEach((item, i) => {
    withAds.push(item);
    if ((i + 1) % AD_INTERVAL === 0) {
      withAds.push({ type: 'ad', ad: ads[adIdx % ads.length], key: `ad-${i}` });
      adIdx += 1;
    }
  });
  return withAds;
}

export default function BrowseScreen({
  sales,
  ads,
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
  const feed = buildFeed(sales, ads);

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
              return <AdCard key={item.key} ad={item.ad} />;
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
'@ | Set-Content -Encoding UTF8 "components\BrowseScreen.js"

Write-Host "Writing components\ListingForm.js ..." -ForegroundColor Cyan
@'
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { geocodeAddress, suggestAddress } from '@/lib/geocode';
import { nextNDays } from '@/lib/format';
import { SITE_URL } from '@/lib/site';
import ShareToFacebookButton from './ShareToFacebookButton';

const TAG_OPTIONS = ['Furniture', 'Kids', 'Tools', 'Vintage', 'Multi-Family', 'Books', 'Decor', 'Clothing'];

// How long to wait after the user stops typing before asking for address
// suggestions, and the minimum number of characters before we bother.
// OpenStreetMap's free Nominatim geocoder (same one used to place the pin
// on submit) asks apps not to fire a request on every keystroke, so this
// stays deliberately gentle rather than instant.
const SUGGEST_DEBOUNCE_MS = 700;
const SUGGEST_MIN_LENGTH = 5;

// The neighborhood-name lookup is our own database (cheap, no external
// usage policy to respect), so this can be quicker/looser than the address
// suggestions above.
const NEIGHBORHOOD_DEBOUNCE_MS = 400;
const NEIGHBORHOOD_MIN_LENGTH = 2;

function blankForm(dayOptions) {
  return {
    title: '',
    address: '',
    location: null, // { lat, lng } once a suggestion has been picked / verified
    day: dayOptions[0]?.date || '',
    customDate: '',
    startTime: '09:00',
    endTime: '13:00',
    tags: [],
    description: '',
    isNeighborhoodSale: false,
    neighborhoodName: '',
  };
}

// Turns a saved sale row back into form state for editing. If the sale's
// date happens to be outside the rolling 7-day pill range (further out, or
// in the past), we fall back to the "Pick date..." custom option so we
// never silently change a date the seller didn't touch.
function formFromSale(sale, dayOptions) {
  const dateKey = sale.sale_date;
  const inRange = dayOptions.some((opt) => opt.date === dateKey);
  return {
    title: sale.title || '',
    address: sale.address || '',
    location: Number.isFinite(sale.lat) && Number.isFinite(sale.lng) ? { lat: sale.lat, lng: sale.lng } : null,
    day: inRange ? dateKey : 'CUSTOM',
    customDate: inRange ? '' : dateKey,
    startTime: (sale.start_time || '09:00').slice(0, 5),
    endTime: (sale.end_time || '13:00').slice(0, 5),
    tags: sale.tags || [],
    description: sale.description || '',
    isNeighborhoodSale: sale.is_neighborhood_sale || false,
    neighborhoodName: sale.neighborhood_name || '',
  };
}

// The shared listing form. Three modes:
//   "create"       -- a signed-in seller posting their own new sale
//                      (goes in as 'pending', awaiting review)
//   "edit"         -- a seller editing their own existing sale
//                      (goes live immediately, no session needed beyond
//                      already having one -- ownership is enforced by RLS)
//   "admin-create" -- the admin panel adding a listing directly. Posts
//                      through the admin API (service role) instead of the
//                      public client, and comes back already 'approved'.
// Handles its own address-autocomplete, neighborhood-name autocomplete,
// date pills, tag/photo pickers, and submit.
export default function ListingForm({ mode, session, initialSale, onDone, onCancel }) {
  const dayOptions = useMemo(() => nextNDays(7), []);
  const isEdit = mode === 'edit';
  const isAdminCreate = mode === 'admin-create';

  const [form, setForm] = useState(() =>
    isEdit && initialSale ? formFromSale(initialSale, dayOptions) : blankForm(dayOptions)
  );
  const [photos, setPhotos] = useState([]); // new, not-yet-uploaded photos: { file, previewUrl }
  const [existingPhotoUrls, setExistingPhotoUrls] = useState(
    isEdit && initialSale ? initialSale.photo_urls || [] : []
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [justCreated, setJustCreated] = useState(null); // { id, title, status, doneMessage } | null

  const [suggestions, setSuggestions] = useState([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const addressWrapRef = useRef(null);

  const [neighborhoodSuggestions, setNeighborhoodSuggestions] = useState([]);
  const [neighborhoodSuggestOpen, setNeighborhoodSuggestOpen] = useState(false);
  const neighborhoodDebounceRef = useRef(null);
  const neighborhoodAbortRef = useRef(null);
  const neighborhoodWrapRef = useRef(null);

  const totalPhotoCount = photos.length + existingPhotoUrls.length;

  // Close either suggestions dropdown on outside click.
  useEffect(() => {
    function handleClickOutside(e) {
      if (addressWrapRef.current && !addressWrapRef.current.contains(e.target)) {
        setSuggestOpen(false);
      }
      if (neighborhoodWrapRef.current && !neighborhoodWrapRef.current.contains(e.target)) {
        setNeighborhoodSuggestOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cancel any in-flight timers/requests if the screen unmounts mid-type.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
      if (neighborhoodDebounceRef.current) clearTimeout(neighborhoodDebounceRef.current);
      if (neighborhoodAbortRef.current) neighborhoodAbortRef.current.abort();
    };
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleAddressChange(value) {
    // Typing invalidates any previously-picked/known location -- address
    // and location must travel together so we never save mismatched coords.
    setForm((f) => ({ ...f, address: value, location: null }));
    setHighlightedIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    const trimmed = value.trim();
    if (trimmed.length < SUGGEST_MIN_LENGTH) {
      setSuggestions([]);
      setSuggestOpen(false);
      setSuggestLoading(false);
      return;
    }

    setSuggestLoading(true);
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const results = await suggestAddress(trimmed, controller.signal);
        setSuggestions(results);
        setSuggestOpen(results.length > 0);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setSuggestions([]);
          setSuggestOpen(false);
        }
      } finally {
        setSuggestLoading(false);
      }
    }, SUGGEST_DEBOUNCE_MS);
  }

  function pickSuggestion(s) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
    setForm((f) => ({ ...f, address: s.label, location: { lat: s.lat, lng: s.lng } }));
    setSuggestions([]);
    setSuggestOpen(false);
    setSuggestLoading(false);
    setHighlightedIndex(-1);
  }

  function handleAddressKeyDown(e) {
    if (!suggestOpen || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0) {
        e.preventDefault();
        pickSuggestion(suggestions[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setSuggestOpen(false);
    }
  }

  function handleNeighborhoodChange(value) {
    update('neighborhoodName', value);

    if (neighborhoodDebounceRef.current) clearTimeout(neighborhoodDebounceRef.current);
    if (neighborhoodAbortRef.current) neighborhoodAbortRef.current.abort();

    const trimmed = value.trim();
    if (trimmed.length < NEIGHBORHOOD_MIN_LENGTH) {
      setNeighborhoodSuggestions([]);
      setNeighborhoodSuggestOpen(false);
      return;
    }

    neighborhoodDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      neighborhoodAbortRef.current = controller;
      try {
        const res = await fetch(`/api/neighborhood-suggest?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const names = res.ok ? await res.json() : [];
        setNeighborhoodSuggestions(names);
        setNeighborhoodSuggestOpen(names.length > 0);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setNeighborhoodSuggestions([]);
          setNeighborhoodSuggestOpen(false);
        }
      }
    }, NEIGHBORHOOD_DEBOUNCE_MS);
  }

  function pickNeighborhood(name) {
    if (neighborhoodDebounceRef.current) clearTimeout(neighborhoodDebounceRef.current);
    if (neighborhoodAbortRef.current) neighborhoodAbortRef.current.abort();
    update('neighborhoodName', name);
    setNeighborhoodSuggestions([]);
    setNeighborhoodSuggestOpen(false);
  }

  function toggleTag(tag) {
    setForm((f) => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag],
    }));
  }

  function addPhoto(e) {
    const room = 6 - totalPhotoCount;
    const files = Array.from(e.target.files || []).slice(0, Math.max(room, 0));
    const next = files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    setPhotos((p) => [...p, ...next]);
    e.target.value = '';
  }

  function removeNewPhoto(idx) {
    setPhotos((p) => p.filter((_, i) => i !== idx));
  }

  function removeExistingPhoto(url) {
    setExistingPhotoUrls((urls) => urls.filter((u) => u !== url));
  }

  async function handleSubmit() {
    setError(null);

    if (!form.title.trim() || !form.address.trim()) {
      setError('Please add a title and address.');
      return;
    }

    const saleDate = form.day === 'CUSTOM' ? form.customDate : form.day;
    if (!saleDate) {
      setError('Please pick a date.');
      return;
    }

    if (form.isNeighborhoodSale && !form.neighborhoodName.trim()) {
      setError('Please enter your neighborhood sale’s name, or uncheck the box above.');
      return;
    }

    setSubmitting(true);
    try {
      // If we already know exactly where this is (picked a suggestion, or
      // editing a sale that was already geocoded and the address wasn't
      // touched), skip re-geocoding. Otherwise look it up.
      const location = form.location || (await geocodeAddress(form.address));
      if (!location) {
        setError("We couldn't find that address on the map. Double-check it and try again.");
        setSubmitting(false);
        return;
      }

      if (!isSupabaseConfigured) {
        if (isAdminCreate) {
          setError('Supabase isn’t connected yet — creating a listing needs a live database connection.');
          setSubmitting(false);
          return;
        }
        onDone(
          isEdit
            ? 'Preview mode: Supabase isn’t connected yet, so this edit wasn’t actually saved.'
            : 'Preview mode: Supabase isn’t connected yet, so this wasn’t actually saved. See the README to connect it.'
        );
        return;
      }

      let newPhotoUrls = [];
      if (photos.length > 0) {
        const uploads = await Promise.all(
          photos.map(async ({ file }) => {
            const path = `${crypto.randomUUID()}-${file.name}`;
            const { error: uploadError } = await supabase.storage.from('sale-photos').upload(path, file);
            if (uploadError) throw uploadError;
            const { data } = supabase.storage.from('sale-photos').getPublicUrl(path);
            return data.publicUrl;
          })
        );
        newPhotoUrls = uploads;
      }

      const photoUrls = [...existingPhotoUrls, ...newPhotoUrls];
      const neighborhoodName = form.isNeighborhoodSale ? form.neighborhoodName.trim() : null;

      if (isEdit) {
        const { error: updateError } = await supabase
          .from('sales')
          .update({
            title: form.title.trim(),
            address: form.address.trim(),
            lat: location.lat,
            lng: location.lng,
            sale_date: saleDate,
            start_time: form.startTime,
            end_time: form.endTime,
            tags: form.tags,
            description: form.description.trim() || null,
            photo_urls: photoUrls,
            is_neighborhood_sale: form.isNeighborhoodSale,
            neighborhood_name: neighborhoodName,
            // status is intentionally omitted -- a database trigger blocks
            // sellers from changing it anyway, and edits go live immediately
            // at whatever status the listing already had.
          })
          .eq('id', initialSale.id);

        if (updateError) throw updateError;

        onDone('✅ Listing updated.');
      } else if (isAdminCreate) {
        const res = await fetch('/api/admin/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: form.title.trim(),
            address: form.address.trim(),
            lat: location.lat,
            lng: location.lng,
            sale_date: saleDate,
            start_time: form.startTime,
            end_time: form.endTime,
            tags: form.tags,
            description: form.description.trim() || null,
            photo_urls: photoUrls,
            is_neighborhood_sale: form.isNeighborhoodSale,
            neighborhood_name: neighborhoodName,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create listing.');

        setJustCreated({
          id: data.id,
          title: data.title,
          status: data.status,
          doneMessage: '✅ Listing created and live.',
        });
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('sales')
          .insert({
            title: form.title.trim(),
            address: form.address.trim(),
            lat: location.lat,
            lng: location.lng,
            sale_date: saleDate,
            start_time: form.startTime,
            end_time: form.endTime,
            tags: form.tags,
            description: form.description.trim() || null,
            photo_urls: photoUrls,
            is_neighborhood_sale: form.isNeighborhoodSale,
            neighborhood_name: neighborhoodName,
            status: 'pending',
            user_id: session.user.id,
          })
          .select()
          .single();

        if (insertError) throw insertError;

        setJustCreated({
          id: inserted.id,
          title: inserted.title,
          status: inserted.status,
          doneMessage: '🎉 Thanks! Your sale was submitted and is awaiting a quick review before it goes live.',
        });
      }
    } catch (err) {
      setError(err.message || 'Something went wrong saving your sale.');
    } finally {
      setSubmitting(false);
    }
  }

  // ---------- Success screen (create + admin-create only) ----------
  if (justCreated) {
    const isLive = justCreated.status === 'approved';
    return (
      <>
        <div className="post-header">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onDone(justCreated.doneMessage)}
            aria-label="Close"
          >
            ✕
          </button>
          <div className="title">{isLive ? 'Listing Live!' : 'Sale Submitted'}</div>
        </div>

        <div className="post-scroll share-success">
          <div className="share-success-icon">{isLive ? '✅' : '🎉'}</div>
          <p className="card-title share-success-title">{justCreated.title}</p>
          <p className="hint share-success-hint">
            {isLive
              ? 'Your listing is live on SaleHop right now.'
              : "Thanks! Your sale was submitted and is awaiting a quick review. Once it's approved, you'll be able to share it from My Listings."}
          </p>

          {isLive && (
            <div className="share-success-actions">
              <ShareToFacebookButton url={`${SITE_URL}/listing/${justCreated.id}`} quote={justCreated.title} />
              <a className="chip" style={{ textAlign: 'center' }} href={`/listing/${justCreated.id}`} target="_blank" rel="noopener noreferrer">
                View Listing Page ↗
              </a>
            </div>
          )}
        </div>

        <div className="publish-bar">
          <button type="button" className="publish-btn" onClick={() => onDone(justCreated.doneMessage)}>
            Done
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="post-header">
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cancel">
          ✕
        </button>
        <div className="title">{isEdit ? 'Edit Your Sale' : isAdminCreate ? 'Add a Listing' : 'Post a Garage Sale'}</div>
      </div>

      <div className="post-scroll">
        <div className="field-group">
          <p className="field-label">Sale Title</p>
          <input
            className="text-input"
            placeholder="e.g. Whitfield Family Multi-Home Sale"
            value={form.title}
            onChange={(e) => update('title', e.target.value)}
          />
        </div>

        <div className="field-group">
          <p className="field-label">📍 Address</p>
          <div className="address-field" ref={addressWrapRef}>
            <input
              className="text-input"
              placeholder="Start typing your street address…"
              value={form.address}
              autoComplete="off"
              onChange={(e) => handleAddressChange(e.target.value)}
              onKeyDown={handleAddressKeyDown}
              onFocus={() => {
                if (suggestions.length > 0) setSuggestOpen(true);
              }}
            />
            {suggestLoading && <div className="address-spinner" aria-hidden="true" />}

            {suggestOpen && suggestions.length > 0 && (
              <ul className="address-suggestions">
                {suggestions.map((s, i) => (
                  <li key={`${s.lat},${s.lng}`}>
                    <button
                      type="button"
                      className={`address-suggestion ${i === highlightedIndex ? 'highlighted' : ''}`}
                      onMouseDown={(e) => e.preventDefault()} // keep the input focused so onBlur doesn't fire first
                      onClick={() => pickSuggestion(s)}
                      onMouseEnter={() => setHighlightedIndex(i)}
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {form.location ? (
            <p className="hint address-verified">✓ Address verified — we&apos;ll drop a pin here exactly.</p>
          ) : (
            <p className="hint">Pick a suggestion for the most accurate pin, or type the full address and we&apos;ll look it up when you publish.</p>
          )}
        </div>

        <div className="field-group">
          <label className="neighborhood-toggle">
            <input
              type="checkbox"
              checked={form.isNeighborhoodSale}
              onChange={(e) => update('isNeighborhoodSale', e.target.checked)}
            />
            <span>🏘️ This is part of a neighborhood sale</span>
          </label>
          {form.isNeighborhoodSale && (
            <div className="address-field" ref={neighborhoodWrapRef} style={{ marginTop: 10 }}>
              <input
                className="text-input"
                placeholder="e.g. Maple Ridge, Oakhurst Estates…"
                value={form.neighborhoodName}
                autoComplete="off"
                onChange={(e) => handleNeighborhoodChange(e.target.value)}
                onFocus={() => {
                  if (neighborhoodSuggestions.length > 0) setNeighborhoodSuggestOpen(true);
                }}
              />
              {neighborhoodSuggestOpen && neighborhoodSuggestions.length > 0 && (
                <ul className="address-suggestions">
                  {neighborhoodSuggestions.map((name) => (
                    <li key={name}>
                      <button
                        type="button"
                        className="address-suggestion"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickNeighborhood(name)}
                      >
                        🏘️ {name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="hint">
                Start typing to see if this neighborhood sale already has a name other sellers used — pick it to keep
                everyone&apos;s listings grouped together.
              </p>
            </div>
          )}
        </div>

        <div className="field-group">
          <p className="field-label">Date</p>
          <div className="day-pills" style={{ marginTop: 0 }}>
            {dayOptions.map((opt) => (
              <div
                key={opt.date}
                className={`pill ${form.day === opt.date ? 'active' : ''}`}
                onClick={() => update('day', opt.date)}
              >
                {opt.label}
              </div>
            ))}
            <div
              className={`pill ${form.day === 'CUSTOM' ? 'active' : ''}`}
              onClick={() => update('day', 'CUSTOM')}
            >
              Pick date…
            </div>
          </div>
          {form.day === 'CUSTOM' && (
            <input
              type="date"
              className="text-input"
              style={{ marginTop: 10 }}
              value={form.customDate}
              onChange={(e) => update('customDate', e.target.value)}
            />
          )}
        </div>

        <div className="field-group">
          <p className="field-label">Hours</p>
          <div className="time-row">
            <input
              type="time"
              className="text-input mono"
              value={form.startTime}
              onChange={(e) => update('startTime', e.target.value)}
            />
            <span className="to">to</span>
            <input
              type="time"
              className="text-input mono"
              value={form.endTime}
              onChange={(e) => update('endTime', e.target.value)}
            />
          </div>
        </div>

        <div className="field-group">
          <p className="field-label">Categories</p>
          <div className="chip-row">
            {TAG_OPTIONS.map((tag) => (
              <div
                key={tag}
                className={`chip ${form.tags.includes(tag) ? 'on' : ''}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </div>
            ))}
          </div>
        </div>

        <div className="field-group">
          <p className="field-label">Photos</p>
          <div className="photo-row">
            {existingPhotoUrls.map((url) => (
              <div className="photo-thumb" key={url}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" />
                <button type="button" className="x" onClick={() => removeExistingPhoto(url)} aria-label="Remove photo">
                  ✕
                </button>
              </div>
            ))}
            {photos.map((p, i) => (
              <div className="photo-thumb" key={p.previewUrl}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.previewUrl} alt="" />
                <button type="button" className="x" onClick={() => removeNewPhoto(i)} aria-label="Remove photo">
                  ✕
                </button>
              </div>
            ))}
            {totalPhotoCount < 6 && (
              <label className="photo-add">
                <span style={{ fontSize: 18 }}>📷</span>
                <span>Add</span>
                <input type="file" accept="image/*" multiple hidden onChange={addPhoto} />
              </label>
            )}
          </div>
          <p className="hint">Up to 6 photos. First photo becomes the sale&apos;s cover image.</p>
        </div>

        <div className="field-group">
          <p className="field-label">Description</p>
          <textarea
            placeholder="What are you selling? Mention any big-ticket items…"
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
          />
        </div>

        {error && <p className="error-hint">{error}</p>}
      </div>

      <div className="publish-bar">
        <button type="button" className="publish-btn" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Saving…' : isEdit ? 'Save Changes →' : isAdminCreate ? 'Add Listing →' : 'Publish Sale →'}
        </button>
      </div>
    </>
  );
}
'@ | Set-Content -Encoding UTF8 "components\ListingForm.js"

Write-Host "Writing components\AccountScreen.js ..." -ForegroundColor Cyan
@'
'use client';

import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { formatTimeRange } from '@/lib/format';
import { SITE_URL } from '@/lib/site';
import ListingForm from './ListingForm';
import ShareToFacebookButton from './ShareToFacebookButton';

const STATUS_LABEL = { pending: 'Pending Review', approved: 'Live', rejected: 'Not Approved' };

export default function AccountScreen({ session, showToast, onEditingChange }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [authError, setAuthError] = useState(null);

  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [editingSale, setEditingSale] = useState(null);
  // Bumped after a delete/edit completes to trigger a refetch below, without
  // needing loadListings itself in the effect's dependency array.
  const [refreshKey, setRefreshKey] = useState(0);

  // Let AppShell know whether we're mid-edit, so it can hide the bottom nav
  // the same way it does during Post -- tapping away mid-edit would
  // otherwise silently discard unsaved changes.
  useEffect(() => {
    onEditingChange?.(Boolean(editingSale));
    return () => onEditingChange?.(false);
  }, [editingSale, onEditingChange]);

  useEffect(() => {
    if (!session || !isSupabaseConfigured) return;
    let cancelled = false;

    async function loadListings() {
      setLoading(true);
      const { data, error } = await supabase
        .from('sales')
        .select('*')
        .eq('user_id', session.user.id)
        .order('sale_date', { ascending: false });

      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
      } else {
        setLoadError(null);
        setListings(data || []);
      }
      setLoading(false);
    }

    loadListings();
    return () => {
      cancelled = true;
    };
  }, [session, refreshKey]);

  async function handleSendLink() {
    if (!email.trim()) return;
    setSending(true);
    setAuthError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setAuthError(err.message || 'Something went wrong sending your link.');
    } finally {
      setSending(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setListings([]);
    setSent(false);
    setEmail('');
  }

  async function handleDelete(sale) {
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
      showToast?.('Listing deleted.');
    } catch (err) {
      showToast?.(`Couldn't delete that listing: ${err.message}`);
    }
  }

  function handleEditDone(message) {
    setEditingSale(null);
    setRefreshKey((k) => k + 1);
    showToast?.(message);
  }

  // ---------- Editing an existing listing ----------
  if (session && editingSale) {
    return (
      <ListingForm
        mode="edit"
        session={session}
        initialSale={editingSale}
        onCancel={() => setEditingSale(null)}
        onDone={handleEditDone}
      />
    );
  }

  // ---------- Signed out: email + magic link ----------
  if (!session) {
    return (
      <>
        <div className="header" style={{ borderBottomColor: 'var(--yellow)' }}>
          <div className="header-row">
            <div className="logo marker-font" style={{ fontSize: 17 }}>
              Your <span>Account</span>
            </div>
          </div>
        </div>

        <div className="account-scroll">
          <div className="field-group">
            <p className="field-label">Sign In</p>
            <p className="hint" style={{ marginBottom: 12 }}>
              Enter your email and we&apos;ll send you a one-click sign-in link — no password to remember.
            </p>

            {sent ? (
              <div className="empty-state">
                <div className="big">📬</div>
                Check <b>{email}</b> for your sign-in link, then come back to this tab.
                <div style={{ marginTop: 14 }}>
                  <button type="button" className="chip" onClick={() => setSent(false)}>
                    Use a different email
                  </button>
                </div>
              </div>
            ) : (
              <>
                <input
                  className="text-input"
                  type="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendLink()}
                />
                {authError && <p className="error-hint">{authError}</p>}
                <button
                  type="button"
                  className="publish-btn"
                  style={{ width: 'auto', display: 'inline-block', marginTop: 12, padding: '12px 22px' }}
                  disabled={sending || !email.trim()}
                  onClick={handleSendLink}
                >
                  {sending ? 'Sending…' : 'Send Magic Link →'}
                </button>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  // ---------- Signed in: profile + My Listings ----------
  return (
    <>
      <div className="header" style={{ borderBottomColor: 'var(--yellow)' }}>
        <div className="header-row">
          <div className="logo marker-font" style={{ fontSize: 17 }}>
            Your <span>Account</span>
          </div>
        </div>
      </div>

      <div className="account-scroll">
        <div className="account-you">
          <span>
            Signed in as <b>{session.user.email}</b>
          </span>
          <button type="button" className="chip" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>

        <div className="sidebar-label" style={{ marginTop: 18 }}>My Listings</div>

        {loading && <div className="empty-state">Loading your listings…</div>}

        {!loading && loadError && (
          <div className="empty-state">
            <div className="big">⚠️</div>
            Couldn&apos;t load your listings right now.
            <br />
            {loadError}
          </div>
        )}

        {!loading && !loadError && listings.length === 0 && (
          <div className="empty-state">
            <div className="big">📋</div>
            You haven&apos;t posted any sales yet. Tap Post below to get started.
          </div>
        )}

        {!loading &&
          !loadError &&
          listings.map((sale) => (
            <div className="my-listing-card" key={sale.id}>
              <div className={`status-badge ${sale.status}`}>{STATUS_LABEL[sale.status] || sale.status}</div>
              <p className="card-title">{sale.title}</p>
              <p className="card-addr">{sale.address}</p>
              <p className="card-addr">
                {sale.sale_date} · {formatTimeRange(sale.start_time, sale.end_time)}
              </p>
              <div className="my-listing-actions">
                <button type="button" className="chip" onClick={() => setEditingSale(sale)}>
                  Edit
                </button>
                {sale.status === 'approved' && (
                  <ShareToFacebookButton
                    url={`${SITE_URL}/listing/${sale.id}`}
                    quote={sale.title}
                    className="chip"
                    label="Share"
                  />
                )}
                <button type="button" className="chip danger" onClick={() => handleDelete(sale)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
      </div>
    </>
  );
}
'@ | Set-Content -Encoding UTF8 "components\AccountScreen.js"

Write-Host "Writing components\AppShell.js ..." -ForegroundColor Cyan
@'
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { sampleSales, MAP_CENTER } from '@/lib/sampleData';
import { nextNDays, distanceMiles, toDateKey } from '@/lib/format';
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
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
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
        return (
          s.title.toLowerCase().includes(q) ||
          s.address.toLowerCase().includes(q) ||
          (s.neighborhood_name || '').toLowerCase().includes(q)
        );
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
'@ | Set-Content -Encoding UTF8 "components\AppShell.js"

Write-Host "Writing app\api\neighborhood-suggest\route.js ..." -ForegroundColor Cyan
@'
import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Server-side lookup of neighborhood sale names sellers have already used,
// so the Post form can suggest existing names instead of, say, "Maple
// Ridge" and "Maple Ridge Sale" ending up as two separate, disconnected
// neighborhood sales.
//
// Uses the service-role connection (bypassing RLS) so it can match names
// from EVERY upcoming sale, including other sellers' still-pending
// submissions -- a visitor's own anon key can only see already-approved
// sales, which would miss duplicates from listings still awaiting review.
// Only neighborhood name strings are ever returned here, never full rows,
// so this stays safe to leave open (no admin login required), the same way
// /api/address-suggest is.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') || '').trim();

  if (!query || !isSupabaseAdminConfigured) {
    return NextResponse.json([]);
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from('sales')
    .select('neighborhood_name')
    .eq('is_neighborhood_sale', true)
    .not('neighborhood_name', 'is', null)
    .gte('sale_date', today)
    .ilike('neighborhood_name', `%${query}%`)
    .limit(30);

  if (error || !data) {
    return NextResponse.json([]);
  }

  // De-dupe case-insensitively (two sellers may type slightly different
  // casing/spacing for the same neighborhood) and cap the suggestion list.
  const seen = new Map();
  for (const row of data) {
    const name = (row.neighborhood_name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }

  return NextResponse.json(Array.from(seen.values()).slice(0, 8));
}
'@ | Set-Content -Encoding UTF8 "app\api\neighborhood-suggest\route.js"

Write-Host "Writing app\api\admin\sales\route.js ..." -ForegroundColor Cyan
@'
import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Lists every sale regardless of status, for the /admin dashboard. Uses the
// service-role client, which bypasses Row Level Security entirely -- this
// is the one place in the app that's allowed to see pending/rejected sales
// that don't belong to the current visitor.
export async function GET(request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from('sales')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

// Creates a listing directly from the admin panel. Unlike a seller's own
// submission, this always comes back already 'approved' (no review needed
// -- the admin made it) and isn't attributed to any seller account
// (user_id stays null). status and user_id are hardcoded here rather than
// trusted from the request body, same defense-in-depth spirit as the
// EDITABLE_FIELDS allowlist in [id]/route.js.
export async function POST(request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!body?.title || !body?.address || !body?.sale_date || !body?.start_time || !body?.end_time) {
    return NextResponse.json({ error: 'Missing required listing fields.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('sales')
    .insert({
      title: body.title,
      address: body.address,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      sale_date: body.sale_date,
      start_time: body.start_time,
      end_time: body.end_time,
      tags: body.tags || [],
      description: body.description || null,
      photo_urls: body.photo_urls || [],
      is_neighborhood_sale: Boolean(body.is_neighborhood_sale),
      neighborhood_name: body.is_neighborhood_sale ? body.neighborhood_name || null : null,
      status: 'approved',
      user_id: null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
'@ | Set-Content -Encoding UTF8 "app\api\admin\sales\route.js"

Write-Host "Writing app\globals.css ..." -ForegroundColor Cyan
@'
@import url('https://fonts.googleapis.com/css2?family=Permanent+Marker&family=DM+Sans:ital,wght@0,400;0,500;0,700;1,500&family=JetBrains+Mono:wght@500;700&display=swap');

:root {
  --paper: #FAF6EC;
  --ink: #201C16;
  --ink-soft: #5A5346;
  --yellow: #F4B93C;
  --yellow-deep: #E0A020;
  --red: #D64545;
  --green: #5C8A66;
  --tan: #E9DFC4;
  --line: #D8CDAA;
  --radius: 12px;
}

* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { height: 100%; margin: 0; padding: 0; }

body {
  background: #3a362e;
  color: var(--ink);
  font-family: 'DM Sans', sans-serif;
  -webkit-font-smoothing: antialiased;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px 0;
}

.marker-font { font-family: 'Permanent Marker', cursive; }
.mono { font-family: 'JetBrains Mono', monospace; }

/* ---------- DEVICE FRAME (desktop preview only) ---------- */
.device {
  width: 390px;
  height: 820px;
  background: var(--paper);
  border-radius: 44px;
  border: 8px solid #17140f;
  box-shadow: 0 30px 60px rgba(0,0,0,0.45);
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.notch {
  position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 120px; height: 26px; background: #17140f;
  border-radius: 0 0 16px 16px; z-index: 50;
}
@media (max-width: 480px) {
  body { padding: 0; background: var(--paper); }
  .device { width: 100%; height: 100vh; height: 100dvh; border-radius: 0; border: none; box-shadow: none; }
  .notch { display: none; }
}

/* ---------- ADMIN DASHBOARD OVERRIDE ---------- */
/* The rules above center everything inside a fixed-size phone frame for the
   mobile mockup. /admin is a normal desktop page (see AdminBodyClass.js),
   so it opts out of that layout entirely while mounted. */
body.admin-mode {
  display: block;
  min-height: 100vh;
  padding: 0;
  background: #f4f1ea;
}

/* ---------- SCREENS ---------- */
.app-screens { flex: 1; position: relative; overflow: hidden; }
.screen { position: absolute; inset: 0; display: none; flex-direction: column; background: var(--paper); }
.screen.active { display: flex; }

/* ---------- SHARED HEADER ---------- */
.header { background: var(--ink); color: var(--paper); padding: 16px 16px 12px; border-bottom: 4px solid var(--yellow); flex-shrink: 0; }
.header-row { display: flex; align-items: center; gap: 10px; }
.logo { font-size: 20px; color: var(--yellow); transform: rotate(-2deg); white-space: nowrap; }
.logo span { color: var(--paper); }
.icon-btn {
  width: 34px; height: 34px; border-radius: 50%;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; color: var(--paper); flex-shrink: 0; cursor: pointer;
}
.search { margin-top: 10px; display: flex; align-items: center; gap: 8px; background: var(--paper); border-radius: 20px; padding: 9px 14px; color: var(--ink-soft); font-size: 13.5px; }
.search input { border: none; background: none; outline: none; color: var(--ink); width: 100%; font-family: inherit; font-size: 13.5px; }
.day-pills { display: flex; gap: 6px; margin-top: 10px; overflow-x: auto; padding-bottom: 2px; }
.pill { padding: 6px 13px; border-radius: 20px; border: 1.5px solid #4b4437; color: #c9c2ae; font-size: 12.5px; font-weight: 700; white-space: nowrap; cursor: pointer; }
.pill.active { background: var(--yellow); color: var(--ink); border-color: var(--yellow); }
.count-row { display: flex; align-items: center; margin-top: 8px; font-size: 12px; color: #c9c2ae; }
.count-row b { color: var(--yellow); }

/* ---------- BROWSE: CARD LIST ---------- */
.list-scroll { flex: 1; overflow-y: auto; padding: 14px 14px 90px; }
.sidebar-label { font-size: 10.5px; letter-spacing: 1.3px; text-transform: uppercase; color: var(--ink-soft); font-weight: 700; margin: 2px 2px 10px; }
.empty-state { padding: 60px 20px; text-align: center; color: var(--ink-soft); font-size: 13.5px; }
.empty-state .big { font-size: 38px; margin-bottom: 10px; }

.card {
  display: flex; gap: 12px; background: #fff;
  border: 1.5px solid var(--line); border-left: 6px solid var(--yellow-deep);
  border-radius: var(--radius); padding: 12px; margin-bottom: 12px;
  position: relative; cursor: pointer;
}
.card.favorited { border-left-color: var(--green); }
.thumb { width: 52px; height: 52px; border-radius: 8px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 22px; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.card-body { flex: 1; min-width: 0; }
.card-title { font-weight: 700; font-size: 14.5px; margin: 0 0 3px; }
.card-addr { font-size: 12px; color: var(--ink-soft); margin: 0 0 6px; }
.card-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.time-badge { font-size: 10.5px; font-weight: 700; background: var(--tan); padding: 3px 6px; border-radius: 5px; color: var(--ink); }
.tag { font-size: 10.5px; color: var(--ink-soft); background: var(--paper); border: 1px solid var(--line); padding: 3px 6px; border-radius: 5px; }
.fav-btn {
  position: absolute; top: 10px; right: 10px; width: 30px; height: 30px; border-radius: 50%;
  border: 1.5px solid var(--line); background: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 14px; color: var(--line);
}
.fav-btn.on { background: var(--green); border-color: var(--green); color: #fff; }
.route-num {
  position: absolute; top: -8px; left: -8px; width: 22px; height: 22px; border-radius: 50%;
  background: var(--red); color: #fff; font-family: 'JetBrains Mono'; font-size: 11px; font-weight: 700;
  display: none; align-items: center; justify-content: center; border: 2px solid var(--paper);
}
.card.favorited .route-num { display: flex; }

/* ---------- MAP SCREEN ---------- */
.map-wrap { flex: 1; position: relative; overflow: hidden; background: #DCE8D6; }
.leaflet-container { width: 100%; height: 100%; background: #DCE8D6; font-family: 'DM Sans', sans-serif; }
.map-floating-row { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; gap: 8px; z-index: 500; pointer-events: none; }
.map-chip { background: rgba(32,28,22,0.85); color: var(--paper); font-size: 12px; padding: 8px 12px; border-radius: 20px; display: flex; align-items: center; gap: 6px; white-space: nowrap; border: 1px solid rgba(255,255,255,0.12); pointer-events: auto; }
.map-chip.grow { flex: 1; overflow: hidden; text-overflow: ellipsis; }

.sale-pin { background: none; border: none; }
.sale-pin .sign {
  width: 32px; height: 24px; background: var(--yellow); border: 2px solid var(--ink); border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-family: 'JetBrains Mono'; font-weight: 700; font-size: 11px;
  box-shadow: 2px 2px 0 rgba(32,28,22,0.18); margin: 0 auto;
}
.sale-pin .stick { width: 3px; height: 14px; background: var(--ink); margin: 0 auto; }
.sale-pin.favorited .sign { background: var(--green); color: #fff; border-color: #3d5f45; }
.sale-pin.favorited .stick { background: #3d5f45; }
.sale-pin.selected .sign { transform: translateY(-3px) scale(1.12); }

.map-peek {
  position: absolute; left: 12px; right: 12px; bottom: 12px;
  background: #fff; border-radius: var(--radius);
  border: 1.5px solid var(--line); border-left: 6px solid var(--yellow-deep);
  padding: 12px; display: flex; gap: 12px; align-items: flex-start;
  box-shadow: 0 8px 20px rgba(32,28,22,0.18); z-index: 500;
}
.map-peek.favorited { border-left-color: var(--green); }

.route-pill {
  position: absolute; bottom: 12px; left: 12px; right: 12px;
  background: var(--ink); color: var(--paper);
  border-radius: 24px; padding: 12px 16px;
  display: flex; align-items: center; gap: 10px;
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  box-shadow: 0 8px 20px rgba(32,28,22,0.3); z-index: 500; border: none; width: calc(100% - 24px);
}
.route-pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); flex-shrink: 0; }
.route-pill .go { margin-left: auto; color: var(--yellow); }

/* ---------- SAVED / ROUTE SCREEN ---------- */
.route-map-mini { height: 150px; position: relative; overflow: hidden; background: #DCE8D6; flex-shrink: 0; }
.route-list { flex: 1; overflow-y: auto; padding: 14px 16px 100px; }
.stop-row { display: flex; align-items: center; gap: 12px; background: #fff; border: 1.5px solid var(--line); border-radius: var(--radius); padding: 11px 12px; margin-bottom: 10px; }
.stop-row .handle { color: var(--line); font-size: 16px; cursor: grab; }
.stop-row .n { width: 22px; height: 22px; border-radius: 50%; background: var(--red); color: #fff; font-family: 'JetBrains Mono'; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.stop-row .stop-body { flex: 1; min-width: 0; }
.stop-row .stop-title { font-weight: 700; font-size: 13.5px; margin: 0 0 2px; }
.stop-row .stop-addr { font-size: 11.5px; color: var(--ink-soft); margin: 0; }
.stop-row .remove { color: var(--line); font-size: 16px; cursor: pointer; padding: 4px; background: none; border: none; }
.route-summary { padding: 12px 0; font-size: 12px; color: var(--ink-soft); border-top: 1.5px dashed var(--line); margin-top: 4px; }
.maps-export-row { display: flex; gap: 10px; margin-top: 14px; }
.maps-btn {
  flex: 1; border: none; padding: 14px 10px; border-radius: 14px; font-weight: 700; font-size: 13px;
  cursor: pointer; font-family: inherit; text-align: center; text-decoration: none; display: block;
}
.maps-btn.google { background: var(--yellow); color: var(--ink); }
.maps-btn.apple { background: var(--ink); color: var(--paper); }

/* ---------- BOTTOM NAV ---------- */
.bottom-nav { flex-shrink: 0; display: flex; align-items: center; justify-content: space-around; background: var(--ink); border-top: 2px solid #4b4437; padding: 8px 6px calc(10px + env(safe-area-inset-bottom)); }
.nav-btn { display: flex; flex-direction: column; align-items: center; gap: 3px; color: #8c8471; font-size: 10px; font-weight: 700; cursor: pointer; padding: 4px 10px; position: relative; background: none; border: none; }
.nav-btn .ic { font-size: 19px; }
.nav-btn.active { color: var(--yellow); }
.nav-btn .badge { position: absolute; top: -2px; right: 2px; background: var(--red); color: #fff; font-size: 9px; font-weight: 700; width: 15px; height: 15px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid var(--ink); }
.nav-btn.post .ic { width: 44px; height: 44px; border-radius: 50%; background: var(--yellow); color: var(--ink); display: flex; align-items: center; justify-content: center; font-size: 22px; margin-top: -22px; box-shadow: 0 4px 10px rgba(32,28,22,0.35); border: 4px solid var(--paper); }
.nav-btn.post { color: var(--ink-soft); }

/* ---------- POST SCREEN ---------- */
.post-header { background: var(--ink); color: var(--paper); padding: 14px 16px; display: flex; align-items: center; gap: 12px; border-bottom: 4px solid var(--yellow); flex-shrink: 0; }
.post-header .title { font-weight: 700; font-size: 15px; flex: 1; }
.post-scroll { flex: 1; overflow-y: auto; padding: 18px 16px 110px; }
.field-label { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--ink-soft); margin: 0 0 7px; }
.field-group { margin-bottom: 20px; }
.text-input, textarea {
  width: 100%; border: 1.5px solid var(--line); border-radius: 10px;
  padding: 12px 13px; font-family: inherit; font-size: 14px; color: var(--ink);
  background: #fff; outline: none;
}
.text-input:focus, textarea:focus { border-color: var(--yellow-deep); }
textarea { resize: vertical; min-height: 80px; }
.hint { font-size: 11.5px; color: var(--ink-soft); margin-top: 5px; }
.hint.address-verified { color: var(--green); font-weight: 600; }
.error-hint { font-size: 11.5px; color: var(--red); margin-top: 5px; }

.address-field { position: relative; }
.address-spinner {
  position: absolute; top: 50%; right: 13px; width: 14px; height: 14px; margin-top: -7px;
  border: 2px solid var(--line); border-top-color: var(--yellow-deep); border-radius: 50%;
  animation: address-spin 0.7s linear infinite;
}
@keyframes address-spin { to { transform: rotate(360deg); } }
.address-suggestions {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 50;
  background: #fff; border: 1.5px solid var(--line); border-radius: 10px;
  box-shadow: 0 8px 20px rgba(32,28,22,0.18); list-style: none; margin: 0; padding: 4px;
  max-height: 220px; overflow-y: auto;
}
.address-suggestion {
  display: block; width: 100%; text-align: left; background: none; border: none;
  padding: 9px 10px; font-family: inherit; font-size: 13px; color: var(--ink);
  border-radius: 7px; cursor: pointer; line-height: 1.35;
}
.address-suggestion.highlighted, .address-suggestion:hover { background: var(--tan); }
.time-row { display: flex; gap: 10px; align-items: center; }
.time-row .text-input { flex: 1; }
.time-row .to { color: var(--ink-soft); font-size: 12.5px; font-weight: 700; }
.chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 8px 14px; border-radius: 20px; border: 1.5px solid var(--line); background: #fff; font-size: 12.5px; font-weight: 600; color: var(--ink-soft); cursor: pointer; }
.chip.on { background: var(--yellow); border-color: var(--yellow-deep); color: var(--ink); }
.photo-row { display: flex; gap: 10px; flex-wrap: wrap; }
.photo-add { width: 72px; height: 72px; border-radius: 10px; border: 2px dashed var(--line); display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--ink-soft); font-size: 11px; cursor: pointer; gap: 2px; background: #fff; }
.photo-thumb { width: 72px; height: 72px; border-radius: 10px; background: var(--tan); display: flex; align-items: center; justify-content: center; font-size: 24px; position: relative; overflow: hidden; }
.photo-thumb img { width: 100%; height: 100%; object-fit: cover; }
.photo-thumb .x { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; background: var(--ink); color: #fff; font-size: 11px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; }
.publish-bar { position: absolute; left: 0; right: 0; bottom: 0; background: var(--paper); border-top: 1.5px dashed var(--line); padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); }
.publish-btn { width: 100%; background: var(--yellow); color: var(--ink); border: none; padding: 15px; border-radius: 14px; font-weight: 700; font-size: 14.5px; cursor: pointer; font-family: inherit; }
.publish-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* ---------- ACCOUNT SCREEN ---------- */
.account-scroll { flex: 1; overflow-y: auto; padding: 18px 16px 100px; }
.account-you {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  font-size: 13px; color: var(--ink-soft); padding: 0 0 16px; border-bottom: 1.5px dashed var(--line); margin-bottom: 4px;
}
.chip.danger { background: #fbe8e8; border-color: #f0bcbc; color: var(--red); }
.my-listing-card {
  background: #fff; border: 1.5px solid var(--line); border-radius: var(--radius);
  padding: 12px; margin-bottom: 12px; position: relative;
}
.status-badge {
  display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.4px; padding: 3px 8px; border-radius: 5px; margin-bottom: 7px;
}
.status-badge.pending { background: #f6e5b8; color: #7a5b13; }
.status-badge.approved { background: #d9ecdb; color: #2f5136; }
.status-badge.rejected { background: #f6d6d6; color: #8a2a2a; }
.my-listing-actions { display: flex; gap: 8px; margin-top: 10px; }

/* ---------- ADS (mixed into Browse) ---------- */
.card.ad-card { background: #FFF7E0; border: 1.5px dashed var(--yellow-deep); border-left: 6px solid var(--yellow-deep); }
.ad-badge { font-size: 9.5px; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; background: var(--yellow-deep); color: #fff; padding: 3px 7px; border-radius: 5px; }
.ad-sponsor { font-size: 11.5px; color: var(--ink-soft); margin: 0 0 6px; }

/* ---------- NEIGHBORHOOD SALES ---------- */
.neighborhood-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--ink); cursor: pointer; }
.neighborhood-toggle input { width: 17px; height: 17px; accent-color: var(--yellow-deep); cursor: pointer; }
.neighborhood-badge {
  display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 700;
  color: var(--ink-soft); background: var(--tan); border: 1px solid var(--line);
  padding: 3px 7px; border-radius: 5px; cursor: pointer; margin-top: 7px; font-family: inherit;
}
.neighborhood-badge:hover { background: var(--yellow); border-color: var(--yellow-deep); color: var(--ink); }

/* ---------- FACEBOOK SHARE ---------- */
.fb-share-btn {
  background: #1877F2; color: #fff; border: none; padding: 13px 16px; border-radius: 12px;
  font-weight: 700; font-size: 13.5px; cursor: pointer; font-family: inherit; width: 100%;
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.fb-share-btn:hover { background: #1567d3; }

/* ---------- POST SUCCESS / SHARE PANEL ---------- */
.share-success { display: flex; flex-direction: column; align-items: center; text-align: center; padding-top: 50px; }
.share-success-icon { font-size: 46px; margin-bottom: 14px; }
.share-success-title { font-size: 17px; margin-bottom: 8px; }
.share-success-hint { margin-bottom: 22px; max-width: 280px; }
.share-success-actions { width: 100%; max-width: 300px; display: flex; flex-direction: column; gap: 10px; }

/* ---------- LISTING SHARE PAGE (/listing/[id]) ---------- */
.share-page { width: 100%; max-width: 480px; padding: 24px 16px; }
.share-card { background: #fff; border-radius: 18px; overflow: hidden; border: 1.5px solid var(--line); box-shadow: 0 20px 50px rgba(0,0,0,0.35); }
.share-logo { padding: 16px 18px 0; font-size: 19px; color: var(--yellow-deep); }
.share-logo span { color: var(--ink); }
.share-cover { width: 100%; height: 220px; object-fit: cover; display: block; margin-top: 12px; }
.share-body { padding: 18px 20px 22px; }
.share-title { font-family: inherit; font-weight: 700; font-size: 19px; margin: 0 0 8px; }
.share-addr { font-size: 13px; color: var(--ink-soft); margin: 0 0 8px; }
.share-meta { margin: 0 0 4px; }
.share-desc { font-size: 13.5px; line-height: 1.5; color: var(--ink); margin: 14px 0 0; white-space: pre-wrap; }
.share-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
.share-home-link { text-align: center; }
.share-empty { padding: 40px 24px; text-align: center; color: var(--ink-soft); font-size: 13.5px; }
.share-empty .big { font-size: 38px; margin-bottom: 12px; }
.share-home-btn { display: inline-block; text-decoration: none; margin-top: 16px; width: auto; padding: 12px 22px; }

/* ---------- TOAST ---------- */
.toast {
  position: absolute; top: 16px; left: 16px; right: 16px;
  background: var(--ink); color: var(--paper); padding: 13px 16px; border-radius: 12px;
  font-size: 13px; display: flex; align-items: center; gap: 8px;
  transform: translateY(-80px); opacity: 0; transition: all .3s ease; z-index: 1000;
  border-left: 5px solid var(--green); pointer-events: none;
}
.toast.show { transform: translateY(0); opacity: 1; }
'@ | Set-Content -Encoding UTF8 "app\globals.css"

Write-Host "Creating app\listing\[id] ..." -ForegroundColor Cyan
$listingPageDir = Join-Path $projectPath "app\listing\[id]"
[System.IO.Directory]::CreateDirectory($listingPageDir) | Out-Null

Write-Host "Writing app\listing\[id]\page.js ..." -ForegroundColor Cyan
$listingPageFile = Join-Path $projectPath "app\listing\[id]\page.js"
$listingPageContent = @'
import { getSaleForShare } from '@/lib/getSaleForShare';
import { formatTimeRange } from '@/lib/format';
import { SITE_URL } from '@/lib/site';
import ShareToFacebookButton from '@/components/ShareToFacebookButton';

// A real, public, individually-shareable page for one approved sale --
// this is what makes the "Share to Facebook" button actually work: Facebook
// needs a real URL it can fetch and read Open Graph tags from to build a
// nice preview (photo, title, description) in the shared post.
//
// Only approved sales are reachable here (see getSaleForShare, which reads
// through the same anon key + RLS every other visitor uses) -- a listing
// still awaiting review isn't public yet, so there's nothing to share.
export async function generateMetadata({ params }) {
  const sale = await getSaleForShare(params.id);

  if (!sale) {
    return { title: 'Listing not found — SaleHop' };
  }

  const summary = `${sale.sale_date} · ${formatTimeRange(sale.start_time, sale.end_time)} · ${sale.address}`;
  const description = sale.description ? sale.description.slice(0, 160) : summary;
  const image = sale.photo_urls && sale.photo_urls.length > 0 ? sale.photo_urls[0] : null;

  return {
    title: `${sale.title} — SaleHop`,
    description,
    openGraph: {
      title: sale.title,
      description,
      url: `${SITE_URL}/listing/${sale.id}`,
      siteName: 'SaleHop',
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: sale.title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ListingPage({ params }) {
  const sale = await getSaleForShare(params.id);

  if (!sale) {
    return (
      <div className="share-page">
        <div className="share-card">
          <div className="share-logo marker-font">
            Sale<span>Hop</span>
          </div>
          <div className="share-empty">
            <div className="big">🔍</div>
            <p>This listing isn&apos;t available. It may have been removed, sold out, or isn&apos;t approved yet.</p>
            <a className="publish-btn share-home-btn" href="/">
              Browse Sales on SaleHop →
            </a>
          </div>
        </div>
      </div>
    );
  }

  const cover = sale.photo_urls && sale.photo_urls.length > 0 ? sale.photo_urls[0] : null;
  const listingUrl = `${SITE_URL}/listing/${sale.id}`;

  return (
    <div className="share-page">
      <div className="share-card">
        <div className="share-logo marker-font">
          Sale<span>Hop</span>
        </div>

        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="share-cover" />
        )}

        <div className="share-body">
          {sale.is_neighborhood_sale && sale.neighborhood_name && (
            <div className="neighborhood-badge" style={{ marginBottom: 10 }}>
              🏘️ Part of {sale.neighborhood_name}
            </div>
          )}

          <h1 className="share-title">{sale.title}</h1>
          <p className="share-addr">📍 {sale.address}</p>
          <p className="share-meta">
            <span className="time-badge mono">
              {sale.sale_date} · {formatTimeRange(sale.start_time, sale.end_time)}
            </span>
          </p>

          {sale.tags && sale.tags.length > 0 && (
            <div className="card-meta" style={{ marginTop: 10 }}>
              {sale.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          )}

          {sale.description && <p className="share-desc">{sale.description}</p>}

          <div className="share-actions">
            <ShareToFacebookButton url={listingUrl} quote={sale.title} />
            <a className="chip share-home-link" href="/">
              Browse More Sales on SaleHop →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
'@
[System.IO.File]::WriteAllText($listingPageFile, $listingPageContent, [System.Text.Encoding]::UTF8)
if (-not (Test-Path -LiteralPath $listingPageFile)) {
    Write-Host "ERROR: app\listing\[id]\page.js still doesn't exist after writing it. Send me a screenshot of this output." -ForegroundColor Red
    exit 1
}

Write-Host "Staging, committing, and pushing ..." -ForegroundColor Cyan
git add .
git commit -m "Add ads, neighborhood sales, and Facebook share pages"

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "If that failed with 'Please tell me who you are', run these two lines (with your info) then re-run this script:" -ForegroundColor Yellow
    Write-Host '  git config --global user.email "you@example.com"' -ForegroundColor Yellow
    Write-Host '  git config --global user.name "Your Name"' -ForegroundColor Yellow
    exit 1
}

git push

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Done! Next: run admin-content.ps1 to get the Add Listing / Add Ad buttons in /admin." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "The push didn't finish cleanly -- scroll up for git's error message and send it to me." -ForegroundColor Red
}
