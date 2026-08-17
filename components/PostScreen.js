'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { geocodeAddress, suggestAddress } from '@/lib/geocode';
import { nextNDays } from '@/lib/format';

const TAG_OPTIONS = ['Furniture', 'Kids', 'Tools', 'Vintage', 'Multi-Family', 'Books', 'Decor', 'Clothing'];

// How long to wait after the user stops typing before asking for address
// suggestions, and the minimum number of characters before we bother.
// OpenStreetMap's free Nominatim geocoder (same one used to place the pin
// on submit) asks apps not to fire a request on every keystroke, so this
// stays deliberately gentle rather than instant.
const SUGGEST_DEBOUNCE_MS = 700;
const SUGGEST_MIN_LENGTH = 5;

// 'day' holds either one of the next-7-days date strings ('YYYY-MM-DD') or
// the literal 'CUSTOM' sentinel, in which case 'customDate' holds the date.
const emptyForm = {
  title: '',
  address: '',
  location: null, // { lat, lng } once a suggestion has been picked
  day: '',
  customDate: '',
  startTime: '09:00',
  endTime: '13:00',
  tags: [],
  description: '',
};

export default function PostScreen({ onCancel, onPublished, showToast }) {
  const dayOptions = useMemo(() => nextNDays(7), []);
  const [form, setForm] = useState(() => ({ ...emptyForm, day: dayOptions[0]?.date || '' }));
  const [photos, setPhotos] = useState([]); // { file, previewUrl }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [suggestions, setSuggestions] = useState([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const addressWrapRef = useRef(null);

  // Close the suggestions dropdown on outside click.
  useEffect(() => {
    function handleClickOutside(e) {
      if (addressWrapRef.current && !addressWrapRef.current.contains(e.target)) {
        setSuggestOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cancel any in-flight timer/request if the screen unmounts mid-type.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleAddressChange(value) {
    // Typing invalidates any previously-picked suggestion -- address and
    // location must travel together so we never save mismatched coordinates.
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

  function toggleTag(tag) {
    setForm((f) => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag],
    }));
  }

  function addPhoto(e) {
    const files = Array.from(e.target.files || []).slice(0, 6 - photos.length);
    const next = files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    setPhotos((p) => [...p, ...next].slice(0, 6));
    e.target.value = '';
  }

  function removePhoto(idx) {
    setPhotos((p) => p.filter((_, i) => i !== idx));
  }

  function resetForm() {
    setForm({ ...emptyForm, day: dayOptions[0]?.date || '' });
    setPhotos([]);
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

    setSubmitting(true);
    try {
      // If they picked one of the suggestions, we already know exactly
      // where it is -- no need to geocode again. Otherwise (typed the whole
      // address by hand and hit publish without picking a suggestion) fall
      // back to the same one-shot geocode used before this feature existed.
      const location = form.location || (await geocodeAddress(form.address));
      if (!location) {
        setError("We couldn't find that address on the map. Double-check it and try again.");
        setSubmitting(false);
        return;
      }

      if (!isSupabaseConfigured) {
        // Preview mode: no Supabase project connected yet. Pass the message
        // through onPublished rather than also calling showToast directly --
        // both would set the toast in the same tick and only the last one
        // would actually render, silently hiding this message.
        resetForm();
        onPublished('Preview mode: Supabase isn’t connected yet, so this wasn’t actually saved. See the README to connect it.');
        return;
      }

      let photoUrls = [];
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
        photoUrls = uploads;
      }

      const { error: insertError } = await supabase.from('sales').insert({
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
        status: 'pending',
      });

      if (insertError) throw insertError;

      resetForm();
      onPublished();
    } catch (err) {
      setError(err.message || 'Something went wrong submitting your sale.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="post-header">
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cancel">
          ✕
        </button>
        <div className="title">Post a Garage Sale</div>
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
            {photos.map((p, i) => (
              <div className="photo-thumb" key={p.previewUrl}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.previewUrl} alt="" />
                <button type="button" className="x" onClick={() => removePhoto(i)} aria-label="Remove photo">
                  ✕
                </button>
              </div>
            ))}
            {photos.length < 6 && (
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
          {submitting ? 'Publishing…' : 'Publish Sale →'}
        </button>
      </div>
    </>
  );
}
