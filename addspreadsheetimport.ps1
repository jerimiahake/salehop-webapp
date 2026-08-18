# Adds bulk listing import: fill out a spreadsheet in Excel (one row per
# garage sale), upload it from a new "+ Import Spreadsheet" button in
# /admin, and each valid row becomes a live, already-approved listing --
# geocoded and pinned on the map automatically, same as "+ Add Listing".
# Rows with a problem (missing info, an address that can't be located) are
# skipped and reported back individually rather than failing the whole
# file.
#
# This adds the project's second new npm dependency ("xlsx", for reading
# the uploaded spreadsheet on the server) -- npm install runs as part of
# this script, same as the Stripe round did.
#
# Also delivers public/salehop-listing-import-template.xlsx -- the actual
# template file, downloadable right from the admin panel's new Import
# button. No database changes needed for this one.
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
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: npm isn't installed (or not on PATH)." -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path "app\api\admin\sales\import" | Out-Null
New-Item -ItemType Directory -Force -Path "app\admin" | Out-Null
New-Item -ItemType Directory -Force -Path "public" | Out-Null

Write-Host "Installing the xlsx package (reads uploaded spreadsheets on the server) ..." -ForegroundColor Cyan
npm install xlsx

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: npm install xlsx failed -- scroll up for the error and send it to me before continuing." -ForegroundColor Red
    exit 1
}

Write-Host "Writing app\api\admin\sales\import\route.js ..." -ForegroundColor Cyan
@'
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';
import { extractCity } from '@/lib/nominatimAddress';

// Bulk-creates listings from an uploaded .xlsx spreadsheet (the template at
// public/salehop-listing-import-template.xlsx). Each row gets geocoded
// through the same free Nominatim service the rest of the app uses, one at
// a time with a pause between requests -- Nominatim's usage policy caps
// automated use at 1 request/second
// (https://operations.osmfoundation.org/policies/nominatim/), so a bigger
// file just takes proportionally longer, it doesn't fail.
//
// Vercel's default function duration (with fluid compute, which is on by
// default) is 5 minutes even on the free Hobby plan, so this has plenty of
// room -- but MAX_ROWS below still caps a single import so an accidentally
// huge file fails fast and clearly instead of quietly running for minutes.
export const maxDuration = 240;

const MAX_ROWS = 150;
const NOMINATIM_DELAY_MS = 1100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidCalendarDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Accepts "YYYY-MM-DD" (what the template asks for) or "M/D/YYYY" (what
// Excel tends to produce if someone types a date and it gets auto-
// formatted anyway). Returns "YYYY-MM-DD" or null if unrecognized/invalid.
function parseDateFlexible(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!isValidCalendarDate(y, mo, d)) return null;
    return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    const y = Number(m[3]);
    if (!isValidCalendarDate(y, mo, d)) return null;
    return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

// Accepts "9:00 AM" / "9:00am" / "9:00 A.M." style, or a bare 24-hour
// "HH:MM". Returns "HH:MM" (24-hour) or null if unrecognized.
function parseTimeFlexible(raw) {
  const s = String(raw || '').trim();

  let m = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m) {
    return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
  }

  m = s.match(/^(\d{1,2}):([0-5]\d)\s*([AaPp])\.?[Mm]\.?$/);
  if (m) {
    let h = Number(m[1]);
    const min = m[2];
    if (h < 1 || h > 12) return null;
    const isPm = m[3].toLowerCase() === 'p';
    if (isPm) h = h === 12 ? 12 : h + 12;
    else h = h === 12 ? 0 : h;
    return `${String(h).padStart(2, '0')}:${min}`;
  }

  return null;
}

// Same lookup the rest of the app uses (see app/api/geocode/route.js), one
// address at a time -- not batched, since Nominatim's free service asks
// for real spacing between automated requests.
async function geocodeOne(address) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('q', address);
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');

  let res;
  try {
    res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'SaleHop/1.0 (garage sale finder; contact via site owner)',
        'Accept-Language': 'en',
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const results = await res.json();
  if (!results || results.length === 0) return null;

  return {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
    city: extractCity(results[0].address),
  };
}

