# When an address can't be located exactly, this now retries once more
# without the house number (e.g. "28655 Leonard Rd, Atlanta, IN 46031" ->
# "Leonard Rd, Atlanta, IN 46031") -- a close approximation on the right
# street, instead of just skipping the row. This recovers a lot of rural
# and newer addresses that OpenStreetMap doesn't have an exact point for
# but does have the road itself. Rows that used this approximation are
# called out in the results so they're easy to double-check. Also lowers
# the per-import row cap from 150 to 100, since a row can now cost up to
# two map lookups instead of one -- keeps the worst case comfortably
# inside Vercel's time limit. Also re-delivers the template spreadsheet
# with its "100 rows" note updated to match.
#
# No database changes needed for this one.
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

New-Item -ItemType Directory -Force -Path "app\api\admin\sales\import" | Out-Null
New-Item -ItemType Directory -Force -Path "app\admin" | Out-Null
New-Item -ItemType Directory -Force -Path "public" | Out-Null

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
// file just takes proportionally longer, it doesn't fail. A row whose exact
// address can't be found gets a second, slower attempt without the house
// number (see stripHouseNumber below), so a row can cost up to two
// Nominatim calls worst-case.
//
// Vercel's default function duration (with fluid compute, which is on by
// default) is 5 minutes even on the free Hobby plan. MAX_ROWS is sized so
// that even the worst case -- every single row needing the two-call
// fallback -- finishes comfortably inside that budget, and also caps how
// long an accidentally-huge file can run before failing fast and clearly.
export const maxDuration = 280;

const MAX_ROWS = 100;
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

// A rural or newer address is often missing from OpenStreetMap's data as an
// exact point even when the road itself is mapped -- dropping the house
// number and re-searching ("Leonard Rd, Atlanta, IN 46031" instead of
// "28655 Leonard Rd, ...") recovers a lot of these. The result lands
// somewhere along the right street rather than the exact lot, so callers
// should treat it as an approximation, not remove the need for one entirely.
function stripHouseNumber(address) {
  return address.replace(/^\s*\d+[a-zA-Z]?(-\d+[a-zA-Z]?)?\s+/, '').trim();
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
    let location = await geocodeOne(address);
    let approximate = false;

    // Exact address not found -- try again without the house number. This
    // often finds the right street (a close approximation) even when the
    // exact lot isn't in OpenStreetMap's data, which is common for rural
    // roads and newer construction.
    if (!location) {
      const fallbackQuery = stripHouseNumber(address);
      if (fallbackQuery && fallbackQuery !== address) {
        await sleep(NOMINATIM_DELAY_MS);
        geocodeCalls += 1;
        location = await geocodeOne(fallbackQuery);
        if (location) approximate = true;
      }
    }

    if (!location) {
      skipped.push({
        row: rowNum,
        title,
        reason: `Couldn't locate "${address}" on the map, even without the house number -- double-check the street name and spelling.`,
      });
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

    imported.push({ row: rowNum, title, id: data.id, approximate });
  }

  return NextResponse.json({
    imported: imported.length,
    approximate: imported.filter((r) => r.approximate),
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

Write-Host "Writing public\salehop-listing-import-template.xlsx ..." -ForegroundColor Cyan
$importTemplateBase64 = @'
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
AAoAhAIAAMsdAAAAAA==
'@
$importTemplateBytes = [System.Convert]::FromBase64String(($importTemplateBase64 -replace "`r", "" -replace "`n", ""))
[System.IO.File]::WriteAllBytes("public\salehop-listing-import-template.xlsx", $importTemplateBytes)

Write-Host "Staging, committing, and pushing ..." -ForegroundColor Cyan
git add .
git commit -m "Fall back to a nearby approximate location when an exact address can't be found"

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
    Write-Host "Done! Once Vercel finishes deploying, re-upload just the two rows that were skipped before (Leonard Rd and W Twilight Dr) -- they should go through now, flagged as approximate locations." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "The push didn't finish cleanly -- scroll up for git's error message and send it to me." -ForegroundColor Red
}
