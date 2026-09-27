// js/net/api.js
// Every call the game makes to the backend.
//
// READS come straight from PostgREST with Row Level Security doing the
// enforcing. WRITES that touch money, ownership, upgrades or race rewards go
// through Edge Functions, because the browser must never be trusted with those.
// There is deliberately no client-side path that can set money_cents.

import { db, supabase, functionUrl } from './supabase.js';
import { getSession } from './auth.js';

/* ------------------------------------------------------------- invocation */

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const FRIENDLY = {
  NOT_AUTHENTICATED: 'Your session expired. Please log in again.',
  BANNED: 'This account has been suspended.',
  INSUFFICIENT_FUNDS: 'Insufficient funds.',
  NOT_OWNED: 'You do not own this vehicle.',
  ALREADY_OWNED: 'You already own that vehicle.',
  UNKNOWN_CAR: 'That vehicle does not exist.',
  UNKNOWN_UPGRADE: 'That upgrade does not exist.',
  LEVEL_SEQUENCE: 'You have to buy the previous level of that upgrade first.',
  RESULT_REJECTED: 'Race result rejected by the server.',
  PERMISSION_DENIED: 'Admin permission denied.',
  RATE_LIMITED: 'You are doing that too quickly. Please wait a moment.',
  VALIDATION: 'The server rejected that request as invalid.',
};

async function invoke(name, body = {}) {
  const session = await getSession();
  if (!session) throw new ApiError(FRIENDLY.NOT_AUTHENTICATED, 'NOT_AUTHENTICATED', 401);

  let res;
  try {
    res = await fetch(functionUrl(name), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Unable to connect to the server. Check your internet connection.', 'NETWORK', 0);
  }

  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }

  if (!res.ok || !json || json.ok === false) {
    const code = json?.code || 'UNKNOWN';
    const msg = FRIENDLY[code] || json?.error || `Request failed (${res.status}).`;
    throw new ApiError(msg, code, res.status);
  }
  return json;
}

function readError(error, fallback) {
  if (!error) return null;
  const m = (error.message || '').toLowerCase();
  if (m.includes('failed to fetch')) {
    return new ApiError('Unable to connect to the server.', 'NETWORK', 0);
  }
  if (m.includes('jwt') || m.includes('expired')) {
    return new ApiError(FRIENDLY.NOT_AUTHENTICATED, 'NOT_AUTHENTICATED', 401);
  }
  return new ApiError(fallback || error.message, 'READ_FAILED', 500);
}

/* ------------------------------------------------------------------ reads */

export async function getProfile() {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new ApiError(FRIENDLY.NOT_AUTHENTICATED, 'NOT_AUTHENTICATED', 401);
  const { data, error } = await db()
    .from('profiles')
    .select('*')
    .eq('id', u.user.id)
    .maybeSingle();
  if (error) throw readError(error, 'Could not load your profile.');
  return data;
}

export async function getGarage() {
  const { data, error } = await db()
    .from('player_cars')
    .select('*, player_upgrades(*), player_tuning(*)')
    .order('acquired_at', { ascending: true });
  if (error) throw readError(error, 'Could not load your garage.');
  return (data || []).map(normalizeCar);
}

export async function getPlayerCar(playerCarId) {
  const { data, error } = await db()
    .from('player_cars')
    .select('*, player_upgrades(*), player_tuning(*)')
    .eq('id', playerCarId)
    .maybeSingle();
  if (error) throw readError(error, 'Could not load that vehicle.');
  return data ? normalizeCar(data) : null;
}

