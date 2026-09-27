// js/net/supabase.js
// One shared Supabase client for the whole site.
//
// The library is loaded from a CDN as an ES module so there is no build step
// and no server process — which is what lets this run on GitHub Pages.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { CONFIG, isConfigured } from '../config.js';

let client = null;
export let configError = null;

if (!isConfigured()) {
  configError =
    'This copy of the game has not been connected to a Supabase project yet. '
    + 'Open js/config.js and fill in SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY. '
    + 'See README section 5.';
} else {
  client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,       // "stay signed in"
      autoRefreshToken: true,
      detectSessionInUrl: true,   // password-reset links land back here
      storageKey: 'staged.auth',
    },
  });
}

export const supabase = client;

/** Throws a readable error instead of a null-pointer if config is missing. */
export function db() {
  if (!client) throw new Error(configError);
  return client;
}

/** URL of a deployed Edge Function. */
export function functionUrl(name) {
  return `${CONFIG.SUPABASE_URL}/functions/v1/${name}`;
}
