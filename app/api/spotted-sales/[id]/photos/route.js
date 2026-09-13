import { NextResponse } from 'next/server';
import crypto from 'crypto';
import exifr from 'exifr';
import piexif from 'piexifjs';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';
import { distanceMiles } from '@/lib/format';
import { recordActivityAndCheckBadges } from '@/lib/badgeEngine';

// Lets ANYONE who can prove they're actually near a spotted sale add a
// photo and/or a short note to it, immediately (no admin approval) -- see
// components/SpottedSaleSheet.js for the form that posts here. This is
// deliberately open to anyone at any time (not just whoever first
// confirmed the spot), per how the feature was scoped.
//
// "Proving you're there" means one of two things:
//   1. The uploaded photo's own EXIF GPS data (where the photo was
//      actually taken) is close enough to the spot -- exifr reads this.
//   2. The browser's live location (sent alongside the photo/note) is
//      close enough -- same radius check as the "visit confirm" endpoint.
// If neither is available or neither is close enough, the whole request
// is rejected -- there's no "unverified" fallback that stores it anyway.
//
// Before a verified photo is ever stored publicly, its EXIF data
// (including that same GPS location) is stripped out with piexifjs -- so
// nobody looking at a photo on SaleHop can see exactly where it was
// taken. If stripping fails for any reason, the upload is rejected rather
// than risk storing a photo that still leaks location data.
//
// A still-unconfirmed spot that gets a verified contribution is confirmed
// right then (status -> 'confirmed', confirmation_method -> 'visit'),
// using whichever verified location was actually available -- the same
// "physically proven" bar as the dedicated /confirm endpoint, just
// reached a different way.

const MAX_PHOTOS = 12;
const MAX_NOTES = 10;
const MAX_NOTE_LENGTH = 300;
const JPEG_MAGIC = [0xff, 0xd8];

function isJpeg(buffer) {
  return buffer.length > 2 && buffer[0] === JPEG_MAGIC[0] && buffer[1] === JPEG_MAGIC[1];
}

function publicShape(row) {
  return {
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    status: row.status,
    confirmation_method: row.confirmation_method,
    photo_urls: row.photo_urls || [],
    notes: row.notes || [],
    first_reported_at: row.first_reported_at,
    last_reported_at: row.last_reported_at,
    confirmed_at: row.confirmed_at,
  };
}

