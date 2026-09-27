// supabase/functions/repair-car/index.ts
//
// Repairs.
//
// The client sends which components to fix. It does not send the cost, and the
// cost it displayed beforehand was only ever an estimate — the real figure is
// computed here from the vehicle's actual stored health and its actual list
// price, then charged.

import { preflight } from '../_shared/cors.ts';
import {
  serviceClient, authenticate, readBody, requireUuid, ok, fail, HttpError, throttle,
} from '../_shared/common.ts';

/** Cost per percentage point of damage, as a fraction of the car's list price. */
const REPAIR_RATE: Record<string, number> = {
  engine: 0.00042,
  transmission: 0.00030,
  clutch: 0.00022,
  tires: 0.00016,
};

const COLUMN: Record<string, string> = {
  engine: 'engine_health',
  transmission: 'transmission_health',
  clutch: 'clutch_health',
  tires: 'tire_health',
};

const CALLOUT_CENTS = 2000;   // $20 minimum, per component

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const db = serviceClient();
    const body = await readBody(req);
    const caller = await authenticate(req, db);
    throttle(`repair:${caller.id}`, 600);

    const playerCarId = requireUuid(body, 'playerCarId');

    const parts: string[] = Array.isArray(body.parts)
      ? [...new Set(body.parts.map((p: unknown) => String(p)))]
        .filter((p) => p in REPAIR_RATE)
      : [];

    if (!parts.length) {
      throw new HttpError(400, 'VALIDATION', 'Select at least one component to repair.');
    }

    const { data: car } = await db
      .from('player_cars')
      .select('id, player_id, car_id, engine_health, transmission_health, clutch_health, tire_health')
      .eq('id', playerCarId)
      .maybeSingle();

    if (!car || car.player_id !== caller.id) {
      throw new HttpError(403, 'NOT_OWNED', 'You do not own this vehicle.');
    }

    const { data: def } = await db
      .from('car_definitions')
      .select('price_cents')
      .eq('id', car.car_id)
      .maybeSingle();

    if (!def) throw new HttpError(404, 'UNKNOWN_CAR', 'That vehicle does not exist.');

    const listPrice = Number(def.price_cents);
    const patch: Record<string, unknown> = {};
    const breakdown: Record<string, number> = {};
    let total = 0;

    for (const part of parts) {
      const col = COLUMN[part];
      const health = Number((car as Record<string, any>)[col]);
      const damage = Math.max(0, 100 - health);
      if (damage < 0.5) continue;               // nothing to do, charge nothing
      const cost = Math.round(listPrice * REPAIR_RATE[part] * damage) + CALLOUT_CENTS;
      breakdown[part] = cost;
      total += cost;
      patch[col] = 100;
    }

    if (!total) {
      throw new HttpError(400, 'VALIDATION', 'Those components are already in good condition.');
    }

    const balance = Number(caller.profile.money_cents);
    if (balance < total) {
      throw new HttpError(402, 'INSUFFICIENT_FUNDS',
        'You cannot afford that repair.');
    }

    const { data: updated, error: payErr } = await db
      .from('profiles')
      .update({ money_cents: balance - total, updated_at: new Date().toISOString() })
      .eq('id', caller.id)
      .eq('money_cents', balance)
      .select('money_cents')
      .maybeSingle();

    if (payErr) throw new HttpError(500, 'INTERNAL', 'The repair could not be completed.');
    if (!updated) {
      throw new HttpError(409, 'RETRY',
        'Your balance changed while the repair was processing. Please try again.');
    }

    const { error: fixErr } = await db.from('player_cars')
      .update(patch)
      .eq('id', playerCarId);

    if (fixErr) {
      await db.from('profiles').update({ money_cents: balance }).eq('id', caller.id);
      throw new HttpError(500, 'INTERNAL', 'The repair failed. You were not charged.');
    }

    return ok(req, {
      costCents: total,
      breakdown,
      moneyCents: Number(updated.money_cents),
      condition: {
        engineHealth: patch.engine_health ?? Number(car.engine_health),
        transmissionHealth: patch.transmission_health ?? Number(car.transmission_health),
        clutchHealth: patch.clutch_health ?? Number(car.clutch_health),
        tireHealth: patch.tire_health ?? Number(car.tire_health),
      },
    });
  } catch (err) {
    return fail(req, err);
  }
});