export async function POST(request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Could not read the uploaded file.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 });
  }

  let workbook;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return NextResponse.json({ error: "Couldn't read that file -- is it a valid .xlsx file?" }, { status: 400 });
  }

  const sheetName = workbook.SheetNames.includes('Listings') ? 'Listings' : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return NextResponse.json({ error: 'No sheet found in that file.' }, { status: 400 });
  }

  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const imported = [];
  const skipped = [];
  let truncated = false;
  let geocodeCalls = 0;

  for (let i = 0; i < rawRows.length; i++) {
    if (imported.length + skipped.length >= MAX_ROWS) {
      truncated = rawRows.length - i > 0;
      break;
    }

    const rowNum = i + 2; // header is row 1
    const row = rawRows[i];

    const title = String(row['Title'] || '').trim();
    const address = String(row['Address'] || '').trim();

    // A fully blank row (no title, no address) is just spacing -- skip
    // quietly rather than reporting it as an error.
    if (!title && !address) continue;

    const startDateRaw = String(row['Start Date'] || '').trim();
    const endDateRaw = String(row['End Date'] || '').trim();
    const startTimeRaw = String(row['Start Time'] || '').trim();
    const endTimeRaw = String(row['End Time'] || '').trim();
    const tagsRaw = String(row['Tags'] || '').trim();
    const description = String(row['Description'] || '').trim();
    const neighborhoodRaw = String(row['Neighborhood Sale Name'] || '').trim();

    if (!title || !address || !startDateRaw || !startTimeRaw || !endTimeRaw) {
      skipped.push({
        row: rowNum,
        title: title || '(no title)',
        reason: 'Missing a required field (Title, Address, Start Date, Start Time, or End Time).',
      });
      continue;
    }

    const saleDate = parseDateFlexible(startDateRaw);
    if (!saleDate) {
      skipped.push({ row: rowNum, title, reason: `Couldn't understand the Start Date "${startDateRaw}" -- use YYYY-MM-DD.` });
      continue;
    }

    let endDate = null;
    if (endDateRaw) {
      endDate = parseDateFlexible(endDateRaw);
      if (!endDate) {
        skipped.push({ row: rowNum, title, reason: `Couldn't understand the End Date "${endDateRaw}" -- use YYYY-MM-DD.` });
        continue;
      }
      if (endDate < saleDate) {
        skipped.push({ row: rowNum, title, reason: 'End Date is before Start Date.' });
        continue;
      }
    }

    const startTime = parseTimeFlexible(startTimeRaw);
    const endTime = parseTimeFlexible(endTimeRaw);
    if (!startTime || !endTime) {
      skipped.push({
        row: rowNum,
        title,
        reason: `Couldn't understand a time ("${startTimeRaw}" / "${endTimeRaw}") -- use e.g. "9:00 AM" or "14:00".`,
      });
      continue;
    }

    if (geocodeCalls > 0) {
      await sleep(NOMINATIM_DELAY_MS);
    }
    geocodeCalls += 1;
    const location = await geocodeOne(address);
    if (!location) {
      skipped.push({ row: rowNum, title, reason: `Couldn't locate "${address}" on the map -- double-check the address.` });
      continue;
    }

    const tags = tagsRaw
      ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    // Same "qualify with the resolved city" convention the seller-facing
    // Post form uses, so an imported neighborhood sale groups correctly
    // with any matching one already on the site (see components/ListingForm.js).
    let neighborhoodName = null;
    const isNeighborhoodSale = Boolean(neighborhoodRaw);
    if (isNeighborhoodSale) {
      neighborhoodName = neighborhoodRaw;
      if (location.city && !neighborhoodName.toLowerCase().endsWith(location.city.toLowerCase())) {
        neighborhoodName = `${neighborhoodName}, ${location.city}`;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('sales')
      .insert({
        title,
        address,
        lat: location.lat,
        lng: location.lng,
        sale_date: saleDate,
        end_date: endDate,
        start_time: startTime,
        end_time: endTime,
        tags,
        description: description || null,
        photo_urls: [],
        is_neighborhood_sale: isNeighborhoodSale,
        neighborhood_name: neighborhoodName,
        status: 'approved',
        user_id: null,
      })
      .select('id')
      .single();

    if (error) {
      skipped.push({ row: rowNum, title, reason: `Database error: ${error.message}` });
      continue;
    }

    imported.push({ row: rowNum, title, id: data.id });
  }

  return NextResponse.json({
    imported: imported.length,
    skipped,
    truncated,
    maxRows: MAX_ROWS,
  });
}
'@ | Set-Content -Encoding UTF8 "app\api\admin\sales\import\route.js"

Write-Host "Writing app\admin\page.js ..." -ForegroundColor Cyan
@'
'use client';

import { useEffect, useState } from 'react';
import styles from './admin.module.css';
import ListingForm from '@/components/ListingForm';
import AdForm from '@/components/AdForm';
import { formatDateRange } from '@/lib/format';

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

  useEffect(() => {
    loadSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authed) {
      loadAds();
      loadTags();
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
    });
  }

  function cancelEditAd() {
    setEditingAdId(null);
    setEditAdDraft(null);
  }

  async function saveEditAd(ad) {
    try {
      const updated = await updateAd(ad.id, editAdDraft);
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
            Each imported listing goes live immediately (same as "+ Add Listing").{' '}
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
    </div>
  );
}
'@ | Set-Content -Encoding UTF8 "app\admin\page.js"

