// supabase/functions/admin-vehicle/index.ts
//
// Giving, repairing, resetting and removing a player's vehicles.
//
// Every operation writes an audit row before it returns, including the vehicle
// and the reason, so there is always a record of who altered someone's garage.

import { preflight } from '../_shared/cors.ts';
import {
  serviceClient, authenticate, requirePermission, readBody, requireUuid, requireString,
  ok, fail, HttpError, audit, throttle,
} from '../_shared/common.ts';
import { defaultTuning } from '../_shared/tuning.ts';

const OPERATIONS = ['GIVE_CAR', 'REMOVE_CAR', 'REPAIR_CAR', 'RESET_CAR'] as const;
type Operation = typeof OPERATIONS[number];

const ACTION: Record<Operation, 'ADMIN_GIVE_CAR' | 'ADMIN_REMOVE_CAR' | 'ADMIN_REPAIR_CAR' | 'ADMIN_RESET_CAR'> = {
  GIVE_CAR: 'ADMIN_GIVE_CAR',
  REMOVE_CAR: 'ADMIN_REMOVE_CAR',
  REPAIR_CAR: 'ADMIN_REPAIR_CAR',
  RESET_CAR: 'ADMIN_RESET_CAR',
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const db = serviceClient();
    const body = await readBody(req);
    const caller = await authenticate(req, db);
    requirePermission(caller, 'vehicles');
    throttle(`admin-vehicle:${caller.id}`, 300);

    const playerId = requireUuid(body, 'playerId');
    const operation = String(body.operation || '').toUpperCase() as Operation;
    if (!OPERATIONS.includes(operation)) {
      throw new HttpError(400, 'VALIDATION', 'Unknown vehicle operation.');
    }
    const reason = body.reason ? String(body.reason).slice(0, 400) : null;

    const { data: target } = await db
      .from('profiles')
      .select('id, username')
      .eq('id', playerId)
      .maybeSingle();
    if (!target) throw new HttpError(404, 'NOT_FOUND', 'No player with that id.');

    const logBase = {
      adminId: caller.id,
      adminUsername: caller.profile.username,
      targetPlayerId: playerId,
      targetUsername: target.username,
      reason,
    };

    /* ------------------------------------------------------------ GIVE */
    if (operation === 'GIVE_CAR') {
      const carId = requireString(body, 'carId', 64);
      const { data: def } = await db
        .from('car_definitions')
        .select('*')
        .eq('id', carId)
        .maybeSingle();
      if (!def) throw new HttpError(404, 'UNKNOWN_CAR', 'That vehicle does not exist.');

      const { data: created, error } = await db
        .from('player_cars')
        .insert({ player_id: playerId, car_id: carId })
        .select('id')
        .single();
      if (error || !created) {
        throw new HttpError(500, 'INTERNAL', 'The vehicle could not be created.');
      }

      await db.from('player_tuning').insert({
        player_car_id: created.id,
        tuning: defaultTuning(def as any),
      });

      await audit(db, {
        ...logBase,
        actionType: ACTION.GIVE_CAR,
        carId,
        playerCarId: created.id,
        metadata: { carName: def.name, valueCents: Number(def.price_cents) },
      });

      return ok(req, { playerCarId: created.id, carId });
    }

    /* ------------------------------ the rest operate on an existing car */
    const playerCarId = requireUuid(body, 'playerCarId');
    const { data: car } = await db
      .from('player_cars')
      .select('*')
      .eq('id', playerCarId)
      .maybeSingle();

    if (!car) throw new HttpError(404, 'NOT_FOUND', 'No such vehicle.');
    if (car.player_id !== playerId) {
      throw new HttpError(400, 'VALIDATION', 'That vehicle does not belong to that player.');
    }

    if (operation === 'REPAIR_CAR') {
      await db.from('player_cars').update({
        engine_health: 100,
        transmission_health: 100,
        clutch_health: 100,
        tire_health: 100,
      }).eq('id', playerCarId);

      await audit(db, {
        ...logBase,
        actionType: ACTION.REPAIR_CAR,
        carId: car.car_id,
        playerCarId,
        metadata: {
          before: {
            engine: Number(car.engine_health),
            transmission: Number(car.transmission_health),
            clutch: Number(car.clutch_health),
            tires: Number(car.tire_health),
          },
        },
      });
      return ok(req, { repaired: true });
    }

    if (operation === 'RESET_CAR') {
      const { data: def } = await db
        .from('car_definitions')
        .select('*')
        .eq('id', car.car_id)
        .maybeSingle();

      const { data: hadUpgrades } = await db
        .from('player_upgrades')
        .select('slot, level')
        .eq('player_car_id', playerCarId);

      await db.from('player_upgrades').delete().eq('player_car_id', playerCarId);

      if (def) {
        await db.from('player_tuning').upsert({
          player_car_id: playerCarId,
          tuning: defaultTuning(def as any),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'player_car_id' });
      }

      await db.from('player_cars').update({
        engine_health: 100,
        transmission_health: 100,
        clutch_health: 100,
        tire_health: 100,
      }).eq('id', playerCarId);

      await audit(db, {
        ...logBase,
        actionType: ACTION.RESET_CAR,
        carId: car.car_id,
        playerCarId,
        metadata: { removedUpgrades: hadUpgrades || [] },
      });
      return ok(req, { reset: true });
    }

    if (operation === 'REMOVE_CAR') {
      // Cascades take the upgrades and the tune with it.
      const { error } = await db.from('player_cars').delete().eq('id', playerCarId);
      if (error) throw new HttpError(500, 'INTERNAL', 'The vehicle could not be removed.');

      await audit(db, {
        ...logBase,
        actionType: ACTION.REMOVE_CAR,
        carId: car.car_id,
        playerCarId,
        metadata: { nickname: car.nickname, wasStarter: car.is_starter },
      });
      return ok(req, { removed: true });
    }

    throw new HttpError(400, 'VALIDATION', 'Unknown vehicle operation.');
  } catch (err) {
    return fail(req, err);
  }
});
