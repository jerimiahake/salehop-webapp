'use client';

import { useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { geocodeAddress } from '@/lib/geocode';

// Admin-only ad creation form. Uses admin.module.css (passed in as
// `styles`, since that CSS Module lives under app/admin) rather than the
// mobile app's global classes -- this form is meant for a plain desktop
// panel, not the phone-frame mockup.
//
// Two ad types:
//   "image"   -- title, optional image upload, link URL, optional sponsor
//                name. Renders as a styled card; tapping it opens the link.
//   "snippet" -- a raw HTML/JS embed (e.g. a Google AdSense/Ad Manager
//                tag) pasted in as-is. Only ever settable here, behind the
//                admin password -- see HtmlSnippet.js for why that matters.
//
// Independent of ad type: a "location" setting. Most ads (a coupon code,
// an online-only shop) are "Online Only" -- unchanged from before this
// existed. "Physical Location" is for a real place a buyer could actually
// drive to (a Goodwill, a Habitat for Humanity ReStore) -- typing an
// address here geocodes it the same way a sale's address is (via
// lib/geocode.js's /api/geocode proxy), which is what makes the ad show a
// favorite star in Browse and become addable to someone's route.
export default function AdForm({ styles, onCreated, onCancel }) {
  const [adType, setAdType] = useState('image');
  const [locationType, setLocationType] = useState('online');
  const [address, setAddress] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [sponsorName, setSponsorName] = useState('');
  const [image, setImage] = useState(null); // { file, previewUrl }
  const [htmlSnippet, setHtmlSnippet] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

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
      setError('Every ad needs a title, even a snippet ad -- it’s just for your own reference in the admin list.');
      return;
    }
    if (adType === 'image' && !linkUrl.trim()) {
      setError('An image ad needs a link -- that’s where tapping it goes.');
      return;
    }
    if (adType === 'snippet' && !htmlSnippet.trim()) {
      setError('Paste the ad snippet/embed code first.');
      return;
    }
    if (locationType === 'physical' && !address.trim()) {
      setError('A physical-location ad needs an address, so it can show a favorite star and be added to a route.');
      return;
    }

    let normalizedLink = null;
    if (adType === 'image') {
      normalizedLink = linkUrl.trim();
      if (!/^https?:\/\//i.test(normalizedLink)) {
        normalizedLink = `https://${normalizedLink}`;
      }
    }

    setSubmitting(true);
    try {
      let lat = null;
      let lng = null;
      if (locationType === 'physical') {
        const location = await geocodeAddress(address.trim());
        if (!location) {
          setError("We couldn't find that address on the map. Double-check it and try again.");
          setSubmitting(false);
          return;
        }
        lat = location.lat;
        lng = location.lng;
      }

      let imageUrl = null;
      if (adType === 'image' && image && isSupabaseConfigured) {
        // Reuses the existing "sale-photos" storage bucket (already public
        // read / open to uploads) under an "ads/" prefix, rather than
        // needing a whole new bucket + policy just for this.
        const path = `ads/${crypto.randomUUID()}-${image.file.name}`;
        const { error: uploadError } = await supabase.storage.from('sale-photos').upload(path, image.file);
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from('sale-photos').getPublicUrl(path);
        imageUrl = data.publicUrl;
      }

      const res = await fetch('/api/admin/ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ad_type: adType,
          title: title.trim(),
          description: description.trim() || null,
          link_url: normalizedLink,
          sponsor_name: adType === 'image' ? sponsorName.trim() || null : null,
          image_url: imageUrl,
          html_snippet: adType === 'snippet' ? htmlSnippet.trim() : null,
          location_type: locationType,
          address: locationType === 'physical' ? address.trim() : null,
          lat,
          lng,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create ad.');
      onCreated(data);
    } catch (err) {
      setError(err.message || 'Something went wrong creating the ad.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.formCard} onSubmit={handleSubmit}>
      <h2 className={styles.formHeading}>New Ad</h2>

      <div className={styles.typeToggle}>
        <button
          type="button"
          className={`${styles.typeToggleBtn} ${adType === 'image' ? styles.typeToggleBtnActive : ''}`}
          onClick={() => setAdType('image')}
        >
          Image + Link
        </button>
        <button
          type="button"
          className={`${styles.typeToggleBtn} ${adType === 'snippet' ? styles.typeToggleBtnActive : ''}`}
          onClick={() => setAdType('snippet')}
        >
          Code Snippet
        </button>
      </div>

      <div className={styles.typeToggle}>
        <button
          type="button"
          className={`${styles.typeToggleBtn} ${locationType === 'online' ? styles.typeToggleBtnActive : ''}`}
          onClick={() => setLocationType('online')}
        >
          Online Only
        </button>
        <button
          type="button"
          className={`${styles.typeToggleBtn} ${locationType === 'physical' ? styles.typeToggleBtnActive : ''}`}
          onClick={() => setLocationType('physical')}
        >
          Physical Location
        </button>
      </div>

      {locationType === 'physical' && (
        <>
          <input
            className={styles.input}
            placeholder="Address (e.g. a Goodwill or ReStore location)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <p className={styles.hint} style={{ marginTop: -4 }}>
            Geocoded the same way a sale&apos;s address is when you create the ad. This is what makes it show a
            favorite star in Browse and lets buyers add it to their route.
          </p>
        </>
      )}

      <input
        className={styles.input}
        placeholder="Ad title (for your reference in the admin list)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className={styles.textarea}
        placeholder="Short description (optional, admin reference only)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      {adType === 'image' ? (
        <>
          <input
            className={styles.input}
            placeholder="Link URL (where tapping the ad goes)"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
          />
          <input
            className={styles.input}
            placeholder="Sponsor name (optional)"
            value={sponsorName}
            onChange={(e) => setSponsorName(e.target.value)}
          />
          <label className={styles.imagePicker}>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image.previewUrl} alt="" />
            ) : (
              <span>📷 Add image (optional)</span>
            )}
            <input type="file" accept="image/*" hidden onChange={pickImage} />
          </label>
        </>
      ) : (
        <>
          <textarea
            className={styles.codeTextarea}
            placeholder="Paste the ad network's embed code here (e.g. a Google AdSense/Ad Manager snippet) -- including any <script> tags."
            value={htmlSnippet}
            onChange={(e) => setHtmlSnippet(e.target.value)}
            spellCheck={false}
          />
          <p className={styles.hint}>
            Only paste code from a source you trust -- it runs with full access to the page, the same as any
            embed code would on any site.
          </p>
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button type="submit" className={styles.button} disabled={submitting}>
          {submitting ? 'Creating…' : 'Create Ad'}
        </button>
        <button type="button" className={styles.linkButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
