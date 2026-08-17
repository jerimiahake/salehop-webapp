# SaleHop round 4: multi-day sales, multiselect date filtering, a "clear
# search" button, city-qualified neighborhood names, image + code-snippet
# ad types, and admin-managed listing tags.
#
# IMPORTANT: before running this, open
# supabase-schema-v4-multiday-tags-adtypes.sql (delivered alongside this
# script) in the Supabase SQL Editor and click "Run". This script only
# changes app code -- the database needs that SQL change first, or the
# app will error trying to read columns/tables that don't exist yet.
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

Write-Host "Copying supabase-schema-v4-multiday-tags-adtypes.sql into the repo (for reference/history) ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "supabase" | Out-Null
if (Test-Path ".\supabase-schema-v4-multiday-tags-adtypes.sql") {
    Copy-Item ".\supabase-schema-v4-multiday-tags-adtypes.sql" "supabase\schema-v4-multiday-tags-adtypes.sql" -Force
} else {
    Write-Host "  (supabase-schema-v4-multiday-tags-adtypes.sql not found next to this script -- skipping, not required for the app to work)" -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path "lib" | Out-Null
New-Item -ItemType Directory -Force -Path "components" | Out-Null
New-Item -ItemType Directory -Force -Path "app\api\geocode" | Out-Null
New-Item -ItemType Directory -Force -Path "app\api\address-suggest" | Out-Null
New-Item -ItemType Directory -Force -Path "app\api\admin\tags" | Out-Null
New-Item -ItemType Directory -Force -Path "app\api\admin\ads" | Out-Null
New-Item -ItemType Directory -Force -Path "app\api\admin\sales" | Out-Null
New-Item -ItemType Directory -Force -Path "app\admin" | Out-Null

Write-Host "Writing lib\nominatimAddress.js ..." -ForegroundColor Cyan
@'
// Shared by /api/geocode and /api/address-suggest. Nominatim's
// addressdetails=1 option returns a structured breakdown of a match
// instead of just one flat display string -- this picks the most sensible
// "city" label out of that breakdown for a US town/city.
//
// Small towns (like Lapel, IN) are usually classified as "town" rather
// than "city" in OpenStreetMap's data, so the fallback chain matters --
// city-only would miss most small towns entirely.
export function extractCity(addressDetails) {
  if (!addressDetails) return null;
  return (
    addressDetails.city ||
    addressDetails.town ||
    addressDetails.village ||
    addressDetails.hamlet ||
    addressDetails.county ||
    null
  );
}
'@ | Set-Content -Encoding UTF8 "lib\nominatimAddress.js"

Write-Host "Writing lib\format.js ..." -ForegroundColor Cyan
@'
// Formatting + date helpers shared by the Browse/Map/Post screens.

// Postgres returns `time` columns as "HH:MM:SS" strings. Format for display.
export function formatTime(hhmmss) {
  if (!hhmmss) return '';
  const [hStr, mStr] = hhmmss.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${suffix}`;
}

export function formatTimeRange(start, end) {
  return `${formatTime(start)}–${formatTime(end)}`;
}

const DOW = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

// Returns the YYYY-MM-DD date string for the next occurrence of the given
// weekday (Fri/Sat/Sun), counting today as a valid match.
export function upcomingDateFor(dayAbbrev, from = new Date()) {
  const target = DOW[dayAbbrev];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const diff = (target - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return toDateKey(d);
}

const WEEKDAY_LABEL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// Returns the next `count` days (including today) as
// [{ date: 'YYYY-MM-DD', label: 'TODAY' | 'TOMORROW' | 'FRI' | ... }, ...].
// Used for both the Browse filter pills and the Post screen's date picker,
// so any day of the week -- not just Fri/Sat/Sun -- has a matching pill.
export function nextNDays(count = 7, from = new Date()) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const label = i === 0 ? 'TODAY' : i === 1 ? 'TMRW' : WEEKDAY_LABEL[d.getDay()];
    days.push({ date: toDateKey(d), label });
  }
  return days;
}

export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// True if `dateKey` (YYYY-MM-DD) falls within [startDate, endDate]
// inclusive. `endDate` may be null/undefined -- that just means a
// single-day sale, so it's treated as the same day as `startDate`.
export function dateInRange(dateKey, startDate, endDate) {
  const end = endDate || startDate;
  return dateKey >= startDate && dateKey <= end;
}

function formatShortDate(dateKey) {
  if (!dateKey) return '';
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// "Aug 17" for a single-day sale, "Aug 17 – Aug 19" for a multi-day one.
// `endDate` may be null/undefined/equal to `startDate` -- all read as
// single-day.
export function formatDateRange(startDate, endDate) {
  if (!endDate || endDate === startDate) return formatShortDate(startDate);
  return `${formatShortDate(startDate)} – ${formatShortDate(endDate)}`;
}

export function distanceMiles(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return null;
  const R = 3958.8; // miles
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}
'@ | Set-Content -Encoding UTF8 "lib\format.js"

Write-Host "Writing app\api\geocode\route.js ..." -ForegroundColor Cyan
@'
import { NextResponse } from 'next/server';
import { extractCity } from '@/lib/nominatimAddress';

// Server-side proxy to OpenStreetMap's free Nominatim geocoder. Runs on the
// server so we can set a proper identifying User-Agent, as Nominatim's usage
// policy requires (https://operations.osmfoundation.org/policies/nominatim/).
// Free, no API key -- matches the free Leaflet/OpenStreetMap map in the app.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');

  if (!address || !address.trim()) {
    return NextResponse.json({ error: 'Missing "address" query param' }, { status: 400 });
  }

  const nominatimUrl = new URL('https://nominatim.openstreetmap.org/search');
  nominatimUrl.searchParams.set('format', 'json');
  nominatimUrl.searchParams.set('q', address);
  nominatimUrl.searchParams.set('limit', '1');
  nominatimUrl.searchParams.set('addressdetails', '1');

  const res = await fetch(nominatimUrl.toString(), {
    headers: {
      // Replace with your own domain/contact once deployed, per Nominatim's usage policy.
      'User-Agent': 'SaleHop/1.0 (garage sale finder; contact via site owner)',
      'Accept-Language': 'en',
    },
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Nominatim request failed (${res.status})` }, { status: 502 });
  }

  const results = await res.json();
  if (!results || results.length === 0) {
    return NextResponse.json(null);
  }

  return NextResponse.json({
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
    displayName: results[0].display_name,
    city: extractCity(results[0].address),
  });
}
'@ | Set-Content -Encoding UTF8 "app\api\geocode\route.js"

