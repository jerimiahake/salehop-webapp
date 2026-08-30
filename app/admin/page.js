'use client';

import { useEffect, useState } from 'react';
import styles from './admin.module.css';
import ListingForm from '@/components/ListingForm';
import AdForm from '@/components/AdForm';
import { formatDateRange } from '@/lib/format';
import { geocodeAddress } from '@/lib/geocode';

const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected'];

export default function AdminPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [message, setMessage] = useState(null);

  // "addListing" | "addAd" | null -- only one creation panel open at a time.
  const [activePanel, setActivePanel] = useState(null);

  const [ads, setAds] = useState([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsError, setAdsError] = useState(null);
  const [editingAdId, setEditingAdId] = useState(null);
  const [editAdDraft, setEditAdDraft] = useState(null);

  const [tags, setTags] = useState([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState(null);
  const [newTagName, setNewTagName] = useState('');
  const [addingTag, setAddingTag] = useState(false);

  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);

  const [errorReports, setErrorReports] = useState([]);
  const [errorReportsLoading, setErrorReportsLoading] = useState(false);
  const [errorReportsError, setErrorReportsError] = useState(null);

  const [contactMessages, setContactMessages] = useState([]);
  const [contactMessagesLoading, setContactMessagesLoading] = useState(false);
  const [contactMessagesError, setContactMessagesError] = useState(null);

  useEffect(() => {
    loadSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authed) {
      loadAds();
      loadTags();
      loadErrorReports();
      loadContactMessages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  async function loadSales() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/sales');
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load listings.');
      setSales(data);
      setAuthed(true);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setAuthChecked(true);
      setLoading(false);
    }
  }

  async function loadAds() {
    setAdsLoading(true);
    setAdsError(null);
    try {
      const res = await fetch('/api/admin/ads');
      if (res.status === 401) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load ads.');
      setAds(data);
    } catch (err) {
      setAdsError(err.message);
    } finally {
      setAdsLoading(false);
    }
  }

  // ---------- Tags ----------
  async function loadTags() {
    setTagsLoading(true);
    setTagsError(null);
    try {
      const res = await fetch('/api/admin/tags');
      if (res.status === 401) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load tags.');
      setTags(data);
    } catch (err) {
      setTagsError(err.message);
    } finally {
      setTagsLoading(false);
    }
  }

  async function handleAddTag(e) {
    e.preventDefault();
    if (!newTagName.trim()) return;
    setAddingTag(true);
    setTagsError(null);
    try {
      const res = await fetch('/api/admin/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTagName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add tag.');
      setTags((list) => [...list, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTagName('');
    } catch (err) {
      setTagsError(err.message);
    } finally {
      setAddingTag(false);
    }
  }

  async function handleDeleteTag(tag) {
    if (!window.confirm(`Remove the "${tag.name}" tag? Existing listings keep it -- this only affects the picker going forward.`)) return;
    try {
      const res = await fetch(`/api/admin/tags/${tag.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete tag.');
      setTags((list) => list.filter((t) => t.id !== tag.id));
    } catch (err) {
      setTagsError(err.message);
    }
  }

  // ---------- Support: error reports + contact messages ----------
  async function loadErrorReports() {
    setErrorReportsLoading(true);
    setErrorReportsError(null);
    try {
      const res = await fetch('/api/admin/error-reports');
      if (res.status === 401) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load error reports.');
      setErrorReports(data);
    } catch (err) {
      setErrorReportsError(err.message);
    } finally {
      setErrorReportsLoading(false);
    }
  }

  async function loadContactMessages() {
    setContactMessagesLoading(true);
    setContactMessagesError(null);
    try {
      const res = await fetch('/api/admin/contact-messages');
      if (res.status === 401) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load contact messages.');
      setContactMessages(data);
    } catch (err) {
      setContactMessagesError(err.message);
    } finally {
      setContactMessagesLoading(false);
    }
  }

  async function toggleErrorResolved(report) {
    try {
      const res = await fetch(`/api/admin/error-reports/${report.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: !report.resolved }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed.');
      setErrorReports((list) => list.map((r) => (r.id === report.id ? data : r)));
    } catch (err) {
      setMessage(`Couldn't update: ${err.message}`);
    }
  }

  async function handleDeleteErrorReport(report) {
    if (!window.confirm("Delete this error report? This can't be undone.")) return;
    try {
      const res = await fetch(`/api/admin/error-reports/${report.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed.');
      setErrorReports((list) => list.filter((r) => r.id !== report.id));
    } catch (err) {
      setMessage(`Couldn't delete: ${err.message}`);
    }
  }

  async function toggleContactResolved(msg) {
    try {
      const res = await fetch(`/api/admin/contact-messages/${msg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: !msg.resolved }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed.');
      setContactMessages((list) => list.map((m) => (m.id === msg.id ? data : m)));
    } catch (err) {
      setMessage(`Couldn't update: ${err.message}`);
    }
  }

  async function handleDeleteContactMessage(msg) {
    if (!window.confirm("Delete this message? This can't be undone.")) return;
    try {
      const res = await fetch(`/api/admin/contact-messages/${msg.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed.');
      setContactMessages((list) => list.filter((m) => m.id !== msg.id));
    } catch (err) {
      setMessage(`Couldn't delete: ${err.message}`);
    }
  }

  // Uploads the filled-out spreadsheet to /api/admin/sales/import, which
  // geocodes and creates each valid row as an already-approved listing
  // (same as "+ Add Listing"). Can take a while for a large file -- each
  // row is geocoded one at a time to respect Nominatim's free-service rate
  // limit -- so this shows a "this can take a minute" hint while it runs.
  async function handleImport(e) {
    e.preventDefault();
    if (!importFile) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const body = new FormData();
      body.append('file', importFile);
      const res = await fetch('/api/admin/sales/import', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed.');
      setImportResult(data);
      setImportFile(null);
      if (data.imported > 0) {
        await loadSales();
      }
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Incorrect password.');
      setPassword('');
      await loadSales();
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setAuthed(false);
    setSales([]);
    setAds([]);
    setTags([]);
  }

  async function updateSale(id, updates) {
    const res = await fetch(`/api/admin/sales/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Update failed.');
    return data;
  }

  async function handleApprove(sale) {
    try {
      const updated = await updateSale(sale.id, { status: 'approved' });
      setSales((list) => list.map((s) => (s.id === sale.id ? updated : s)));
      setMessage(`Approved "${sale.title}".`);
    } catch (err) {
      setMessage(`Couldn't approve: ${err.message}`);
    }
  }

  async function handleReject(sale) {
    try {
      const updated = await updateSale(sale.id, { status: 'rejected' });
      setSales((list) => list.map((s) => (s.id === sale.id ? updated : s)));
      setMessage(`Rejected "${sale.title}".`);
    } catch (err) {
      setMessage(`Couldn't reject: ${err.message}`);
    }
  }

  async function handleDelete(sale) {
    if (!window.confirm(`Permanently delete "${sale.title}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/sales/${sale.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed.');
      setSales((list) => list.filter((s) => s.id !== sale.id));
      setMessage(`Deleted "${sale.title}".`);
    } catch (err) {
      setMessage(`Couldn't delete: ${err.message}`);
    }
  }

  function startEdit(sale) {
    setEditingId(sale.id);
    setEditDraft({
      title: sale.title,
      address: sale.address,
      sale_date: sale.sale_date,
      end_date: sale.end_date || '',
      start_time: (sale.start_time || '').slice(0, 5),
      end_time: (sale.end_time || '').slice(0, 5),
      description: sale.description || '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  async function saveEdit(sale) {
    try {
      // "" from an empty date input means "no end date" -- send null, not
      // an empty string, since end_date is a Postgres date column.
      const updated = await updateSale(sale.id, { ...editDraft, end_date: editDraft.end_date || null });
      setSales((list) => list.map((s) => (s.id === sale.id ? updated : s)));
      setMessage(`Saved changes to "${updated.title}".`);
      cancelEdit();
    } catch (err) {
      setMessage(`Couldn't save: ${err.message}`);
    }
  }

  // ---------- Ads ----------
  async function updateAd(id, updates) {
    const res = await fetch(`/api/admin/ads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Update failed.');
    return data;
  }

  async function toggleAdActive(ad) {
    try {
      const updated = await updateAd(ad.id, { active: !ad.active });
      setAds((list) => list.map((a) => (a.id === ad.id ? updated : a)));
      setMessage(`${updated.active ? 'Activated' : 'Deactivated'} "${updated.title}".`);
    } catch (err) {
      setMessage(`Couldn't update: ${err.message}`);
    }
  }

  async function handleDeleteAd(ad) {
    if (!window.confirm(`Permanently delete the ad "${ad.title}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/ads/${ad.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed.');
      setAds((list) => list.filter((a) => a.id !== ad.id));
      setMessage(`Deleted ad "${ad.title}".`);
    } catch (err) {
      setMessage(`Couldn't delete: ${err.message}`);
    }
  }

  function startEditAd(ad) {
    setEditingAdId(ad.id);
    setEditAdDraft({
      title: ad.title,
      description: ad.description || '',
      link_url: ad.link_url || '',
      sponsor_name: ad.sponsor_name || '',
      html_snippet: ad.html_snippet || '',
      location_type: ad.location_type || 'online',
      address: ad.address || '',
    });
  }

  function cancelEditAd() {
    setEditingAdId(null);
    setEditAdDraft(null);
  }

  async function saveEditAd(ad) {
    try {
      const draft = { ...editAdDraft };

      if (draft.location_type === 'physical') {
        if (!draft.address.trim()) {
          setMessage("Couldn't save: a physical-location ad needs an address.");
          return;
        }
        // Re-geocode any time it's saved as physical -- cheap, and the
        // only way to know the coordinates still match if the address
        // text changed. Harmless (just a fraction of a second slower) on
        // a save where the address didn't change.
        const location = await geocodeAddress(draft.address.trim());
        if (!location) {
          setMessage("Couldn't save: couldn't find that address on the map. Double-check it and try again.");
          return;
        }
        draft.lat = location.lat;
        draft.lng = location.lng;
      } else {
        draft.address = null;
        draft.lat = null;
        draft.lng = null;
      }

      const updated = await updateAd(ad.id, draft);
      setAds((list) => list.map((a) => (a.id === ad.id ? updated : a)));
      setMessage(`Saved changes to "${updated.title}".`);
      cancelEditAd();
    } catch (err) {
      setMessage(`Couldn't save: ${err.message}`);
    }
  }

  const filteredSales = filter === 'all' ? sales : sales.filter((s) => s.status === filter);
  const counts = STATUS_FILTERS.reduce((acc, key) => {
    acc[key] = key === 'all' ? sales.length : sales.filter((s) => s.status === key).length;
    return acc;
  }, {});

  if (!authChecked) {
    return (
      <div className={styles.wrap}>
        <p className={styles.hint}>Loading…</p>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className={styles.loginWrap}>
        <form className={styles.loginCard} onSubmit={handleLogin}>
          <h1>SaleHop Admin</h1>
          <p className={styles.hint}>Enter the admin password to manage listings.</p>
          <input
            type="password"
            className={styles.input}
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {loginError && <p className={styles.error}>{loginError}</p>}
          <button type="submit" className={styles.button} disabled={loggingIn || !password}>
            {loggingIn ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1>SaleHop Admin</h1>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => setActivePanel(activePanel === 'addListing' ? null : 'addListing')}
          >
            {activePanel === 'addListing' ? 'Close' : '+ Add Listing'}
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => setActivePanel(activePanel === 'addAd' ? null : 'addAd')}
          >
            {activePanel === 'addAd' ? 'Close' : '+ Add Ad'}
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => setActivePanel(activePanel === 'import' ? null : 'import')}
          >
            {activePanel === 'import' ? 'Close' : '+ Import Spreadsheet'}
          </button>
          <button type="button" className={styles.linkButton} onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      {message && <div className={styles.banner}>{message}</div>}
      {loadError && <div className={styles.bannerError}>{loadError}</div>}

      {activePanel === 'addListing' && (
        <div className={styles.listingFormWrap}>
          <ListingForm
            mode="admin-create"
            onCancel={() => setActivePanel(null)}
            onDone={(msg) => {
              setActivePanel(null);
              setMessage(msg);
              loadSales();
            }}
          />
        </div>
      )}

      {activePanel === 'addAd' && (
        <AdForm
          styles={styles}
          onCancel={() => setActivePanel(null)}
          onCreated={(ad) => {
            setAds((list) => [ad, ...list]);
            setActivePanel(null);
            setMessage(`Created ad "${ad.title}".`);
          }}
        />
      )}

      {activePanel === 'import' && (
        <div className={styles.importPanel}>
          <p className={styles.hint}>
            Fill out the template spreadsheet in Excel, one row per sale, then upload it here.
            Each imported listing goes live immediately (same as &quot;+ Add Listing&quot;).{' '}
            <a href="/salehop-listing-import-template.xlsx" download>
              Download the template
            </a>
            .
          </p>

          <form onSubmit={handleImport}>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              className={styles.input}
            />
            {importError && <p className={styles.error}>{importError}</p>}
            <button type="submit" className={styles.button} disabled={!importFile || importing}>
              {importing ? 'Importing… this can take a minute, please don’t close this tab' : 'Upload & Import'}
            </button>
          </form>

          {importResult && (
            <div className={styles.importResult}>
              <p className={styles.banner}>
                Imported {importResult.imported} listing{importResult.imported === 1 ? '' : 's'}.
                {importResult.truncated
                  ? ` This file had more rows than fit in one import (max ${importResult.maxRows}) -- delete the rows already imported and re-upload the rest.`
                  : ''}
              </p>
              {importResult.approximate?.length > 0 && (
                <>
                  <p className={styles.hint} style={{ marginTop: 10 }}>
                    {importResult.approximate.length} listing{importResult.approximate.length === 1 ? '' : 's'} couldn&apos;t be
                    pinned to the exact address, so the map location is an approximation (right street, may be off by a house
                    or two) -- worth a quick look:
                  </p>
                  <ul className={styles.importSkipList}>
                    {importResult.approximate.map((r) => (
                      <li key={r.row} className={styles.importSkipRow}>
                        <b>Row {r.row}</b> ({r.title})
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {importResult.skipped.length > 0 && (
                <>
                  <p className={styles.hint} style={{ marginTop: 10 }}>
                    Skipped {importResult.skipped.length} row{importResult.skipped.length === 1 ? '' : 's'} -- fix these in the
                    spreadsheet and re-upload just those rows if you want them included:
                  </p>
                  <ul className={styles.importSkipList}>
                    {importResult.skipped.map((s) => (
                      <li key={s.row} className={styles.importSkipRow}>
                        <b>Row {s.row}</b> ({s.title}): {s.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className={styles.filters}>
        {STATUS_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={`${styles.filterBtn} ${filter === key ? styles.filterBtnActive : ''}`}
            onClick={() => setFilter(key)}
          >
            {key[0].toUpperCase() + key.slice(1)} ({counts[key]})
          </button>
        ))}
        <button type="button" className={styles.linkButton} onClick={loadSales} style={{ marginLeft: 'auto' }}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className={styles.list}>
        {filteredSales.length === 0 && <p className={styles.hint}>No listings here.</p>}

        {filteredSales.map((sale) => (
          <div className={styles.row} key={sale.id}>
            {editingId === sale.id ? (
              <div className={styles.editForm}>
                <input
                  className={styles.input}
                  value={editDraft.title}
                  onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Title"
                />
                <input
                  className={styles.input}
                  value={editDraft.address}
                  onChange={(e) => setEditDraft((d) => ({ ...d, address: e.target.value }))}
                  placeholder="Address"
                />
                <div className={styles.editRow}>
                  <input
                    type="date"
                    className={styles.input}
                    value={editDraft.sale_date}
                    onChange={(e) => setEditDraft((d) => ({ ...d, sale_date: e.target.value }))}
                  />
                  <input
                    type="date"
                    className={styles.input}
                    value={editDraft.end_date}
                    min={editDraft.sale_date}
                    placeholder="End date (optional)"
                    onChange={(e) => setEditDraft((d) => ({ ...d, end_date: e.target.value }))}
                  />
                  <input
                    type="time"
                    className={styles.input}
                    value={editDraft.start_time}
                    onChange={(e) => setEditDraft((d) => ({ ...d, start_time: e.target.value }))}
                  />
                  <input
                    type="time"
                    className={styles.input}
                    value={editDraft.end_time}
                    onChange={(e) => setEditDraft((d) => ({ ...d, end_time: e.target.value }))}
                  />
                </div>
                <p className={styles.hint} style={{ marginTop: -4 }}>
                  Leave end date blank for a single-day sale.
                </p>
                <textarea
                  className={styles.textarea}
                  value={editDraft.description}
                  onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Description"
                />
                <div className={styles.actions}>
                  <button type="button" className={styles.button} onClick={() => saveEdit(sale)}>
                    Save
                  </button>
                  <button type="button" className={styles.linkButton} onClick={cancelEdit}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.rowMain}>
                  <span className={`${styles.badge} ${styles[`badge_${sale.status}`]}`}>{sale.status}</span>
                  <div>
                    <p className={styles.rowTitle}>{sale.title}</p>
                    <p className={styles.rowSub}>{sale.address}</p>
                    <p className={styles.rowSub}>
                      {formatDateRange(sale.sale_date, sale.end_date)} · {(sale.start_time || '').slice(0, 5)}–{(sale.end_time || '').slice(0, 5)}
                      {sale.is_neighborhood_sale && sale.neighborhood_name ? ` · 🏘️ ${sale.neighborhood_name}` : ''}
                      {sale.featured && sale.featured_until ? ` · ⭐ Featured until ${sale.featured_until}` : ''}
                    </p>
                  </div>
                </div>
                <div className={styles.actions}>
                  {sale.status !== 'approved' && (
                    <button type="button" className={styles.button} onClick={() => handleApprove(sale)}>
                      Approve
                    </button>
                  )}
                  {sale.status !== 'rejected' && (
                    <button type="button" className={styles.buttonSecondary} onClick={() => handleReject(sale)}>
                      Reject
                    </button>
                  )}
                  <button type="button" className={styles.linkButton} onClick={() => startEdit(sale)}>
                    Edit
                  </button>
                  <button type="button" className={styles.linkButtonDanger} onClick={() => handleDelete(sale)}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <h2 className={styles.sectionHeading}>Ads</h2>

      {adsError && <div className={styles.bannerError}>{adsError}</div>}
      {adsLoading && <p className={styles.hint}>Loading ads…</p>}
      {!adsLoading && ads.length === 0 && (
        <p className={styles.hint}>No ads yet. Use &ldquo;+ Add Ad&rdquo; above to create one.</p>
      )}

      <div className={styles.list}>
        {ads.map((ad) => (
          <div className={styles.row} key={ad.id}>
            {editingAdId === ad.id ? (
              <div className={styles.editForm}>
                <input
                  className={styles.input}
                  value={editAdDraft.title}
                  onChange={(e) => setEditAdDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Title"
                />
                <textarea
                  className={styles.textarea}
                  value={editAdDraft.description}
                  onChange={(e) => setEditAdDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Description"
                />
                <div className={styles.typeToggle}>
                  <button
                    type="button"
                    className={`${styles.typeToggleBtn} ${editAdDraft.location_type === 'online' ? styles.typeToggleBtnActive : ''}`}
                    onClick={() => setEditAdDraft((d) => ({ ...d, location_type: 'online' }))}
                  >
                    Online Only
                  </button>
                  <button
                    type="button"
                    className={`${styles.typeToggleBtn} ${editAdDraft.location_type === 'physical' ? styles.typeToggleBtnActive : ''}`}
                    onClick={() => setEditAdDraft((d) => ({ ...d, location_type: 'physical' }))}
                  >
                    Physical Location
                  </button>
                </div>
                {editAdDraft.location_type === 'physical' && (
                  <input
                    className={styles.input}
                    value={editAdDraft.address}
                    onChange={(e) => setEditAdDraft((d) => ({ ...d, address: e.target.value }))}
                    placeholder="Address"
                  />
                )}
                {ad.ad_type === 'snippet' ? (
                  <textarea
                    className={styles.codeTextarea}
                    value={editAdDraft.html_snippet}
                    onChange={(e) => setEditAdDraft((d) => ({ ...d, html_snippet: e.target.value }))}
                    placeholder="Embed code"
                    spellCheck={false}
                  />
                ) : (
                  <>
                    <input
                      className={styles.input}
                      value={editAdDraft.link_url}
                      onChange={(e) => setEditAdDraft((d) => ({ ...d, link_url: e.target.value }))}
                      placeholder="Link URL"
                    />
                    <input
                      className={styles.input}
                      value={editAdDraft.sponsor_name}
                      onChange={(e) => setEditAdDraft((d) => ({ ...d, sponsor_name: e.target.value }))}
                      placeholder="Sponsor name"
                    />
                  </>
                )}
                <div className={styles.actions}>
                  <button type="button" className={styles.button} onClick={() => saveEditAd(ad)}>
                    Save
                  </button>
                  <button type="button" className={styles.linkButton} onClick={cancelEditAd}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.rowMain}>
                  <span className={`${styles.badge} ${ad.active ? styles.badge_approved : styles.badge_rejected}`}>
                    {ad.active ? 'active' : 'inactive'}
                  </span>
                  <div>
                    <p className={styles.rowTitle}>{ad.title}</p>
                    <p className={styles.rowSub}>
                      {ad.ad_type === 'snippet'
                        ? '</> Code Snippet'
                        : ad.sponsor_name
                        ? `Sponsored by ${ad.sponsor_name}`
                        : ad.link_url}
                    </p>
                    {ad.location_type === 'physical' && (
                      <p className={styles.rowSub}>📍 {ad.address}{!Number.isFinite(ad.lat) ? ' (not located on the map)' : ''}</p>
                    )}
                  </div>
                </div>
                <div className={styles.actions}>
                  <button type="button" className={styles.button} onClick={() => toggleAdActive(ad)}>
                    {ad.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button type="button" className={styles.linkButton} onClick={() => startEditAd(ad)}>
                    Edit
                  </button>
                  <button type="button" className={styles.linkButtonDanger} onClick={() => handleDeleteAd(ad)}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <h2 className={styles.sectionHeading}>Listing Tags</h2>
      <p className={styles.hint}>
        These are the category chips (Tools, Clothing, and so on) sellers can pick from when posting a sale.
        Deleting a tag here only removes it from the picker going forward -- it won&apos;t change any listings
        that already have it.
      </p>

      {tagsError && <div className={styles.bannerError}>{tagsError}</div>}
      {tagsLoading && <p className={styles.hint}>Loading tags…</p>}

      <form className={styles.tagAddRow} onSubmit={handleAddTag}>
        <input
          className={styles.input}
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          placeholder="New tag name (e.g. Tools)"
        />
        <button type="submit" className={styles.button} disabled={addingTag || !newTagName.trim()}>
          {addingTag ? 'Adding…' : '+ Add Tag'}
        </button>
      </form>

      {!tagsLoading && tags.length === 0 && <p className={styles.hint}>No tags yet.</p>}

      <div className={styles.tagList}>
        {tags.map((tag) => (
          <span key={tag.id} className={styles.tagChip}>
            {tag.name}
            <button
              type="button"
              className={styles.tagChipRemove}
              onClick={() => handleDeleteTag(tag)}
              aria-label={`Remove ${tag.name}`}
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      <h2 className={styles.sectionHeading}>Support</h2>
      <p className={styles.hint}>
        Signup and listing-submission failures are logged automatically, so you can see if visitors are running
        into trouble even if they never tell you directly. Contact messages come from the public /contact page --
        each one also tries to email the admin address; if that email fails, the message is still saved here as a
        backup.
      </p>

      <h3 className={styles.subHeading}>Signup / Listing Errors</h3>
      {errorReportsError && <div className={styles.bannerError}>{errorReportsError}</div>}
      {errorReportsLoading && <p className={styles.hint}>Loading…</p>}
      {!errorReportsLoading && errorReports.length === 0 && <p className={styles.hint}>No errors logged. 🎉</p>}

      <div className={styles.list}>
        {errorReports.map((report) => (
          <div className={styles.row} key={report.id}>
            <div className={styles.rowMain}>
              <span className={`${styles.badge} ${report.resolved ? styles.badge_approved : styles.badge_pending}`}>
                {report.kind}
              </span>
              <div>
                <p className={styles.rowTitle}>{report.message}</p>
                <p className={styles.rowSub}>
                  {new Date(report.created_at).toLocaleString()}
                  {report.email ? ` · ${report.email}` : ''}
                </p>
                {report.context && <p className={styles.rowSub}>{JSON.stringify(report.context)}</p>}
              </div>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.linkButton} onClick={() => toggleErrorResolved(report)}>
                {report.resolved ? 'Mark Unresolved' : 'Mark Resolved'}
              </button>
              <button type="button" className={styles.linkButtonDanger} onClick={() => handleDeleteErrorReport(report)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <h3 className={styles.subHeading}>Contact Messages</h3>
      {contactMessagesError && <div className={styles.bannerError}>{contactMessagesError}</div>}
      {contactMessagesLoading && <p className={styles.hint}>Loading…</p>}
      {!contactMessagesLoading && contactMessages.length === 0 && <p className={styles.hint}>No messages yet.</p>}

      <div className={styles.list}>
        {contactMessages.map((msg) => (
          <div className={styles.row} key={msg.id}>
            <div className={styles.rowMain}>
              <span className={`${styles.badge} ${msg.resolved ? styles.badge_approved : styles.badge_pending}`}>
                {msg.resolved ? 'resolved' : 'new'}
              </span>
              <div>
                <p className={styles.rowTitle}>{msg.name ? `${msg.name} · ${msg.email}` : msg.email}</p>
                <p className={styles.rowSub}>{msg.message}</p>
                <p className={styles.rowSub}>
                  {new Date(msg.created_at).toLocaleString()} · {msg.email_sent ? '✅ emailed' : '⚠️ email not sent'}
                </p>
              </div>
            </div>
            <div className={styles.actions}>
              <a className={styles.linkButton} href={`mailto:${msg.email}`}>
                Reply
              </a>
              <button type="button" className={styles.linkButton} onClick={() => toggleContactResolved(msg)}>
                {msg.resolved ? 'Mark Unresolved' : 'Mark Resolved'}
              </button>
              <button type="button" className={styles.linkButtonDanger} onClick={() => handleDeleteContactMessage(msg)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