Write-Host "Writing app\admin\admin.module.css ..." -ForegroundColor Cyan
@'
.loginWrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.loginCard {
  width: 100%;
  max-width: 360px;
  background: #fff;
  border: 1px solid #e2ddcf;
  border-radius: 14px;
  padding: 28px 26px;
  box-shadow: 0 10px 30px rgba(32, 28, 22, 0.08);
}

.loginCard h1 {
  margin: 0 0 6px;
  font-size: 20px;
  color: #201c16;
}

.wrap {
  max-width: 980px;
  margin: 0 auto;
  padding: 32px 20px 80px;
  font-family: 'DM Sans', system-ui, sans-serif;
  color: #201c16;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.header h1 {
  font-size: 22px;
  margin: 0;
}

.hint {
  font-size: 13px;
  color: #5a5346;
  margin: 0 0 16px;
}

.error {
  font-size: 12.5px;
  color: #d64545;
  margin: 10px 0 0;
}

.input,
.textarea {
  width: 100%;
  border: 1.5px solid #d8cdaa;
  border-radius: 8px;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 14px;
  color: #201c16;
  background: #fff;
  outline: none;
  margin-bottom: 10px;
  box-sizing: border-box;
}

.input:focus,
.textarea:focus {
  border-color: #e0a020;
}

.textarea {
  min-height: 70px;
  resize: vertical;
}

.button {
  background: #f4b93c;
  color: #201c16;
  border: none;
  padding: 10px 16px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 13.5px;
  cursor: pointer;
  font-family: inherit;
}

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.buttonSecondary {
  background: #eee7d3;
  color: #201c16;
  border: none;
  padding: 10px 16px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 13.5px;
  cursor: pointer;
  font-family: inherit;
}

.linkButton {
  background: none;
  border: none;
  color: #5a5346;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 8px;
  font-family: inherit;
  text-decoration: underline;
}

.linkButtonDanger {
  composes: linkButton;
  color: #d64545;
}

.banner {
  background: #e4f0e6;
  border: 1px solid #bcdac1;
  color: #2f5136;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 14px;
}

.bannerError {
  background: #fbe8e8;
  border: 1px solid #f0bcbc;
  color: #8a2a2a;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 14px;
}