function normalizeCar(row) {
  const upgrades = {};
  for (const u of row.player_upgrades || []) upgrades[u.slot] = u.level;
  const tuningRow = Array.isArray(row.player_tuning) ? row.player_tuning[0] : row.player_tuning;
  return {
    id: row.id,
    carId: row.car_id,
    nickname: row.nickname,
    condition: {
      engineHealth: Number(row.engine_health),
      transmissionHealth: Number(row.transmission_health),
      clutchHealth: Number(row.clutch_health),
      tireHealth: Number(row.tire_health),
    },
    tireCompound: row.tire_compound,
    upgrades,
    tuning: tuningRow?.tuning || null,
    bestEtQuarter: row.best_et_quarter,
    bestMphQuarter: row.best_mph_quarter,
    bestEtEighth: row.best_et_eighth,
    bestMphEighth: row.best_mph_eighth,
    odometerM: Number(row.odometer_m || 0),
    acquiredAt: row.acquired_at,
    isStarter: row.is_starter,
  };
}

export async function getStatistics() {
  const { data, error } = await db().from('player_statistics').select('*').maybeSingle();
  if (error) throw readError(error, 'Could not load your statistics.');
  return data;
}

export async function getRaceHistory(limit = 25) {
  const { data, error } = await db()
    .from('race_results')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw readError(error, 'Could not load your race history.');
  return data || [];
}

/**
 * @param {string} category 'quarter_et' | 'quarter_mph' | 'eighth_et' | 'eighth_mph'
 */
export async function getLeaderboard(category, opts = {}) {
  const ascending = category.endsWith('_et');   // quicker is better; faster mph is better
  let q = db()
    .from('leaderboard_entries')
    .select('*')
    .eq('category', category);
  if (opts.carId) q = q.eq('car_id', opts.carId);
  if (opts.drivingMode) q = q.eq('driving_mode', opts.drivingMode);
  if (opts.carClass) q = q.eq('car_class', opts.carClass);
  q = q.order('value', { ascending }).limit(opts.limit || 50);
  const { data, error } = await q;
  if (error) throw readError(error, 'Could not load the leaderboard.');
  return data || [];
}

export async function getCarDefinitions() {
  const { data, error } = await db()
    .from('car_definitions')
    .select('*')
    .eq('enabled', true);
  if (error) throw readError(error, 'Could not load the dealership.');
  return data || [];
}

/* ------------------------------------------------------- privileged writes */

export function buyCar(carId) {
  return invoke('buy-car', { carId });
}

export function buyUpgrade(playerCarId, slot, level) {
  return invoke('buy-upgrade', { playerCarId, slot, level });
}

export function saveTuning(playerCarId, tuning) {
  return invoke('save-tuning', { playerCarId, tuning });
}

/**
 * @param {string[]} parts any of 'engine','transmission','clutch','tires'
 */
export function repairCar(playerCarId, parts) {
  return invoke('repair-car', { playerCarId, parts });
}

export function setNickname(playerCarId, nickname) {
  return invoke('save-tuning', { playerCarId, nickname });
}

/**
 * The client sends what happened; the server re-derives what it is worth.
 * Nothing about the payout is taken from this payload.
 */
export function submitRace(payload) {
  return invoke('submit-race', payload);
}

/* ------------------------------------------------------------------ admin */

export const admin = {
  searchPlayers(query, opts = {}) {
    return invoke('admin-query', { action: 'search', query, limit: opts.limit || 25, offset: opts.offset || 0 });
  },
  getPlayer(playerId) {
    return invoke('admin-query', { action: 'player', playerId });
  },
  dashboard() {
    return invoke('admin-query', { action: 'dashboard' });
  },
  auditLog(opts = {}) {
    return invoke('admin-query', { action: 'audit', limit: opts.limit || 50, offset: opts.offset || 0, adminId: opts.adminId, targetId: opts.targetId });
  },
  raceResults(opts = {}) {
    return invoke('admin-query', { action: 'races', playerId: opts.playerId, limit: opts.limit || 50 });
  },
  money(playerId, operation, amountCents, reason) {
    return invoke('admin-money', { playerId, operation, amountCents, reason });
  },
  vehicle(playerId, operation, payload = {}) {
    return invoke('admin-vehicle', { playerId, operation, ...payload });
  },
  /** @param {string} [role] only used by the SET_ROLE operation */
  moderate(playerId, operation, reason, role) {
    return invoke('admin-moderate', { playerId, operation, reason, role });
  },
};
