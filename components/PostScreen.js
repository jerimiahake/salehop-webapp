'use client';

import { useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { geocodeAddress } from '@/lib/geocode';
import { upcomingDateFor } from '@/lib/format';

const TAG_OPTIONS = ['Furniture', 'Kids', 'Tools', 'Vintage', 'Multi-Family', 'Books', 'Decor', 'Clothing'];

const emptyForm = {
  title: '',
  address: '',
  day: 'FRI',
  customDate: '',
  startTime: '09:00',
  endTime: '13:00',
  tags: [],
  description: '',
};

export default function PostScreen({ onCancel, onPublished, showToast }) {
  const [form, setForm] = useState(emptyForm);
  const [photos, setPhotos] = useState([]); // { file, previewUrl }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
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
    setForm(emptyForm);
    setPhotos([]);
  }

  async function handleSubmit() {
    setError(null);

    if (!form.title.trim() || !form.address.trim()) {
      setError('Please add a title and address.');
      return;
    }

    const saleDate = form.day === 'CUSTOM' ? form.customDate : upcomingDateFor(form.day);
    if (!saleDate) {
      setError('Please pick a date.');
      return;
    }

    setSubmitting(true);
    try {
      const location = await geocodeAddress(form.address);
      if (!location) {
        setError("We couldn't find that address on the map. Double-check it and try again.");
        setSubmitting(false);
        return;
      }

      if (!isSupabaseConfigured) {
        // Preview mode: no Supabase project connected yet.
        showToast?.('Preview mode: connect Supabase (see README) to actually publish sales.');
        resetForm();
        onPublished();
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
          <input
            className="text-input"
            placeholder="Street address"
            value={form.address}
            onChange={(e) => update('address', e.target.value)}
          />
          <p className="hint">We&apos;ll drop a pin here automatically once you publish.</p>
        </div>

        <div className="field-group">
          <p className="field-label">Date</p>
          <div className="day-pills" style={{ marginTop: 0 }}>
            {['FRI', 'SAT', 'SUN', 'CUSTOM'].map((d) => (
              <div
                key={d}
                className={`pill ${form.day === d ? 'active' : ''}`}
                onClick={() => update('day', d)}
              >
                {d === 'CUSTOM' ? 'Pick date…' : d}
              </div>
            ))}
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