export async function POST(request, { params }) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Not available right now.' }, { status: 500 });
  }

  const { data: spot, error: loadError } = await supabaseAdmin
    .from('spotted_sales')
    .select('*')
    .eq('id', params.id)
    .single();

  if (loadError || !spot) {
    return NextResponse.json({ error: 'That reported sale could not be found.' }, { status: 404 });
  }
  if (spot.status === 'rejected') {
    return NextResponse.json({ error: 'This report was removed and can no longer be added to.' }, { status: 400 });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const file = form.get('file');
  const deviceIdRaw = form.get('deviceId');
  const deviceId = typeof deviceIdRaw === 'string' ? deviceIdRaw.slice(0, 100) : null;
  const noteRaw = form.get('note');
  const note = typeof noteRaw === 'string' ? noteRaw.trim().slice(0, MAX_NOTE_LENGTH) : '';
  const liveLat = Number(form.get('lat'));
  const liveLng = Number(form.get('lng'));
  const hasLiveLocation = Number.isFinite(liveLat) && Number.isFinite(liveLng);
  const hasFile = file && typeof file.arrayBuffer === 'function' && file.size > 0;

  if (!hasFile && !note) {
    return NextResponse.json({ error: 'Add a photo or a note first.' }, { status: 400 });
  }

  // Radius check re-uses the settings-driven radius the same way the
  // /confirm endpoint does -- doubled from the report-clustering radius
  // to stay forgiving of ordinary GPS drift.
  const { data: settingsRow } = await supabaseAdmin
    .from('app_settings')
    .select('spotted_sale_radius_ft')
    .eq('id', 1)
    .single();
  const radiusFt = Number.isFinite(settingsRow?.spotted_sale_radius_ft) ? settingsRow.spotted_sale_radius_ft : 300;
  const verifyRadiusFt = radiusFt * 2;

  function withinRange(point) {
    const distanceFt = (distanceMiles(point, { lat: spot.lat, lng: spot.lng }) ?? Infinity) * 5280;
    return distanceFt <= verifyRadiusFt;
  }

  let verifiedLocation = null;
  let strippedBuffer = null;

  if (hasFile) {
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    if (!isJpeg(rawBuffer)) {
      return NextResponse.json({ error: 'Only JPEG photos are supported right now -- try again from your camera roll.' }, { status: 400 });
    }

    // Prefer the photo's own GPS data if present and close enough --
    // that's the strongest evidence someone was actually standing there
    // when they took it, not just wherever their phone happens to be now.
    try {
      const gps = await exifr.gps(rawBuffer);
      if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
        const point = { lat: gps.latitude, lng: gps.longitude };
        if (withinRange(point)) verifiedLocation = point;
      }
    } catch {
      // Unreadable/missing EXIF -- fall through to the live-location check.
    }

    if (!verifiedLocation && hasLiveLocation) {
      const point = { lat: liveLat, lng: liveLng };
      if (withinRange(point)) verifiedLocation = point;
    }

    if (!verifiedLocation) {
      return NextResponse.json(
        { error: "We couldn't verify you're actually near this sale. Make sure location access is on, or try again once you're closer." },
        { status: 400 }
      );
    }

    // Strip ALL EXIF (including that same GPS data) before this photo is
    // ever stored publicly -- never store an unstripped original, even if
    // stripping fails for some reason.
    try {
      const stripped = piexif.remove(rawBuffer.toString('binary'));
      strippedBuffer = Buffer.from(stripped, 'binary');
    } catch {
      return NextResponse.json({ error: "Couldn't process that photo safely -- please try a different one." }, { status: 400 });
    }
  } else {
    // Note-only contribution -- still needs proof of presence, but there's
    // no photo to pull GPS from, so only the live-location check applies.
    if (!hasLiveLocation || !withinRange({ lat: liveLat, lng: liveLng })) {
      return NextResponse.json(
        { error: "We couldn't verify you're actually near this sale. Turn on location access and try again." },
        { status: 400 }
      );
    }
    verifiedLocation = { lat: liveLat, lng: liveLng };
  }

  const updates = {};

  if (strippedBuffer) {
    const path = `${spot.id}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from('spotted-sale-photos')
      .upload(path, strippedBuffer, { contentType: 'image/jpeg' });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
    const { data: publicUrlData } = supabaseAdmin.storage.from('spotted-sale-photos').getPublicUrl(path);
    const nextPhotoUrls = [...(spot.photo_urls || []), publicUrlData.publicUrl].slice(-MAX_PHOTOS);
    updates.photo_urls = nextPhotoUrls;
  }

  if (note) {
    const nextNotes = [...(spot.notes || []), { text: note, created_at: new Date().toISOString() }].slice(-MAX_NOTES);
    updates.notes = nextNotes;
  }

  // Someone just proved they're physically at this spot -- that's the
  // same bar the dedicated /confirm endpoint uses, so an unconfirmed spot
  // gets confirmed right here too, using the same verified location.
  if (spot.status === 'unconfirmed') {
    updates.status = 'confirmed';
    updates.confirmation_method = 'visit';
    updates.confirmed_at = new Date().toISOString();
    updates.lat = verifiedLocation.lat;
    updates.lng = verifiedLocation.lng;
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('spotted_sales')
    .update(updates)
    .eq('id', spot.id)
    .select('id, lat, lng, status, confirmation_method, photo_urls, notes, first_reported_at, last_reported_at, confirmed_at')
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Not blocking, and not required -- older clients (or a request with
  // local storage blocked) just won't earn Shutterbug credit for this one.
  let newBadges = [];
  if (deviceId) {
    const result = await recordActivityAndCheckBadges({
      deviceId,
      activityType: 'photo_contributed',
      refId: `${spot.id}:${Date.now()}`,
    });
    newBadges = result.newBadges;
  }

  return NextResponse.json({ ...publicShape(updated), newBadges });
}
