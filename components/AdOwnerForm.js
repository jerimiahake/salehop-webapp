'use client';

import { useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { geocodeAddress } from '@/lib/geocode';

// Lets a signed-in advertiser edit their own ad -- the "My Ad" section of
// AccountScreen.js. A trimmed-down cousin of AdForm.js/the admin panel's
// inline ad editor: same fields, but no ad-type toggle and no embed-code
// textarea, since an owner is blocked (see supabase/schema-v12-ad-
// ownership.sql's protection trigger) from changing ad_type, html_snippet,
// or active/paused status -- those stay admin-only regardless of what this
// form sends. Saves go straight through Supabase (not an /api/admin route)
// using the signed-in owner's own session, so row-level security is what
// actually enforces "only your own ad" -- this form never needs to prove
// that itself.
export default function AdOwnerForm({ ad, onDone, onCancel }) {
  const [title, setTitle] = useState(ad.title || '');
  const [description, setDescription] = useState(ad.description || '');
  const [linkUrl, setLinkUrl] = useState(ad.link_url || '');
  const [sponsorName, setSponsorName] = useState(ad.sponsor_name || '');
  const [locationType, setLocationType] = useState(ad.location_type || 'online');
  const [address, setAddress] = useState(ad.address || '');
  const [linkOnly, setLinkOnly] = useState(ad.link_only || false);
  const [image, setImage] = useState(null); // { file, previewUrl } -- only set if replacing the image
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const isSnippet = ad.ad_type === 'snippet';

  function pickImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImage({ file, previewUrl: URL.createObjectURL(file) });
    e.target.value = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Every ad needs a title.');
      return;
    }
    if (!isSnippet && !linkUrl.trim()) {
      setError('This ad needs a link -- that’s where tapping it goes.');
      return;
    }
    if (locationType === 'physical' && !address.trim()) {
      setError('A physical-location ad needs an address, so it can show a favorite star and be added to a route.');
      return;
    }

    setSubmitting(true);
    try {
      let lat = ad.lat;
      let lng = ad.lng;
      if (locationType === 'physical') {
        // Re-geocode any time it's saved as physical -- cheap, and the
        // only way to know the coordinates still match if the address
        // text changed.
        const location = await geocodeAddress(address.trim());
        if (!location) {
          setError("We couldn't find that address on the map. Double-check it and try again.");
          setSubmitting(false);
          return;
        }
        lat = location.lat;
        lng = location.lng;
      } else {
        lat = null;
        lng = null;
      }

      let normalizedLink = ad.link_url;
      if (!isSnippet) {
        normalizedLink = linkUrl.trim();
        if (!/^https?:\/\//i.test(normalizedLink)) {
          normalizedLink = `https://${normalizedLink}`;
        }
      }

      let imageUrl = ad.image_url;
      if (!isSnippet && image && isSupabaseConfigured) {
        const path = `ads/${crypto.randomUUID()}-${image.file.name}`;
        const { error: uploadError } = await supabase.storage.from('sale-photos').upload(path, image.file);
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from('sale-photos').getPublicUrl(path);
        imageUrl = data.publicUrl;
      }

      const updates = {
        title: title.trim(),
        description: description.trim() || null,
        location_type: locationType,
        address: locationType === 'physical' ? address.trim() : null,
        lat,
        lng,
        // ad_type, html_snippet, owner_email, and active are intentionally
        // omitted -- the database silently keeps them unchanged for
        // anyone but the admin service-role connection, so there's no
        // point sending them here.
      };
      if (!isSnippet) {
        updates.link_url = normalizedLink;
        updates.sponsor_name = sponsorName.trim() || null;
        updates.image_url = imageUrl;
        updates.link_only = linkOnly;
      }

      const { error: updateError } = await supabase.from('ads').update(updates).eq('id', ad.id);
      if (updateError) throw updateError;

      onDone('✅ Ad updated.');
    } catch (err) {
      setError(err.message || 'Something went wrong saving your ad.');
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
        <div className="title">Edit Your Ad</div>
      </div>

      <div className="post-scroll">
      {isSnippet && (
        <p className="hint" style={{ marginBottom: 12 }}>
          This ad&apos;s embed code, ad type, and active/paused status can only be changed by
          SaleHop -- <a href="/contact" style={{ textDecoration: 'underline' }}>contact us</a> to
          update those. You can still edit the title and description below (used on your ad&apos;s
          shareable page).
        </p>
      )}

      <div className="field-group">
        <p className="field-label">Title</p>
        <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="field-group">
        <p className="field-label">Description</p>
        <textarea
          className="text-input"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional -- shown on your ad&apos;s shareable page."
        />
      </div>

      {!isSnippet && (
        <>
          <div className="field-group">
            <p className="field-label">Link URL</p>
            <input className="text-input" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
          </div>

          <div className="field-group">
            <p className="field-label">Sponsor name</p>
            <input
              className="text-input"
              value={sponsorName}
              onChange={(e) => setSponsorName(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="field-group">
            <label className="neighborhood-toggle">
              <input
                type="checkbox"
                checked={linkOnly}
                onChange={(e) => setLinkOnly(e.target.checked)}
              />
              <span>🔗 Skip my ad&apos;s page -- open my link directly when tapped</span>
            </label>
            <p className="hint" style={{ marginTop: 6 }}>
              Leave unchecked (recommended) so tapping your ad opens its own page in SaleHop first --
              your image, description, a &ldquo;Visit Website&rdquo; button, and check-ins if you&apos;re
              a physical location.
            </p>
          </div>

          <div className="field-group">
            <p className="field-label">Image</p>
            <div className="photo-row">
              {image || ad.image_url ? (
                <label className="photo-thumb" style={{ cursor: 'pointer' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image ? image.previewUrl : ad.image_url} alt="" />
                  <input type="file" accept="image/*" hidden onChange={pickImage} />
                </label>
              ) : (
                <label className="photo-add">
                  <span style={{ fontSize: 18 }}>📷</span>
                  <span>Add</span>
                  <input type="file" accept="image/*" hidden onChange={pickImage} />
                </label>
              )}
            </div>
            <p className="hint" style={{ marginTop: 6 }}>Tap the image to replace it.</p>
          </div>

          <div className="field-group">
            <label className="neighborhood-toggle">
              <input
                type="checkbox"
                checked={locationType === 'physical'}
                onChange={(e) => setLocationType(e.target.checked ? 'physical' : 'online')}
              />
              <span>📍 This is a real place buyers can visit</span>
            </label>
            {locationType === 'physical' && (
              <>
                <input
                  className="text-input"
                  style={{ marginTop: 10 }}
                  placeholder="Address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
                <p className="hint" style={{ marginTop: 6 }}>
                  This is what makes your ad show a favorite star in Browse and lets buyers add it
                  to their route.
                </p>
              </>
            )}
          </div>
        </>
      )}

      {error && <p className="error-hint">{error}</p>}
      </div>

      <div className="publish-bar">
        <button type="button" className="publish-btn" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Saving…' : 'Save Changes →'}
        </button>
      </div>
    </>
  );
}
