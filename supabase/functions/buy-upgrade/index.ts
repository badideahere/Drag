// supabase/functions/buy-upgrade/index.ts
//
// Fitting a part.
//
// Checks, in order: you are signed in, you own that vehicle, the upgrade
// exists, you do not already have that level or better, you are buying the very
// next level (no skipping straight to stage 3), and you can afford the price
// that is stored in the database.

import { preflight } from '../_shared/cors.ts';
import {
  serviceClient, authenticate, readBody, requireString, requireUuid, requireInt,
  ok, fail, HttpError, throttle,
} from '../_shared/common.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const db = serviceClient();
    const body = await readBody(req);
    const caller = await authenticate(req, db);
    throttle(`buy-upgrade:${caller.id}`, 500);

    const playerCarId = requireUuid(body, 'playerCarId');
    const slot = requireString(body, 'slot', 40);
    const level = requireInt(body, 'level', 1, 10);

    // ---- ownership
    const { data: car } = await db
      .from('player_cars')
      .select('id, player_id, car_id')
      .eq('id', playerCarId)
      .maybeSingle();

    if (!car || car.player_id !== caller.id) {
      throw new HttpError(403, 'NOT_OWNED', 'You do not own this vehicle.');
    }

    // ---- the part and its price
    const { data: upgrade } = await db
      .from('upgrade_definitions')
      .select('*')
      .eq('slot', slot)
      .eq('level', level)
      .eq('enabled', true)
      .maybeSingle();

    if (!upgrade) {
      throw new HttpError(404, 'UNKNOWN_UPGRADE', 'That upgrade does not exist.');
    }

    // ---- level sequencing
    const { data: existing } = await db
      .from('player_upgrades')
      .select('id, level')
      .eq('player_car_id', playerCarId)
      .eq('slot', slot)
      .maybeSingle();

    const current = existing ? Number(existing.level) : 0;
    if (level <= current) {
      throw new HttpError(409, 'ALREADY_OWNED', 'That part is already fitted.');
    }
    if (level !== current + 1) {
      throw new HttpError(409, 'LEVEL_SEQUENCE',
        'You have to buy the previous level of that upgrade first.');
    }

    // ---- forced-induction constraints
    // Mirrors js/data/upgrades.js's requiresAspiration/conflictsWith — keep in
    // sync if that file's turbo/supercharger/intercooler entries change. The
    // shop UI enforces this too, but that is a convenience, not the boundary:
    // this is what actually stops a player owning both a turbo and a
    // supercharger, whose numeric boost deltas would otherwise compound.
    const REQUIRES_ASPIRATION: Record<string, string[]> = {
      turbo: ['na', 'turbo'],
      supercharger: ['na', 'supercharged'],
      intercooler: ['turbo', 'supercharged'],
    };
    const CONFLICTS_WITH: Record<string, string[]> = {
      supercharger: ['turbo'],
    };

    if (slot in REQUIRES_ASPIRATION || slot in CONFLICTS_WITH
      || Object.values(CONFLICTS_WITH).some((list) => list.includes(slot))) {
      const [{ data: def }, { data: ownedRows }] = await Promise.all([
        db.from('car_definitions').select('aspiration').eq('id', car.car_id).maybeSingle(),
        db.from('player_upgrades').select('slot, level').eq('player_car_id', playerCarId),
      ]);
      if (!def) throw new HttpError(404, 'UNKNOWN_CAR', 'That vehicle does not exist.');

      const owned: Record<string, number> = {};
      for (const r of ownedRows || []) owned[r.slot] = Number(r.level);
      const effectiveAspiration = owned.turbo > 0 ? 'turbo'
        : owned.supercharger > 0 ? 'supercharged'
          : String(def.aspiration);

      for (const otherSlot of CONFLICTS_WITH[slot] || []) {
        if ((owned[otherSlot] || 0) > 0) {
          throw new HttpError(409, 'VALIDATION', 'That upgrade conflicts with a part already fitted.');
        }
      }
      for (const [ownedSlot, lvl] of Object.entries(owned)) {
        if (!lvl) continue;
        if ((CONFLICTS_WITH[ownedSlot] || []).includes(slot)) {
          throw new HttpError(409, 'VALIDATION', 'That upgrade conflicts with a part already fitted.');
        }
      }
      const needs = REQUIRES_ASPIRATION[slot];
      if (needs && !needs.includes(effectiveAspiration)) {
        throw new HttpError(409, 'VALIDATION', 'That upgrade is not compatible with this engine right now.');
      }
    }

    // ---- funds
    const price = Number(upgrade.price_cents);
    const balance = Number(caller.profile.money_cents);
    if (balance < price) {
      throw new HttpError(402, 'INSUFFICIENT_FUNDS', 'You cannot afford that part.');
    }

    const { data: updated, error: payErr } = await db
      .from('profiles')
      .update({ money_cents: balance - price, updated_at: new Date().toISOString() })
      .eq('id', caller.id)
      .eq('money_cents', balance)
      .select('money_cents')
      .maybeSingle();

    if (payErr) throw new HttpError(500, 'INTERNAL', 'The purchase could not be completed.');
    if (!updated) {
      throw new HttpError(409, 'RETRY',
        'Your balance changed while the purchase was processing. Please try again.');
    }

    // ---- fit the part
    const { error: fitErr } = existing
      ? await db.from('player_upgrades')
        .update({ level, purchased_at: new Date().toISOString() })
        .eq('id', existing.id)
      : await db.from('player_upgrades')
        .insert({ player_car_id: playerCarId, slot, level });

    if (fitErr) {
      await db.from('profiles').update({ money_cents: balance }).eq('id', caller.id);
      throw new HttpError(500, 'INTERNAL', 'The part could not be fitted. You were not charged.');
    }

    // A fresh set of tires is a fresh set of tires.
    if (slot === 'tires') {
      await db.from('player_cars')
        .update({ tire_health: 100 })
        .eq('id', playerCarId);
    }

    return ok(req, {
      slot,
      level,
      pricePaidCents: price,
      moneyCents: Number(updated.money_cents),
    });
  } catch (err) {
    return fail(req, err);
  }
});