Write-Host "Writing app\api\address-suggest\route.js ..." -ForegroundColor Cyan
@'
import { NextResponse } from 'next/server';
import { extractCity } from '@/lib/nominatimAddress';

// Server-side proxy to OpenStreetMap's free Nominatim geocoder, used for
// as-you-type address suggestions on the Post screen. Same host as
// /api/geocode (already proven working in production), just asking for a
// short list of candidate matches instead of a single best match.
//
// Nominatim's usage policy asks apps not to fire a request on every
// keystroke (https://operations.osmfoundation.org/policies/nominatim/), so
// the actual debouncing/min-length gating happens client-side in
// lib/geocode.js -- this route just answers whatever query it's given.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query || !query.trim()) {
    return NextResponse.json([]);
  }

  const nominatimUrl = new URL('https://nominatim.openstreetmap.org/search');
  nominatimUrl.searchParams.set('format', 'json');
  nominatimUrl.searchParams.set('q', query);
  nominatimUrl.searchParams.set('limit', '5');
  nominatimUrl.searchParams.set('addressdetails', '1');

  const res = await fetch(nominatimUrl.toString(), {
    headers: {
      // Replace with your own domain/contact once deployed, per Nominatim's usage policy.
      'User-Agent': 'SaleHop/1.0 (garage sale finder; contact via site owner)',
      'Accept-Language': 'en',
    },
  });

  if (!res.ok) {
    // Suggestions are a nice-to-have -- fail soft so a hiccup here never
    // blocks someone from typing/submitting their address by hand.
    return NextResponse.json([]);
  }

  const results = await res.json();
  const suggestions = (results || []).map((r) => ({
    label: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    city: extractCity(r.address),
  }));

  return NextResponse.json(suggestions);
}
'@ | Set-Content -Encoding UTF8 "app\api\address-suggest\route.js"

