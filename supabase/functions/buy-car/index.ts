// supabase/functions/buy-car/index.ts
//
// Buying a vehicle.
//
// The request contains ONE thing: which car. Not the price, not the balance,
// not the resulting balance. The server looks the price up, checks the funds,
// takes the money and creates the car. A client that sends
// { carId: 'prowler_ps', price: 0 } gets charged full retail.

import { preflight } from '../_shared/cors.ts';
import {
  serviceClient, authenticate, readBody, requireString, ok, fail, HttpError, throttle,
} from '../_shared/common.ts';
import { defaultTuning } from '../_shared/tuning.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const db = serviceClient();
    const body = await readBody(req);
    const caller = await authenticate(req, db);
    throttle(`buy-car:${caller.id}`, 600);

    const carId = requireString(body, 'carId', 64);

    // ---- the price comes from the database, full stop
    const { data: car, error: carErr } = await db
      .from('car_definitions')
      .select('*')
      .eq('id', carId)
      .eq('enabled', true)
      .maybeSingle();

    if (carErr) throw new HttpError(500, 'INTERNAL', 'Could not read the vehicle list.');
    if (!car) throw new HttpError(404, 'UNKNOWN_CAR', 'That vehicle does not exist.');

    // ---- already owned?
    const { count: ownedCount } = await db
      .from('player_cars')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', caller.id)
      .eq('car_id', carId);

    if ((ownedCount ?? 0) > 0) {
      throw new HttpError(409, 'ALREADY_OWNED', 'You already own that vehicle.');
    }

    // ---- funds, read fresh
    const price = Number(car.price_cents);
    const balance = Number(caller.profile.money_cents);
    if (balance < price) {
      throw new HttpError(402, 'INSUFFICIENT_FUNDS',
        'You cannot afford that vehicle yet.');
    }

    // ---- debit first, and only if the balance is still what we think it is.
    // This conditional update is the concurrency guard: two purchase requests
    // racing each other cannot both succeed against the same balance.
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

    // ---- create the vehicle
    const { data: newCar, error: carInsertErr } = await db
      .from('player_cars')
      .insert({ player_id: caller.id, car_id: carId })
      .select('id')
      .single();

    if (carInsertErr || !newCar) {
      // Refund rather than leave the player short of both money and car.
      await db.from('profiles')
        .update({ money_cents: balance })
        .eq('id', caller.id);
      throw new HttpError(500, 'INTERNAL', 'The vehicle could not be created. You were not charged.');
    }

    await db.from('player_tuning').insert({
      player_car_id: newCar.id,
      tuning: defaultTuning(car as any),
    });

    return ok(req, {
      playerCarId: newCar.id,
      carId,
      pricePaidCents: price,
      moneyCents: Number(updated.money_cents),
    });
  } catch (err) {
    return fail(req, err);
  }
});
