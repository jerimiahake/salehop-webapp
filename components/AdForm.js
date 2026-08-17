'use client';

import { useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';

// Admin-only ad creation form. Uses admin.module.css (passed in as
// `styles`, since that CSS Module lives under app/admin) rather than the
// mobile app's global classes -- this form is meant for a plain desktop
// panel, not the phone-frame mockup.
export default function AdForm({ styles, onCreated, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [sponsorName, setSponsorName] = useState('');
  const [image, setImage] = useState(null); // { file, previewUrl }
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

    if (!title.trim() || !linkUrl.trim()) {
      setError('An ad needs at least a title and a link.');
      return;
    }

    let normalizedLink = linkUrl.trim();
    if (!/^https?:\/\//i.test(normalizedLink)) {
      normalizedLink = `https://${normalizedLink}`;
    }

    setSubmitting(true);
    try {
      let imageUrl = null;
      if (image && isSupabaseConfigured) {
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
          title: title.trim(),
          description: description.trim() || null,
          link_url: normalizedLink,
          sponsor_name: sponsorName.trim() || null,
          image_url: imageUrl,
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

      <input
        className={styles.input}
        placeholder="Ad title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className={styles.textarea}
        placeholder="Short description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
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
