// supabase/functions/save-tuning/index.ts
//
// Saving a tune, and renaming a vehicle.
//
// Tuning is free, so there is no money involved — but the values still have to
// be clamped here, because a saved tune is read back by the game later. A
// client that posts a final drive of 900 and a 40,000 rpm shift point gets a
// stored tune of 6.2 and whatever the car's valve-float limit is.

import { preflight } from '../_shared/cors.ts';
import {
  serviceClient, authenticate, readBody, requireUuid, ok, fail, HttpError, throttle,
} from '../_shared/common.ts';
import { sanitizeTuning } from '../_shared/tuning.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const db = serviceClient();
    const body = await readBody(req);
    const caller = await authenticate(req, db);
    throttle(`save-tuning:${caller.id}`, 300);

    const playerCarId = requireUuid(body, 'playerCarId');

    const { data: car } = await db
      .from('player_cars')
      .select('id, player_id, car_id')
      .eq('id', playerCarId)
      .maybeSingle();

    if (!car || car.player_id !== caller.id) {
      throw new HttpError(403, 'NOT_OWNED', 'You do not own this vehicle.');
    }

    const result: Record<string, unknown> = {};

    // ---- rename
    if (typeof body.nickname === 'string') {
      // Strip control characters and keep it a sensible length.
      const clean = body.nickname
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 28);
      const { error } = await db.from('player_cars')
        .update({ nickname: clean || null })
        .eq('id', playerCarId);
      if (error) throw new HttpError(500, 'INTERNAL', 'The name could not be saved.');
      result.nickname = clean || null;
    }

    // ---- tune
    if (body.tuning && typeof body.tuning === 'object') {
      const { data: base } = await db
        .from('car_definitions')
        .select('base_ratios, base_final_drive, base_front_psi, base_rear_psi, idle_rpm, redline_rpm, limiter_rpm, float_rpm')
        .eq('id', car.car_id)
        .maybeSingle();

      if (!base) throw new HttpError(404, 'UNKNOWN_CAR', 'That vehicle does not exist.');

      const clean = sanitizeTuning(base as any, body.tuning);

      const { error } = await db.from('player_tuning')
        .upsert({
          player_car_id: playerCarId,
          tuning: clean,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'player_car_id' });

      if (error) throw new HttpError(500, 'INTERNAL', 'The tune could not be saved.');
      // Return what was ACTUALLY stored, so the UI shows the clamped values.
      result.tuning = clean;
    }

    if (!Object.keys(result).length) {
      throw new HttpError(400, 'VALIDATION', 'Nothing to save.');
    }

    return ok(req, result);
  } catch (err) {
    return fail(req, err);
  }
});
