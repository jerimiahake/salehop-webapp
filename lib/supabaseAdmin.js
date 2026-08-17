import { createClient } from '@supabase/supabase-js';

// Server-only Supabase client using the service role key, which bypasses
// Row Level Security entirely. It has full read/write access to every
// table, so:
//   * Only import this file from API routes under app/api/admin/**.
//   * NEVER import it from a 'use client' component.
//   * NEVER give SUPABASE_SERVICE_ROLE_KEY a NEXT_PUBLIC_ prefix -- that
//     would ship it to every visitor's browser.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isSupabaseAdminConfigured = Boolean(supabaseUrl && serviceRoleKey);

export const supabaseAdmin = isSupabaseAdminConfigured
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