.filters {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.filterBtn {
  background: #fff;
  border: 1.5px solid #d8cdaa;
  color: #5a5346;
  padding: 8px 14px;
  border-radius: 20px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}

.filterBtnActive {
  background: #201c16;
  border-color: #201c16;
  color: #f4b93c;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.row {
  background: #fff;
  border: 1px solid #e2ddcf;
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.rowMain {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
}

.rowTitle {
  font-weight: 700;
  font-size: 14.5px;
  margin: 0 0 3px;
}

.rowSub {
  font-size: 12.5px;
  color: #5a5346;
  margin: 0;
}

.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.badge {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 4px 8px;
  border-radius: 5px;
  white-space: nowrap;
  margin-top: 2px;
}

.badge_pending {
  background: #f6e5b8;
  color: #7a5b13;
}

.badge_approved {
  background: #d9ecdb;
  color: #2f5136;
}

.badge_rejected {
  background: #f6d6d6;
  color: #8a2a2a;
}

.editForm {
  width: 100%;
}

.editRow {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
}

.headerActions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.formCard {
  background: #fff;
  border: 1px solid #e2ddcf;
  border-radius: 14px;
  padding: 20px;
  margin-bottom: 20px;
  max-width: 480px;
}

.formHeading {
  font-size: 16px;
  margin: 0 0 14px;
}

.imagePicker {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 120px;
  border: 2px dashed #d8cdaa;
  border-radius: 10px;
  color: #5a5346;
  font-size: 13px;
  cursor: pointer;
  margin-bottom: 10px;
  overflow: hidden;
}

.imagePicker img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.listingFormWrap {
  position: relative;
  height: 640px;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid #e2ddcf;
  margin-bottom: 20px;
  background: var(--paper, #FAF6EC);
}

.sectionHeading {
  font-size: 18px;
  margin: 32px 0 14px;
}

.typeToggle {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.typeToggleBtn {
  flex: 1;
  background: #eee7d3;
  color: #5a5346;
  border: 1.5px solid #d8cdaa;
  padding: 9px 10px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 12.5px;
  cursor: pointer;
  font-family: inherit;
}

.typeToggleBtnActive {
  background: #201c16;
  border-color: #201c16;
  color: #f4b93c;
}

.codeTextarea {
  width: 100%;
  border: 1.5px solid #d8cdaa;
  border-radius: 8px;
  padding: 10px 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12.5px;
  color: #201c16;
  background: #fbf8ef;
  outline: none;
  margin-bottom: 10px;
  box-sizing: border-box;
  min-height: 130px;
  resize: vertical;
  white-space: pre;
}

.codeTextarea:focus {
  border-color: #e0a020;
}

.tagAddRow {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  max-width: 480px;
  margin-bottom: 16px;
}

.tagAddRow .input {
  margin-bottom: 0;
}

.tagList {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tagChip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #fff;
  border: 1.5px solid #d8cdaa;
  color: #201c16;
  padding: 6px 8px 6px 12px;
  border-radius: 20px;
  font-size: 12.5px;
  font-weight: 600;
}

.tagChipRemove {
  background: #eee7d3;
  border: none;
  color: #5a5346;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-family: inherit;
}

.tagChipRemove:hover {
  background: #f6d6d6;
  color: #8a2a2a;
}

.importPanel {
  max-width: 520px;
  background: #fff;
  border: 1px solid #e2ddcf;
  border-radius: 14px;
  padding: 18px;
  margin-bottom: 18px;
}

.importResult {
  margin-top: 4px;
}

.importSkipList {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.importSkipRow {
  font-size: 12.5px;
  color: #5a5346;
}
'@ | Set-Content -Encoding UTF8 "app\admin\admin.module.css"

Write-Host "Writing public\salehop-listing-import-template.xlsx ..." -ForegroundColor Cyan
$importTemplateBase64 = @'
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
CgCEAgAAyh0AAAAA
'@
$importTemplateBytes = [System.Convert]::FromBase64String(($importTemplateBase64 -replace "`r", "" -replace "`n", ""))
[System.IO.File]::WriteAllBytes("public\salehop-listing-import-template.xlsx", $importTemplateBytes)

Write-Host "Staging, committing, and pushing ..." -ForegroundColor Cyan
git add .
git commit -m "Add bulk listing import from an Excel spreadsheet"

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
    Write-Host "Done! Once Vercel finishes deploying, go to /admin and click '+ Import Spreadsheet' -- there's a 'Download the template' link right there to get started." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "The push didn't finish cleanly -- scroll up for git's error message and send it to me." -ForegroundColor Red
}
