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