Write-Host "Writing app\api\admin\tags\route.js ..." -ForegroundColor Cyan
@'
import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Lists every tag -- public visitors read these directly via the anon
// client (RLS allows public select), same as ads. This admin route exists
// so the /admin Tags section has a consistent, auth-gated way to see and
// manage the same list.
export async function GET(request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin.from('tags').select('*').order('name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

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

  const name = (body?.name || '').trim();
  if (!name) {
    return NextResponse.json({ error: 'Tag name is required.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.from('tags').insert({ name }).select().single();

  if (error) {
    // Postgres unique_violation -- friendlier message than the raw error.
    if (error.code === '23505') {
      return NextResponse.json({ error: `"${name}" already exists.` }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
'@ | Set-Content -Encoding UTF8 "app\api\admin\tags\route.js"

Write-Host "Writing app\api\admin\ads\route.js ..." -ForegroundColor Cyan
@'
import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Lists every ad (active and inactive) for the /admin dashboard. Public
// visitors only ever see active ones (enforced by RLS on the "ads" table),
// but the admin panel needs to see and manage everything.
export async function GET(request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from('ads')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

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

  const adType = body?.ad_type === 'snippet' ? 'snippet' : 'image';

  if (!body?.title) {
    return NextResponse.json({ error: 'An ad needs a title.' }, { status: 400 });
  }
  if (adType === 'image' && !body?.link_url) {
    return NextResponse.json({ error: 'An image ad needs a link.' }, { status: 400 });
  }
  if (adType === 'snippet' && !body?.html_snippet) {
    return NextResponse.json({ error: 'A code-snippet ad needs the embed code.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('ads')
    .insert({
      ad_type: adType,
      title: body.title,
      description: body.description || null,
      image_url: adType === 'image' ? body.image_url || null : null,
      link_url: adType === 'image' ? body.link_url : null,
      sponsor_name: adType === 'image' ? body.sponsor_name || null : null,
      html_snippet: adType === 'snippet' ? body.html_snippet : null,
      active: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
'@ | Set-Content -Encoding UTF8 "app\api\admin\ads\route.js"

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
      end_date: body.end_date || null,
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

Write-Host "Creating app\api\admin\tags\[id] ..." -ForegroundColor Cyan
$tagsIdDir = Join-Path $projectPath "app\api\admin\tags\[id]"
[System.IO.Directory]::CreateDirectory($tagsIdDir) | Out-Null

Write-Host "Writing app\api\admin\tags\[id]\route.js ..." -ForegroundColor Cyan
$tagsIdFile = Join-Path $projectPath "app\api\admin\tags\[id]\route.js"
$tagsIdContent = @'
import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Tags are add/remove only from the admin panel -- no rename, since a tag
// that's already in use on existing listings would silently change what
// those listings show. Deleting one just removes it from the picker for
// NEW/edited listings; existing sales keep whatever tags they already had
// (tags are stored per-sale as a plain text array, not a foreign key).
export async function DELETE(request, { params }) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { error } = await supabaseAdmin.from('tags').delete().eq('id', params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
'@
[System.IO.File]::WriteAllText($tagsIdFile, $tagsIdContent, [System.Text.Encoding]::UTF8)
if (-not (Test-Path -LiteralPath $tagsIdFile)) {
    Write-Host "ERROR: app\api\admin\tags\[id]\route.js still doesn't exist after writing it. Send me a screenshot of this output." -ForegroundColor Red
    exit 1
}

Write-Host "Creating app\api\admin\ads\[id] ..." -ForegroundColor Cyan
$adsIdDir = Join-Path $projectPath "app\api\admin\ads\[id]"
[System.IO.Directory]::CreateDirectory($adsIdDir) | Out-Null

Write-Host "Writing app\api\admin\ads\[id]\route.js ..." -ForegroundColor Cyan
$adsIdFile = Join-Path $projectPath "app\api\admin\ads\[id]\route.js"
$adsIdContent = @'
import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

const EDITABLE_FIELDS = [
  'title',
  'description',
  'image_url',
  'link_url',
  'sponsor_name',
  'active',
  'html_snippet',
];

export async function PATCH(request, { params }) {
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

  const updates = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('ads')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(request, { params }) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  // Look up the image first so we can also clean it up from storage --
  // deleting the row doesn't automatically delete its uploaded file.
  const { data: existing } = await supabaseAdmin.from('ads').select('image_url').eq('id', params.id).single();

  const { error } = await supabaseAdmin.from('ads').delete().eq('id', params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (existing?.image_url) {
    const path = existing.image_url.split('/sale-photos/')[1];
    if (path) {
      supabaseAdmin.storage.from('sale-photos').remove([path]).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
'@
[System.IO.File]::WriteAllText($adsIdFile, $adsIdContent, [System.Text.Encoding]::UTF8)
if (-not (Test-Path -LiteralPath $adsIdFile)) {
    Write-Host "ERROR: app\api\admin\ads\[id]\route.js still doesn't exist after writing it. Send me a screenshot of this output." -ForegroundColor Red
    exit 1
}

Write-Host "Creating app\api\admin\sales\[id] ..." -ForegroundColor Cyan
$salesIdDir = Join-Path $projectPath "app\api\admin\sales\[id]"
[System.IO.Directory]::CreateDirectory($salesIdDir) | Out-Null

Write-Host "Writing app\api\admin\sales\[id]\route.js ..." -ForegroundColor Cyan
$salesIdFile = Join-Path $projectPath "app\api\admin\sales\[id]\route.js"
$salesIdContent = @'
import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Whatever the client sends, only these columns are ever written -- this
// keeps a request from writing to something like user_id even if it tried.
const EDITABLE_FIELDS = [
  'title',
  'address',
  'lat',
  'lng',
  'sale_date',
  'end_date',
  'start_time',
  'end_time',
  'tags',
  'description',
  'photo_urls',
  'status',
];

export async function PATCH(request, { params }) {
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

  const updates = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }
  if ('status' in updates && !['pending', 'approved', 'rejected'].includes(updates.status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('sales')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(request, { params }) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  // Look up photo URLs first so we can also clean those up from storage --
  // deleting the row doesn't automatically delete its uploaded files.
  const { data: existing } = await supabaseAdmin
    .from('sales')
    .select('photo_urls')
    .eq('id', params.id)
    .single();

  const { error } = await supabaseAdmin.from('sales').delete().eq('id', params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (existing?.photo_urls?.length > 0) {
    const paths = existing.photo_urls.map((url) => url.split('/sale-photos/')[1]).filter(Boolean);
    if (paths.length > 0) {
      supabaseAdmin.storage.from('sale-photos').remove(paths).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
'@
[System.IO.File]::WriteAllText($salesIdFile, $salesIdContent, [System.Text.Encoding]::UTF8)
if (-not (Test-Path -LiteralPath $salesIdFile)) {
    Write-Host "ERROR: app\api\admin\sales\[id]\route.js still doesn't exist after writing it. Send me a screenshot of this output." -ForegroundColor Red
    exit 1
}

Write-Host "Writing components\HtmlSnippet.js ..." -ForegroundColor Cyan
@'
'use client';

import { useEffect, useRef } from 'react';

// Renders an arbitrary HTML/JS snippet -- e.g. a Google AdSense/Ad Manager
// embed tag pasted into the admin panel. React's dangerouslySetInnerHTML
// would insert the markup, but browsers never execute <script> tags that
// arrive that way. This works around that (the standard technique): after
// the snippet is in the DOM, it finds any <script> tags inside and
// re-creates each one as a fresh <script> element, which DOES execute.
//
// Security note: this snippet is only ever set from /admin, which is
// password-gated -- there's no path for a site visitor's input to end up
// here. Treat it the same as you'd treat pasting a WordPress "Custom HTML"
// widget: only paste snippets from sources you trust (Google, etc.),
// since whatever runs here runs with full access to the page.
export default function HtmlSnippet({ html }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !html) return;

    container.innerHTML = html;

    const scripts = Array.from(container.querySelectorAll('script'));
    scripts.forEach((oldScript) => {
      const newScript = document.createElement('script');
      Array.from(oldScript.attributes).forEach((attr) => {
        newScript.setAttribute(attr.name, attr.value);
      });
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  }, [html]);

  return <div ref={containerRef} className="ad-snippet" />;
}
'@ | Set-Content -Encoding UTF8 "components\HtmlSnippet.js"

Write-Host "Writing components\AdCard.js ..." -ForegroundColor Cyan
@'
'use client';

import HtmlSnippet from './HtmlSnippet';

// Styled to echo SaleCard's layout (so it fits naturally in the scrolling
// list) but visually distinct: a highlighted gold background/border and an
// "AD" badge, no address (it's not a real sale). Two flavors:
//   "image"   -- a title/sponsor/image card; tapping it opens the
//                sponsor's link in a new tab, same as before.
//   "snippet" -- a raw HTML/JS embed (e.g. a Google Ads tag) rendered
//                as-is; it manages its own click-through, so the card
//                itself isn't clickable.
export default function AdCard({ ad }) {
  if (ad.ad_type === 'snippet') {
    return (
      <div className="card ad-card ad-card-snippet">
        <span className="ad-badge ad-badge-snippet">AD</span>
        <HtmlSnippet html={ad.html_snippet} />
      </div>
    );
  }

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

Write-Host "Writing components\AdForm.js ..." -ForegroundColor Cyan
@'
'use client';

import { useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';

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
export default function AdForm({ styles, onCreated, onCancel }) {
  const [adType, setAdType] = useState('image');
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

    let normalizedLink = null;
    if (adType === 'image') {
      normalizedLink = linkUrl.trim();
      if (!/^https?:\/\//i.test(normalizedLink)) {
        normalizedLink = `https://${normalizedLink}`;
      }
    }

    setSubmitting(true);
    try {
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
'@ | Set-Content -Encoding UTF8 "components\AdForm.js"

Write-Host "Writing components\ListingForm.js ..." -ForegroundColor Cyan
@'
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
'@ | Set-Content -Encoding UTF8 "components\ListingForm.js"

Write-Host "Writing components\AppShell.js ..." -ForegroundColor Cyan
@'
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { sampleSales, MAP_CENTER } from '@/lib/sampleData';
import { nextNDays, distanceMiles, toDateKey, dateInRange } from '@/lib/format';
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
  // Multi-select: most sales run 2-3 days, so Browse lets you pick several
  // days at once and see anything running on any of them. Always at least
  // one day selected -- toggleDate below guards against clearing the last one.
  const [selectedDates, setSelectedDates] = useState(() => [toDateKey(new Date())]);
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

  // Toggle a day pill on/off, but never down to zero selected days --
  // Browse always needs at least one day to filter against.
  const toggleDate = useCallback((date) => {
    setSelectedDates((prev) => {
      if (prev.includes(date)) {
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== date);
      }
      return [...prev, date];
    });
  }, []);

  const filteredSales = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sales
      .filter((s) => selectedDates.some((d) => dateInRange(d, s.sale_date, s.end_date)))
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
  }, [sales, selectedDates, searchQuery, referenceLocation]);

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
            selectedDates={selectedDates}
            onToggleDate={toggleDate}
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
  selectedDates,
  onToggleDate,
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
          {searchQuery && (
            <button
              type="button"
              className="search-clear"
              onClick={() => onSearch('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        <div className="day-pills">
          {dayOptions.map((opt) => (
            <div
              key={opt.date}
              className={`pill ${selectedDates.includes(opt.date) ? 'active' : ''}`}
              onClick={() => onToggleDate(opt.date)}
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

Write-Host "Writing components\SaleCard.js ..." -ForegroundColor Cyan
@'
'use client';

import { formatTimeRange, formatDateRange } from '@/lib/format';

export default function SaleCard({ sale, favorited, routeNum, onClick, onToggleFavorite, onFilterNeighborhood }) {
  const time = sale.time || (sale.start_time ? formatTimeRange(sale.start_time, sale.end_time) : '');
  const cover = sale.photo_urls && sale.photo_urls.length > 0 ? sale.photo_urls[0] : null;
  // Only shown once a sale actually has a real sale_date to range from --
  // sample/demo sales that only set `time` (no sale_date) skip it.
  const dateRange = sale.sale_date ? formatDateRange(sale.sale_date, sale.end_date) : null;

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
          {dateRange && <span className="time-badge mono">{dateRange}</span>}
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

Write-Host "Writing components\MapScreen.js ..." -ForegroundColor Cyan
@'
'use client';

import dynamic from 'next/dynamic';
import { formatTimeRange, formatDateRange } from '@/lib/format';

const LeafletMap = dynamic(() => import('./LeafletMap'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ink-soft)' }}>
      Loading map…
    </div>
  ),
});

export default function MapScreen({
  sales,
  favorites,
  selectedSaleId,
  onSelectSale,
  onToggleFavorite,
  favoritedSales,
  onOpenSaved,
  center,
  active = true,
}) {
  const selectedSale = sales.find((s) => s.id === selectedSaleId);

  return (
    <div className="map-wrap">
      <LeafletMap
        sales={sales}
        favorites={favorites}
        selectedSaleId={selectedSaleId}
        onSelectSale={onSelectSale}
        center={center}
        active={active}
      />

      <div className="map-floating-row">
        <div className="map-chip">📍 {sales.length} nearby</div>
      </div>

      {selectedSale && (
        <div className={`map-peek ${favorites.includes(selectedSale.id) ? 'favorited' : ''}`}>
          <div className="thumb" style={{ background: favorites.includes(selectedSale.id) ? '#e4f0e6' : '#faf1d8' }}>
            {selectedSale.icon || '🏷️'}
          </div>
          <div className="card-body">
            <p className="card-title">{selectedSale.title}</p>
            <p className="card-addr">{selectedSale.address}</p>
            <div className="card-meta">
              {selectedSale.sale_date && (
                <span className="time-badge mono">
                  {formatDateRange(selectedSale.sale_date, selectedSale.end_date)}
                </span>
              )}
              <span className="time-badge mono">
                {selectedSale.time || formatTimeRange(selectedSale.start_time, selectedSale.end_time)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className={`fav-btn ${favorites.includes(selectedSale.id) ? 'on' : ''}`}
            onClick={() => onToggleFavorite(selectedSale.id)}
          >
            ★
          </button>
        </div>
      )}

      {!selectedSale && favoritedSales.length > 0 && (
        <button type="button" className="route-pill" onClick={onOpenSaved}>
          <div className="dot" />
          <span>
            {favoritedSales.length} stop{favoritedSales.length > 1 ? 's' : ''} on your route
          </span>
          <span className="go">Open ▸</span>
        </button>
      )}
    </div>
  );
}
'@ | Set-Content -Encoding UTF8 "components\MapScreen.js"

Write-Host "Writing components\AccountScreen.js ..." -ForegroundColor Cyan
@'
'use client';

import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { formatTimeRange, formatDateRange } from '@/lib/format';
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
                {formatDateRange(sale.sale_date, sale.end_date)} · {formatTimeRange(sale.start_time, sale.end_time)}
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

Write-Host "Creating app\listing\[id] ..." -ForegroundColor Cyan
$listingPageDir = Join-Path $projectPath "app\listing\[id]"
[System.IO.Directory]::CreateDirectory($listingPageDir) | Out-Null

Write-Host "Writing app\listing\[id]\page.js ..." -ForegroundColor Cyan
$listingPageFile = Join-Path $projectPath "app\listing\[id]\page.js"
$listingPageContent = @'
import { getSaleForShare } from '@/lib/getSaleForShare';
import { formatTimeRange, formatDateRange } from '@/lib/format';
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

  const summary = `${formatDateRange(sale.sale_date, sale.end_date)} · ${formatTimeRange(sale.start_time, sale.end_time)} · ${sale.address}`;
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
              {formatDateRange(sale.sale_date, sale.end_date)} · {formatTimeRange(sale.start_time, sale.end_time)}
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
'@ | Set-Content -Encoding UTF8 "app\admin\admin.module.css"

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
.search-clear {
  flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
  border: none; background: rgba(32,28,22,0.12); color: var(--ink-soft);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; cursor: pointer; padding: 0; font-family: inherit;
}
.search-clear:hover { background: rgba(32,28,22,0.2); color: var(--ink); }
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

/* A code-snippet ad (e.g. a Google Ad Manager/AdSense tag) -- no thumb/link
   layout since the network's own embed renders whatever it wants. Still
   framed like the other cards so it doesn't look broken in the feed. */
.card.ad-card-snippet { display: block; cursor: default; }
.ad-badge-snippet { display: inline-block; margin-bottom: 8px; }
.ad-snippet { min-height: 40px; overflow: hidden; }

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

Write-Host "Staging, committing, and pushing ..." -ForegroundColor Cyan
git add .
git commit -m "Multi-day sales, multiselect date filter, city-qualified neighborhoods, ad snippets, admin tags"

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
    Write-Host "Done! Once Vercel finishes deploying: try selecting multiple day pills in Browse, clear a neighborhood search with the new X button, post a multi-day sale, and check the new Listing Tags section at the bottom of /admin." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "The push didn't finish cleanly -- scroll up for git's error message and send it to me." -ForegroundColor Red
}
