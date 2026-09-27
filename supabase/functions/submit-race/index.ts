// supabase/functions/submit-race/index.ts
//
// Recording a run.
//
// This is the function most worth attacking, because it is the one that pays
// out. So the rule is absolute: the request says what HAPPENED, and the server
// decides what it is WORTH. There is no "payout" field in the request, and if
// you add one it will be ignored.
//
// Validation philosophy: reject the physically impossible, flag the merely
// suspicious, and never punish someone for one strange run. A dropped frame or
// a browser tab losing focus can produce an odd timeslip from an honest player.

import { preflight } from '../_shared/cors.ts';
import {
  serviceClient, authenticate, readBody, requireUuid, ok, fail, HttpError, throttle,
} from '../_shared/common.ts';

const FT_TO_M = 0.3048;

/** Race modes that pay, and what they multiply the purse by. */
const MODE_PAYOUT: Record<string, number> = {
  test: 0,
  free: 0,
  quick: 1.0,
  headsup: 1.1,
  bracket: 1.25,
  tournament: 1.5,
};

const DIFFICULTY_MULT: Record<string, number> = {
  easy: 0.7, normal: 1.0, hard: 1.3, pro: 1.6,
};

const MAX_PAYOUT_CENTS = 1_000_000;   // $10,000 ceiling on any single run

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const db = serviceClient();
    const body = await readBody(req);
    const caller = await authenticate(req, db);
    throttle(`race:${caller.id}`, 900);

    const playerCarId = requireUuid(body, 'playerCarId');
    const mode = String(body.mode || 'test');
    const drivingMode = ['arcade', 'manual', 'realistic'].includes(String(body.drivingMode))
      ? String(body.drivingMode) : 'arcade';
    const difficulty = ['easy', 'normal', 'hard', 'pro'].includes(String(body.difficulty))
      ? String(body.difficulty) : 'normal';

    const distanceFt = Math.round(Number(body.distanceFt));
    if (!Number.isFinite(distanceFt) || distanceFt < 100 || distanceFt > 6000) {
      throw new HttpError(400, 'VALIDATION', 'That race distance is not valid.');
    }
    if (!(mode in MODE_PAYOUT)) {
      throw new HttpError(400, 'VALIDATION', 'Unknown race mode.');
    }

    // ---------------------------------------------------------- ownership
    const { data: car } = await db
      .from('player_cars')
      .select('*')
      .eq('id', playerCarId)
      .maybeSingle();

    if (!car || car.player_id !== caller.id) {
      throw new HttpError(403, 'NOT_OWNED', 'You do not own this vehicle.');
    }

    const { data: def } = await db
      .from('car_definitions')
      .select('id, name, class, price_cents, hp, weight_kg')
      .eq('id', car.car_id)
      .maybeSingle();

    if (!def) throw new HttpError(404, 'UNKNOWN_CAR', 'That vehicle does not exist.');

    // ---- how much power could this car POSSIBLY have after upgrades?
    // Used only to work out the quickest ET that is physically believable.
    const { data: upgrades } = await db
      .from('player_upgrades')
      .select('slot, level')
      .eq('player_car_id', playerCarId);

    const slip = (body.timeslip && typeof body.timeslip === 'object') ? body.timeslip : {};
    const warnings: string[] = [];

    const check = validateTimeslip(slip, distanceFt, def, upgrades || [], warnings);

    // ------------------------------------------------------------ payout
    const resultRaw = String(body.result || 'none');
    const result = ['win', 'loss', 'none'].includes(resultRaw) ? resultRaw : 'none';
    const foul = !!slip.foul;

    let payout = 0;
    let payoutReason = 'No purse for this session';

    if (check.valid && MODE_PAYOUT[mode] > 0) {
      // The purse scales with what the car is worth — a class D hatch does not
      // earn supercar money, and a supercar's repairs do not get funded by
      // beating a hatchback.
      const purse = clampInt(Math.round(Number(def.price_cents) * 0.02), 20_000, 500_000);
      const distanceMult = distanceFt >= 1320 ? 1 : distanceFt >= 1000 ? 0.85 : 0.7;
      const base = purse * MODE_PAYOUT[mode] * distanceMult * DIFFICULTY_MULT[difficulty];

      if (foul) {
        payout = Math.round(base * 0.05);
        payoutReason = 'Red light — appearance money only';
      } else if (result === 'win') {
        payout = Math.round(base);
        payoutReason = 'Race win';
      } else if (result === 'loss') {
        payout = Math.round(base * 0.18);
        payoutReason = 'Runner-up share';
      } else {
        payout = Math.round(base * 0.08);
        payoutReason = 'No result recorded';
      }
      payout = clampInt(payout, 0, MAX_PAYOUT_CENTS);
    } else if (!check.valid) {
      payoutReason = 'Result rejected — no payout';
      warnings.push(check.reason || 'Result failed validation');
    } else if (mode === 'test') {
      payoutReason = 'Test run — no purse';
    } else if (mode === 'free') {
      payoutReason = 'Free run — no purse';
    }

    // ------------------------------------------------- condition (wear only)
    // The client reports the wear its simulation produced. The server accepts
    // it ONLY in the direction of more damage: you cannot repair a car by
    // posting a race result claiming the engine is at 100%.
    const incoming = (body.condition && typeof body.condition === 'object') ? body.condition : {};
    const wear = {
      engine_health: clampDown(Number(car.engine_health), incoming.engineHealth),
      transmission_health: clampDown(Number(car.transmission_health), incoming.transmissionHealth),
      clutch_health: clampDown(Number(car.clutch_health), incoming.clutchHealth),
      tire_health: clampDown(Number(car.tire_health), incoming.tireHealth),
    };

    // ------------------------------------------------------ personal bests
    const bests: Record<string, number | null> = {
      best_et_quarter: numOrNull(car.best_et_quarter),
      best_mph_quarter: numOrNull(car.best_mph_quarter),
      best_et_eighth: numOrNull(car.best_et_eighth),
      best_mph_eighth: numOrNull(car.best_mph_eighth),
    };
    let personalBest = false;

    const eligible = check.valid && !foul && mode !== 'free';
    if (eligible) {
      const qEt = numOrNull(slip.quarterEt);
      const qMph = numOrNull(slip.quarterMph);
      const eEt = numOrNull(slip.eighthEt);
      const eMph = numOrNull(slip.eighthMph);

      if (qEt && (bests.best_et_quarter == null || qEt < bests.best_et_quarter)) {
        bests.best_et_quarter = qEt; personalBest = true;
      }
      if (qMph && (bests.best_mph_quarter == null || qMph > bests.best_mph_quarter)) {
        bests.best_mph_quarter = qMph; personalBest = true;
      }
      if (eEt && (bests.best_et_eighth == null || eEt < bests.best_et_eighth)) {
        bests.best_et_eighth = eEt; personalBest = true;
      }
      if (eMph && (bests.best_mph_eighth == null || eMph > bests.best_mph_eighth)) {
        bests.best_mph_eighth = eMph; personalBest = true;
      }
    }

    // ------------------------------------------------------------- persist
    const opponent = (body.opponent && typeof body.opponent === 'object') ? body.opponent : null;

    const { data: raceRow, error: raceErr } = await db.from('race_results').insert({
      player_id: caller.id,
      player_car_id: playerCarId,
      car_id: car.car_id,
      mode,
      distance_ft: distanceFt,
      driving_mode: drivingMode,
      difficulty,
      reaction: numOrNull(slip.reaction),
      foul,
      sixty: numOrNull(slip.sixty),
      three_thirty: numOrNull(slip.threeThirty),
      eighth_et: numOrNull(slip.eighthEt),
      eighth_mph: numOrNull(slip.eighthMph),
      thousand_et: numOrNull(slip.thousandEt),
      quarter_et: numOrNull(slip.quarterEt),
      quarter_mph: numOrNull(slip.quarterMph),
      et: numOrNull(slip.et),
      trap_mph: numOrNull(slip.trapMph),
      result,
      opponent_name: opponent?.name ? String(opponent.name).slice(0, 40) : null,
      opponent_car_id: opponent?.carId ? String(opponent.carId).slice(0, 64) : null,
      opponent_et: numOrNull(opponent?.et),
      payout_cents: payout,
      valid: check.valid,
      reject_reason: check.valid ? (warnings.length ? warnings.join('; ').slice(0, 300) : null) : check.reason,
    }).select('id').single();

    if (raceErr) throw new HttpError(500, 'INTERNAL', 'The race could not be saved.');

    // vehicle: wear, odometer, bests
    await db.from('player_cars').update({
      ...wear,
      ...bests,
      odometer_m: Number(car.odometer_m || 0) + Math.round(distanceFt * FT_TO_M),
    }).eq('id', playerCarId);

    // money
    const balance = Number(caller.profile.money_cents);
    const newBalance = Math.max(0, balance + payout);
    if (payout !== 0) {
      await db.from('profiles')
        .update({ money_cents: newBalance, updated_at: new Date().toISOString() })
        .eq('id', caller.id);
    }

    // statistics
    await updateStatistics(db, caller.id, {
      win: result === 'win' && check.valid,
      loss: result === 'loss' && check.valid,
      foul,
      perfect: !foul && numOrNull(slip.reaction) != null && Number(slip.reaction) < 0.02,
      payout,
      distanceM: Math.round(distanceFt * FT_TO_M),
      slip,
      eligible,
    });

    // leaderboards
    if (eligible) {
      await updateLeaderboard(db, {
        playerId: caller.id,
        username: caller.profile.username,
        carId: car.car_id,
        carName: def.name,
        carClass: def.class,
        drivingMode,
        raceResultId: raceRow.id,
        slip,
      });
    }

    if (!check.valid) {
      return ok(req, {
        accepted: false,
        code: 'RESULT_REJECTED',
        payoutCents: 0,
        payoutReason,
        moneyCents: newBalance,
        condition: toCamel(wear),
        warnings: [check.reason || 'Result rejected'],
      });
    }

    return ok(req, {
      accepted: true,
      payoutCents: payout,
      payoutReason,
      moneyCents: newBalance,
      personalBest,
      condition: toCamel(wear),
      bests,
      warnings,
    });
  } catch (err) {
    return fail(req, err);
  }
});

