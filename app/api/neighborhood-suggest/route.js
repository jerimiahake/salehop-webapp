import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Server-side lookup of neighborhood sale names sellers have already used,
// so the Post form can suggest existing names instead of, say, "Maple
// Ridge" and "Maple Ridge Sale" ending up as two separate, disconnected
// neighborhood sales.
//
// Uses the service-role connection (bypassing RLS) so it can match names
// from EVERY upcoming sale, including other sellers' still-pending
// submissions -- a visitor's own anon key can only see already-approved
// sales, which would miss duplicates from listings still awaiting review.
// Only neighborhood name strings are ever returned here, never full rows,
// so this stays safe to leave open (no admin login required), the same way
// /api/address-suggest is.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') || '').trim();

  if (!query || !isSupabaseAdminConfigured) {
    return NextResponse.json([]);
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from('sales')
    .select('neighborhood_name')
    .eq('is_neighborhood_sale', true)
    .not('neighborhood_name', 'is', null)
    .gte('sale_date', today)
    .ilike('neighborhood_name', `%${query}%`)
    .limit(30);

  if (error || !data) {
    return NextResponse.json([]);
  }

  // De-dupe case-insensitively (two sellers may type slightly different
  // casing/spacing for the same neighborhood) and cap the suggestion list.
  const seen = new Map();
  for (const row of data) {
    const name = (row.neighborhood_name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }

  return NextResponse.json(Array.from(seen.values()).slice(0, 8));
}
