// supabase/functions/_shared/common.ts
//
// Authentication, permissions, responses and audit logging.
//
// The golden rule in this directory: NOTHING in the request body is trusted
// except as an *intent*. Identity comes from the JWT. Prices come from the
// database. Rewards are computed here. Roles are re-read from the database on
// every single call — never taken from the token, the body or a header.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from './cors.ts';

export type Role = 'PLAYER' | 'MODERATOR' | 'ADMIN' | 'OWNER';

export interface Caller {
  id: string;
  email: string | null;
  profile: {
    id: string;
    username: string;
    email: string | null;
    role: Role;
    banned: boolean;
    money_cents: number;
  };
}

/** Service-role client. Bypasses RLS, so everything it does must be checked. */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new HttpError(500, 'SERVER_MISCONFIGURED',
      'The server is missing its Supabase credentials.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function ok(req: Request, body: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    status: 200,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

export function fail(req: Request, err: unknown): Response {
  const e = err instanceof HttpError
    ? err
    : new HttpError(500, 'INTERNAL', 'Something went wrong on the server.');
  if (!(err instanceof HttpError)) {
    // Log the real error for the project owner, but never send a stack trace
    // to the browser.
    console.error('Unhandled error:', err);
  }
  return new Response(JSON.stringify({ ok: false, code: e.code, error: e.message }), {
    status: e.status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

/**
 * Verify the caller's JWT and load their profile fresh from the database.
 * A banned player is refused here, once, for every privileged action.
 */
export async function authenticate(
  req: Request,
  db: SupabaseClient,
  opts: { allowBanned?: boolean } = {},
): Promise<Caller> {
  const header = req.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    throw new HttpError(401, 'NOT_AUTHENTICATED', 'You are not signed in.');
  }

  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) {
    throw new HttpError(401, 'NOT_AUTHENTICATED', 'Your session expired. Please log in again.');
  }

  const { data: profile, error: pErr } = await db
    .from('profiles')
    .select('id, username, email, role, banned, money_cents')
    .eq('id', data.user.id)
    .maybeSingle();

  if (pErr || !profile) {
    throw new HttpError(403, 'NO_PROFILE', 'No player profile exists for this account.');
  }
  if (profile.banned && !opts.allowBanned) {
    throw new HttpError(403, 'BANNED', 'This account has been suspended.');
  }

  // Cheap presence tracking; the admin panel sorts on it.
  db.from('profiles').update({ last_seen: new Date().toISOString() })
    .eq('id', profile.id).then(() => {}, () => {});

  return { id: profile.id, email: profile.email, profile: profile as Caller['profile'] };
}

/* ------------------------------------------------------------ permissions */

const RANK: Record<Role, number> = { PLAYER: 0, MODERATOR: 1, ADMIN: 2, OWNER: 3 };

export const PERMISSIONS: Record<string, Role> = {
  viewPlayers: 'MODERATOR',
  viewRaces: 'MODERATOR',
  viewAudit: 'MODERATOR',
  moderate: 'MODERATOR',
  money: 'ADMIN',
  vehicles: 'ADMIN',
  viewEconomy: 'ADMIN',
  roles: 'OWNER',
};

/**
 * The authority on who may do what. The admin panel hides buttons for tidiness;
 * THIS is what actually stops anyone.
 */
export function requirePermission(caller: Caller, permission: keyof typeof PERMISSIONS): void {
  const needed = PERMISSIONS[permission];
  if (!needed) throw new HttpError(500, 'INTERNAL', 'Unknown permission.');
  const have = RANK[caller.profile.role] ?? 0;
  if (have < RANK[needed]) {
    throw new HttpError(403, 'PERMISSION_DENIED',
      `This action requires ${needed} and your account is ${caller.profile.role}.`);
  }
}

export function hasRank(role: Role, needed: Role): boolean {
  return (RANK[role] ?? 0) >= RANK[needed];
}

/* --------------------------------------------------------------- body I/O */

export async function readBody(req: Request): Promise<Record<string, any>> {
  if (req.method !== 'POST') {
    throw new HttpError(405, 'METHOD', 'This endpoint only accepts POST.');
  }
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') throw new Error('not an object');
    return body as Record<string, any>;
  } catch {
    throw new HttpError(400, 'VALIDATION', 'The request body was not valid JSON.');
  }
}

export function requireString(body: Record<string, any>, key: string, max = 200): string {
  const v = body[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new HttpError(400, 'VALIDATION', `Missing "${key}".`);
  }
  if (v.length > max) throw new HttpError(400, 'VALIDATION', `"${key}" is too long.`);
  return v.trim();
}

export function requireUuid(body: Record<string, any>, key: string): string {
  const v = requireString(body, key, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new HttpError(400, 'VALIDATION', `"${key}" is not a valid id.`);
  }
  return v;
}

export function requireInt(body: Record<string, any>, key: string, min: number, max: number): number {
  const v = Number(body[key]);
  if (!Number.isFinite(v) || !Number.isInteger(v)) {
    throw new HttpError(400, 'VALIDATION', `"${key}" must be a whole number.`);
  }
  if (v < min || v > max) {
    throw new HttpError(400, 'VALIDATION', `"${key}" is out of range.`);
  }
  return v;
}

export function optNumber(body: Record<string, any>, key: string): number | null {
  const v = body[key];
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------- audit log */

export interface AuditEntry {
  adminId: string;
  adminUsername?: string | null;
  targetPlayerId?: string | null;
  targetUsername?: string | null;
  actionType:
    | 'ADMIN_ADD_MONEY' | 'ADMIN_REMOVE_MONEY' | 'ADMIN_SET_MONEY'
    | 'ADMIN_GIVE_CAR' | 'ADMIN_REMOVE_CAR' | 'ADMIN_REPAIR_CAR'
    | 'ADMIN_RESET_CAR' | 'ADMIN_BAN' | 'ADMIN_UNBAN' | 'ADMIN_SET_ROLE';
  amountCents?: number | null;
  carId?: string | null;
  playerCarId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Write an audit row. Every privileged action calls this. The client has no
 * write access to this table, and no admin UI path deletes from it.
 */
export async function audit(db: SupabaseClient, entry: AuditEntry): Promise<void> {
  const { error } = await db.from('admin_actions').insert({
    admin_id: entry.adminId,
    admin_username: entry.adminUsername ?? null,
    target_player_id: entry.targetPlayerId ?? null,
    target_username: entry.targetUsername ?? null,
    action_type: entry.actionType,
    amount_cents: entry.amountCents ?? null,
    car_id: entry.carId ?? null,
    player_car_id: entry.playerCarId ?? null,
    reason: entry.reason ? String(entry.reason).slice(0, 400) : null,
    metadata: entry.metadata ?? null,
  });
  if (error) console.error('Audit write failed:', error);
}

/* ---------------------------------------------------------- rate limiting */

const lastCall = new Map<string, number>();

/**
 * Very small in-memory throttle. Edge Function instances are short-lived, so
 * this is a speed bump against a hammering client, not a security control —
 * the real protection is that every action is validated anyway.
 */
export function throttle(key: string, minMs: number): void {
  const now = Date.now();
  const prev = lastCall.get(key) ?? 0;
  if (now - prev < minMs) {
    throw new HttpError(429, 'RATE_LIMITED', 'You are doing that too quickly.');
  }
  lastCall.set(key, now);
  if (lastCall.size > 5000) lastCall.clear();
}
