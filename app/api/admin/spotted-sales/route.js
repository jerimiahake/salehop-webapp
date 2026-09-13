import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Lists every spotted-sale report (any status) for /admin. Only the
// aggregate report count is exposed here, never the raw
// reporter_device_ids array -- that stays confidential even from the
// admin UI, since it exists only to stop one device from inflating the
// crowd-confirm count, not to identify anyone.
export async function GET(request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from('spotted_sales')
    .select('*')
    .order('last_reported_at', { ascending: false });

  if (error) {
    // Table not there yet (schema-v10 migration not run) -- let the admin
    // page show an empty, non-broken Spotted Sales section rather than an
    // error banner for something that's just "not migrated yet."
    return NextResponse.json([]);
  }

  const rows = (data || []).map((row) => ({
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    status: row.status,
    confirmation_method: row.confirmation_method,
    report_count: (row.reporter_device_ids || []).length,
    // Unlike reporter_device_ids, photos/notes were added openly by
    // whoever visited (not confidential) -- shown here in full so the
    // admin panel can display/remove them individually. See
    // app/api/admin/spotted-sales/[id]/route.js's PATCH for removal.
    photo_urls: row.photo_urls || [],
    notes: row.notes || [],
    first_reported_at: row.first_reported_at,
    last_reported_at: row.last_reported_at,
    confirmed_at: row.confirmed_at,
  }));

  return NextResponse.json(rows);
}
