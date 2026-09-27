// js/config.js
// ---------------------------------------------------------------------------
// THE ONLY FILE YOU NEED TO EDIT TO CONNECT THE GAME TO YOUR OWN SUPABASE.
// ---------------------------------------------------------------------------
//
// Everything in here is PUBLIC. It ships to the browser and anybody can read it.
// That is fine — the two Supabase values below are designed to be public.
//
// >>> NEVER put your Supabase "service_role" / "secret" key in this file. <<<
// Secret keys live only in Supabase Edge Function secrets. See README section 6.
//
// Where to find these values:
//   Supabase dashboard -> your project -> Settings -> API
//     Project URL      -> SUPABASE_URL
//     Publishable key  -> SUPABASE_PUBLISHABLE_KEY
//     (older projects call this the "anon public" key — same thing)

export const CONFIG = {
  // ---- REPLACE THIS ------------------------------------------------------
  // Looks like: 'https://abcdefghijklmnop.supabase.co'
  SUPABASE_URL: 'https://mkqubytbhxhisguwrtts.supabase.co',

  // ---- REPLACE THIS ------------------------------------------------------
  // Long string beginning with 'sb_publishable_' or 'eyJ...'
  SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcXVieXRiaHhoaXNndXdydHRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0NTc3MDEsImV4cCI6MjEwNjAzMzcwMX0.S4f1tV6nE93NtOFppSlwMF7t8Nj6fbO2fkTXER8agNw',

  // ---- REPLACE THIS ------------------------------------------------------
  // Where the game is hosted. Used for password-reset redirects.
  // GitHub Pages looks like: 'https://YOURNAME.github.io/REPOSITORY'
  // For local testing you can use: 'http://localhost:8080'
  SITE_ORIGIN: 'https://badideahere.github.io/Drag/',

  // ---- Gameplay defaults (safe to change) --------------------------------
  // These are MIRRORED server-side in supabase/migrations/001_schema.sql.
  // Changing them here only changes what the UI *says*. To actually change
  // the starting balance or starter car, edit the SQL too (README section 11).
  STARTING_MONEY: 750000,          // in cents => $7,500.00
  STARTER_CAR_ID: 'corso_hatch',

  // ---- Misc --------------------------------------------------------------
  GAME_NAME: 'STAGED',
  GAME_TAGLINE: 'Drag Simulator',
  VERSION: '1.0.0',
};

/** True once the file has actually been filled in. */
export function isConfigured() {
  return (
    CONFIG.SUPABASE_URL.startsWith('http') &&
    !CONFIG.SUPABASE_URL.includes('PASTE_') &&
    CONFIG.SUPABASE_PUBLISHABLE_KEY.length > 20 &&
    !CONFIG.SUPABASE_PUBLISHABLE_KEY.includes('PASTE_')
  );
}

/**
 * Works out the site root no matter whether the game is served from
 * https://user.github.io/repo/ or http://localhost:8080/ — used so every page
 * can link to every other page without hard-coded absolute paths.
 */
export function siteRoot() {
  const path = window.location.pathname;
  const idx = path.lastIndexOf('/');
  return path.slice(0, idx + 1);
}

export function pageUrl(name) {
  return siteRoot() + name;
}