/* ======================================================================== */

function clampInt(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

/** Health can move down but never up through this endpoint. */
function clampDown(stored: number, incoming: unknown): number {
  const n = Number(incoming);
  if (!Number.isFinite(n)) return stored;
  return Math.max(0, Math.min(stored, Math.min(100, n)));
}

function toCamel(w: Record<string, number>) {
  return {
    engineHealth: w.engine_health,
    transmissionHealth: w.transmission_health,
    clutchHealth: w.clutch_health,
    tireHealth: w.tire_health,
  };
}

/**
 * Anti-cheat.
 *
 * The server does not re-run the physics — that would cost more than it is
 * worth for a game with fictional money. Instead it checks the result against
 * what is physically possible for the car, and against itself for internal
 * consistency. Made-up numbers fail all three tests at once; a genuinely
 * brilliant run passes them all with room to spare.
 */
function validateTimeslip(
  slip: Record<string, any>,
  distanceFt: number,
  def: { hp: number; weight_kg: number },
  upgrades: { slot: string; level: number }[],
  warnings: string[],
): { valid: boolean; reason?: string } {
  const et = numOrNull(slip.et);
  const trap = numOrNull(slip.trapMph);

  // A run with no ET is a run that did not finish. That is allowed — it just
  // earns nothing much and sets no records.
  if (et == null) return { valid: true };

  // --- 1. absolute sanity
  if (et <= 0 || et > 600) return { valid: false, reason: 'Elapsed time out of range' };
  if (trap != null && (trap < 0 || trap > 350)) {
    return { valid: false, reason: 'Trap speed out of range' };
  }

  // --- 2. splits must be increasing and inside the ET
  const order = ['sixty', 'threeThirty', 'eighthEt', 'thousandEt', 'quarterEt'];
  let prev = 0;
  for (const key of order) {
    const v = numOrNull(slip[key]);
    if (v == null) continue;
    if (v <= prev) return { valid: false, reason: 'Timing splits are not in order' };
    if (v > et + 0.001 && key !== 'quarterEt') {
      return { valid: false, reason: 'A split is later than the finish' };
    }
    prev = v;
  }

  const reaction = numOrNull(slip.reaction);
  if (reaction != null && (reaction < -1.5 || reaction > 10)) {
    return { valid: false, reason: 'Reaction time out of range' };
  }

  // --- 3. could this car physically run that quickly?
  // Be generous. Assume every upgrade in the game is fitted: roughly 4x the
  // stock power and 18% off the weight is beyond anything actually buildable
  // here, which is exactly why a result quicker than THAT is impossible rather
  // than merely impressive.
  const hasUpgrades = upgrades.length > 0;
  const maxHp = Number(def.hp) * (hasUpgrades ? 4.2 : 1.35);
  const minKg = Number(def.weight_kg) * 0.80;

  // Same empirical curve the game uses to estimate ET, with a wide margin.
  const estQuarter = 5.9 * Math.pow(minKg / Math.max(maxHp, 1), 0.38) + 2.6;
  const floorQuarter = Math.max(3.5, estQuarter * 0.62);
  const scale = distanceFt >= 1320 ? 1 : distanceFt >= 1000 ? 0.86 : 0.655;
  const floor = floorQuarter * scale * (distanceFt > 1320 ? distanceFt / 1320 : 1);

  if (et < floor) {
    return {
      valid: false,
      reason: `Elapsed time of ${et.toFixed(3)}s is not achievable by this vehicle`,
    };
  }

  // --- 4. ET and trap speed have to agree with each other.
  // Across every real drag car, ET x MPH lands in a fairly narrow band. A
  // result outside it means one of the two numbers was invented.
  if (trap != null && trap > 5 && distanceFt >= 660) {
    const product = et * trap;
    const expected = distanceFt >= 1320 ? 1350 : distanceFt >= 1000 ? 1050 : 720;
    const ratio = product / expected;
    if (ratio < 0.45 || ratio > 2.2) {
      return { valid: false, reason: 'Elapsed time and trap speed do not agree' };
    }
    if (ratio < 0.7 || ratio > 1.55) {
      warnings.push('Unusual time/speed combination');
    }
  }

  // --- 5. things that are odd but not impossible: record, do not reject.
  const sixty = numOrNull(slip.sixty);
  if (sixty != null && sixty < 0.75) warnings.push('Unusually quick 60 ft');
  if (reaction != null && reaction >= 0 && reaction < 0.005) warnings.push('Near-perfect light');

  return { valid: true };
}

async function updateStatistics(db: any, playerId: string, r: {
  win: boolean; loss: boolean; foul: boolean; perfect: boolean;
  payout: number; distanceM: number; slip: Record<string, any>; eligible: boolean;
}) {
  const { data: s } = await db
    .from('player_statistics')
    .select('*')
    .eq('player_id', playerId)
    .maybeSingle();

  const cur = s || { player_id: playerId };
  const better = (a: any, b: number | null, cmp: (x: number, y: number) => boolean) => {
    if (b == null) return a == null ? null : Number(a);
    if (a == null) return b;
    return cmp(b, Number(a)) ? b : Number(a);
  };

  const qEt = r.eligible ? numOrNull(r.slip.quarterEt) : null;
  const qMph = r.eligible ? numOrNull(r.slip.quarterMph) : null;
  const eEt = r.eligible ? numOrNull(r.slip.eighthEt) : null;
  const eMph = r.eligible ? numOrNull(r.slip.eighthMph) : null;
  const rt = r.eligible && !r.foul ? numOrNull(r.slip.reaction) : null;

  const row = {
    player_id: playerId,
    races: Number(cur.races || 0) + 1,
    wins: Number(cur.wins || 0) + (r.win ? 1 : 0),
    losses: Number(cur.losses || 0) + (r.loss ? 1 : 0),
    red_lights: Number(cur.red_lights || 0) + (r.foul ? 1 : 0),
    perfect_lights: Number(cur.perfect_lights || 0) + (r.perfect ? 1 : 0),
    total_earnings_cents: Number(cur.total_earnings_cents || 0) + Math.max(0, r.payout),
    total_distance_m: Number(cur.total_distance_m || 0) + r.distanceM,
    best_et_quarter: better(cur.best_et_quarter, qEt, (x, y) => x < y),
    best_mph_quarter: better(cur.best_mph_quarter, qMph, (x, y) => x > y),
    best_et_eighth: better(cur.best_et_eighth, eEt, (x, y) => x < y),
    best_mph_eighth: better(cur.best_mph_eighth, eMph, (x, y) => x > y),
    best_reaction: better(cur.best_reaction, rt != null && rt >= 0 ? rt : null, (x, y) => x < y),
    updated_at: new Date().toISOString(),
  };

  await db.from('player_statistics').upsert(row, { onConflict: 'player_id' });
}

async function updateLeaderboard(db: any, o: {
  playerId: string; username: string; carId: string; carName: string;
  carClass: string; drivingMode: string; raceResultId: string; slip: Record<string, any>;
}) {
  const entries: { category: string; value: number; lower: boolean }[] = [];
  const push = (category: string, v: number | null, lower: boolean) => {
    if (v != null && v > 0) entries.push({ category, value: v, lower });
  };
  push('quarter_et', numOrNull(o.slip.quarterEt), true);
  push('quarter_mph', numOrNull(o.slip.quarterMph), false);
  push('eighth_et', numOrNull(o.slip.eighthEt), true);
  push('eighth_mph', numOrNull(o.slip.eighthMph), false);

  for (const e of entries) {
    const { data: existing } = await db
      .from('leaderboard_entries')
      .select('id, value')
      .eq('player_id', o.playerId)
      .eq('car_id', o.carId)
      .eq('category', e.category)
      .eq('driving_mode', o.drivingMode)
      .maybeSingle();

    const isBetter = !existing
      || (e.lower ? e.value < Number(existing.value) : e.value > Number(existing.value));
    if (!isBetter) continue;

    const row = {
      player_id: o.playerId,
      username: o.username,
      car_id: o.carId,
      car_name: o.carName,
      car_class: o.carClass,
      category: e.category,
      value: e.value,
      driving_mode: o.drivingMode,
      race_result_id: o.raceResultId,
      created_at: new Date().toISOString(),
    };

    if (existing) {
      await db.from('leaderboard_entries').update(row).eq('id', existing.id);
    } else {
      await db.from('leaderboard_entries').insert(row);
    }
  }
}
