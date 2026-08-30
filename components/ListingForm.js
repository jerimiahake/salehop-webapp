'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { geocodeAddress, suggestAddress } from '@/lib/geocode';
import { nextNDays } from '@/lib/format';
import { SITE_URL } from '@/lib/site';
import ShareToFacebookButton from './ShareToFacebookButton';

// Used only if the "tags" table can't be reached (offline preview mode,
// or a hiccup loading it) -- the real, admin-editable list normally comes
// from Supabase (see the tagOptions state below).
const DEFAULT_TAG_OPTIONS = ['Furniture', 'Kids', 'Tools', 'Vintage', 'Multi-Family', 'Books', 'Decor', 'Clothing'];

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
    location: null, // { lat, lng, city } once a suggestion has been picked / verified
    day: dayOptions[0]?.date || '',
    customDate: '',
    multiDay: false,
    endDay: dayOptions[0]?.date || '',
    endCustomDate: '',
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
  const hasEndDate = Boolean(sale.end_date && sale.end_date !== sale.sale_date);
  const endDateKey = hasEndDate ? sale.end_date : dateKey;
  const endInRange = dayOptions.some((opt) => opt.date === endDateKey);
  return {
    title: sale.title || '',
    address: sale.address || '',
    location: Number.isFinite(sale.lat) && Number.isFinite(sale.lng) ? { lat: sale.lat, lng: sale.lng } : null,
    day: inRange ? dateKey : 'CUSTOM',
    customDate: inRange ? '' : dateKey,
    multiDay: hasEndDate,
    endDay: endInRange ? endDateKey : 'CUSTOM',
    endCustomDate: endInRange ? '' : endDateKey,
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

  const [tagOptions, setTagOptions] = useState(DEFAULT_TAG_OPTIONS);

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

  // Category tags are managed from /admin rather than hardcoded, so this
  // list can change without a code deploy. Falls back to the original
  // built-in list if Supabase isn't reachable (offline preview mode, or a
  // hiccup loading it) so the form never ends up with zero options.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    supabase
      .from('tags')
      .select('name')
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled || error || !data || data.length === 0) return;
        setTagOptions(data.map((t) => t.name));
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
    setForm((f) => ({ ...f, address: s.label, location: { lat: s.lat, lng: s.lng, city: s.city || null } }));
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
      setError('Please pick a start date.');
      return;
    }

    let endDate = null;
    if (form.multiDay) {
      endDate = form.endDay === 'CUSTOM' ? form.endCustomDate : form.endDay;
      if (!endDate) {
        setError('Please pick an end date, or uncheck "runs multiple days".');
        return;
      }
      if (endDate < saleDate) {
        setError('The end date needs to be on or after the start date.');
        return;
      }
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

      // A neighborhood sale name is stored qualified with its town (e.g.
      // "Boulder Creek, Lapel") so the same neighborhood name in two
      // different towns doesn't get treated as one shared sale. Only
      // appends if we actually resolved a city and the name doesn't
      // already end with it (picking an existing suggestion already
      // includes the city, typing a fresh name doesn't yet).
      let neighborhoodName = form.isNeighborhoodSale ? form.neighborhoodName.trim() : null;
      if (neighborhoodName && location.city) {
        const alreadyQualified = neighborhoodName.toLowerCase().endsWith(location.city.toLowerCase());
        if (!alreadyQualified) {
          neighborhoodName = `${neighborhoodName}, ${location.city}`;
        }
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

      if (isEdit) {
        const { error: updateError } = await supabase
          .from('sales')
          .update({
            title: form.title.trim(),
            address: form.address.trim(),
            lat: location.lat,
            lng: location.lng,
            sale_date: saleDate,
            end_date: endDate,
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
            end_date: endDate,
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
            end_date: endDate,
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
      const msg = err.message || 'Something went wrong saving your sale.';
      setError(msg);
      // Best-effort: lets Jerimiah see in /admin that a listing submission
      // failed partway through, even though the seller never reports it
      // themselves. Never lets a logging hiccup surface as a second error
      // on top of the real one above.
      fetch('/api/log-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'listing',
          message: msg,
          email: session?.user?.email || null,
          context: { title: form.title, address: form.address, mode },
        }),
      }).catch(() => {});
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
              <a className="chip" style={{ textAlign: 'center' }} href={`/listing/${justCreated.id}/sign`} target="_blank" rel="noopener noreferrer">
                🖨️ Print a Sign
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
          <p className="field-label">Start Date</p>
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

          <label className="neighborhood-toggle" style={{ marginTop: 14 }}>
            <input
              type="checkbox"
              checked={form.multiDay}
              onChange={(e) => update('multiDay', e.target.checked)}
            />
            <span>📅 This sale runs multiple days</span>
          </label>

          {form.multiDay && (
            <div style={{ marginTop: 12 }}>
              <p className="field-label">End Date</p>
              <div className="day-pills" style={{ marginTop: 0 }}>
                {dayOptions.map((opt) => (
                  <div
                    key={opt.date}
                    className={`pill ${form.endDay === opt.date ? 'active' : ''}`}
                    onClick={() => update('endDay', opt.date)}
                  >
                    {opt.label}
                  </div>
                ))}
                <div
                  className={`pill ${form.endDay === 'CUSTOM' ? 'active' : ''}`}
                  onClick={() => update('endDay', 'CUSTOM')}
                >
                  Pick date…
                </div>
              </div>
              {form.endDay === 'CUSTOM' && (
                <input
                  type="date"
                  className="text-input"
                  style={{ marginTop: 10 }}
                  value={form.endCustomDate}
                  onChange={(e) => update('endCustomDate', e.target.value)}
                />
              )}
              <p className="hint">Same hours apply to every day of the sale.</p>
            </div>
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
            {tagOptions.map((tag) => (
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
