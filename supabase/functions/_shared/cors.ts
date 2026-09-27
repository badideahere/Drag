// supabase/functions/_shared/cors.ts
//
// GitHub Pages serves the game from a different origin to Supabase, so every
// function has to answer CORS preflight requests or the browser will refuse to
// call it.
//
// SITE_ORIGIN is read from an Edge Function secret (see README section 6). If
// you have not set it, we fall back to '*', which works but is less strict.
// Setting it is recommended once the game is deployed.

const configured = (Deno.env.get('SITE_ORIGIN') || '').trim();

/** Origins that are always allowed, so local testing works out of the box. */
const LOCAL = [
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
];

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  let allow = '*';

  if (configured) {
    const allowed = configured.split(',').map((s) => s.trim()).filter(Boolean);
    // Compare origins only (scheme + host + port), ignoring any path in
    // SITE_ORIGIN like https://name.github.io/repo.
    const originOf = (u: string) => { try { return new URL(u).origin; } catch { return u; } };
    const list = allowed.map(originOf).concat(LOCAL);
    allow = list.includes(origin) ? origin : originOf(allowed[0]);
  }

  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Answer the browser's preflight request. Returns null for real requests. */
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }
  return null;
}
