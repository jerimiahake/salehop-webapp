import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Public detail view for one spotted sale -- opened when someone taps a
// 🚩 pin on the map or a spotted-sale card on Browse (see
// components/SpottedSaleSheet.js). Same "never expose reporter_device_ids"
// rule as the list route (app/api/spotted-sales/route.js) and the admin
// list route -- only the public-safe fields go out.
export async function GET(request, { params }) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Not available right now.' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from('spotted_sales')
    .select('id, lat, lng, status, confirmation_method, photo_urls, notes, first_reported_at, last_reported_at, confirmed_at')
    .eq('id', params.id)
    .neq('status', 'rejected')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'That reported sale could not be found.' }, { status: 404 });
  }

  return NextResponse.json(data);
}
