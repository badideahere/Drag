// supabase/functions/admin-money/index.ts
//
// Adjusting a player's balance.
//
// The admin panel hides these controls from non-admins. That is cosmetic. The
// check that matters is requirePermission() below, which re-reads the caller's
// role from the database on every request. A PLAYER who calls this endpoint
// directly with a hand-made request gets a 403 and an audit trail of trying.

import { preflight } from '../_shared/cors.ts';
import {
  serviceClient, authenticate, requirePermission, readBody, requireUuid,
  ok, fail, HttpError, audit, throttle,
} from '../_shared/common.ts';

const OPERATIONS = ['ADD', 'REMOVE', 'SET'] as const;
type Operation = typeof OPERATIONS[number];

const ACTION: Record<Operation, 'ADMIN_ADD_MONEY' | 'ADMIN_REMOVE_MONEY' | 'ADMIN_SET_MONEY'> = {
  ADD: 'ADMIN_ADD_MONEY',
  REMOVE: 'ADMIN_REMOVE_MONEY',
  SET: 'ADMIN_SET_MONEY',
};

/** Sanity ceiling. Nobody needs to move more than this in one action. */
const MAX_AMOUNT_CENTS = 10_000_000_000;   // $100,000,000

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const db = serviceClient();
    const body = await readBody(req);
    const caller = await authenticate(req, db);
    requirePermission(caller, 'money');
    throttle(`admin-money:${caller.id}`, 300);

    const playerId = requireUuid(body, 'playerId');
    const operation = String(body.operation || '').toUpperCase() as Operation;
    if (!OPERATIONS.includes(operation)) {
      throw new HttpError(400, 'VALIDATION', 'Operation must be ADD, REMOVE or SET.');
    }

    const amount = Math.round(Number(body.amountCents));
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT_CENTS) {
      throw new HttpError(400, 'VALIDATION', 'That amount is not valid.');
    }

    const reason = body.reason ? String(body.reason).slice(0, 400) : null;

    const { data: target } = await db
      .from('profiles')
      .select('id, username, money_cents, role')
      .eq('id', playerId)
      .maybeSingle();

    if (!target) throw new HttpError(404, 'NOT_FOUND', 'No player with that id.');

    const before = Number(target.money_cents);
    let after: number;
    if (operation === 'ADD') after = before + amount;
    else if (operation === 'REMOVE') after = before - amount;
    else after = amount;

    // The column has a check constraint of >= 0; clamp rather than error so
    // "remove 1,000,000 from someone with 500" does the obvious thing.
    after = Math.max(0, Math.min(after, MAX_AMOUNT_CENTS));

    const { data: updated, error } = await db
      .from('profiles')
      .update({ money_cents: after, updated_at: new Date().toISOString() })
      .eq('id', playerId)
      .select('money_cents')
      .maybeSingle();

    if (error || !updated) {
      throw new HttpError(500, 'INTERNAL', 'The balance could not be changed.');
    }

    await audit(db, {
      adminId: caller.id,
      adminUsername: caller.profile.username,
      targetPlayerId: playerId,
      targetUsername: target.username,
      actionType: ACTION[operation],
      amountCents: amount,
      reason,
      metadata: { before, after, operation },
    });

    return ok(req, {
      moneyCents: Number(updated.money_cents),
      beforeCents: before,
      operation,
      amountCents: amount,
    });
  } catch (err) {
    return fail(req, err);
  }
});
