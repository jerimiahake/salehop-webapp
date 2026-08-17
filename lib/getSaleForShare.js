import { cache } from 'react';
import { createClient } from '@supabase/supabase-js';

// Server-only fetch used by the /listing/[id] share page. Wrapped in
// React's `cache()` so that generateMetadata() and the page component --
// which both need the same sale -- only actually hit Supabase once per
// request instead of twice.
//
// Uses the public anon key (not the service-role key), so it's naturally
// restricted by the same "Public can view approved sales" RLS policy the
// rest of the site's anonymous visitors use -- a listing only becomes
// shareable once it's been approved. This file is only ever imported from
// server components/functions (never a 'use client' file), so that's safe.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const getSaleForShare = cache(async function getSaleForShare(id) {
  if (!supabaseUrl || !supabaseAnonKey || !id) return null;

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });

  const { data } = await client
    .from('sales')
    .select('*')
    .eq('id', id)
    .eq('status', 'approved')
    .maybeSingle();

  return data || null;
});
