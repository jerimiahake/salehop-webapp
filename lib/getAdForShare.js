import { cache } from 'react';
import { createClient } from '@supabase/supabase-js';

// Server-only fetch used by the /ad/[id] share page -- the ad equivalent of
// lib/getSaleForShare.js. Wrapped in React's `cache()` so generateMetadata()
// and the page component (which both need the same ad) only hit Supabase
// once per request instead of twice.
//
// Uses the public anon key (not the service-role key), so it's naturally
// restricted by the same "Public can view active ads" RLS policy every
// anonymous visitor uses -- an ad only becomes shareable once it's active.
// This file is only ever imported from server components/functions (never
// a 'use client' file), so that's safe.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const getAdForShare = cache(async function getAdForShare(id) {
  if (!supabaseUrl || !supabaseAnonKey || !id) return null;

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });

  const { data } = await client
    .from('ads')
    .select('*')
    .eq('id', id)
    .eq('active', true)
    .maybeSingle();

  return data || null;
});
