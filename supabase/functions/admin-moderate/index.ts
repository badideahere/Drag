// supabase/functions/admin-moderate/index.ts
//
// Suspensions and role changes.
//
// Two rules beyond the usual permission check:
//   1. You cannot moderate someone of equal or higher rank than yourself, so a
//      MODERATOR cannot ban an ADMIN and an ADMIN cannot demote the OWNER.
//   2. Only an OWNER can change roles at all, and nobody can change their own.
//      That last one exists so an OWNER cannot accidentally lock themselves out
//      of the project they own.

import { preflight } from '../_shared/cors.ts';
import {
  serviceClient, authenticate, requirePermission, readBody, requireUuid,
  ok, fail, HttpError, audit, hasRank, throttle, Role,
} from '../_shared/common.ts';

const ROLES: Role[] = ['PLAYER', 'MODERATOR', 'ADMIN', 'OWNER'];
const RANK: Record<Role, number> = { PLAYER: 0, MODERATOR: 1, ADMIN: 2, OWNER: 3 };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const db = serviceClient();
    const body = await readBody(req);
    const caller = await authenticate(req, db);
    requirePermission(caller, 'moderate');
    throttle(`admin-moderate:${caller.id}`, 300);

    const playerId = requireUuid(body, 'playerId');
    const operation = String(body.operation || '').toUpperCase();
    const reason = body.reason ? String(body.reason).slice(0, 400) : null;

    const { data: target } = await db
      .from('profiles')
      .select('id, username, role, banned')
      .eq('id', playerId)
      .maybeSingle();

    if (!target) throw new HttpError(404, 'NOT_FOUND', 'No player with that id.');

    const callerRank = RANK[caller.profile.role];
    const targetRank = RANK[target.role as Role] ?? 0;

    // Rule 1: no acting on your equals or your betters.
    if (targetRank >= callerRank && target.id !== caller.id) {
      throw new HttpError(403, 'PERMISSION_DENIED',
        `You cannot moderate an account with the ${target.role} role.`);
    }

    const logBase = {
      adminId: caller.id,
      adminUsername: caller.profile.username,
      targetPlayerId: playerId,
      targetUsername: target.username,
      reason,
    };

    if (operation === 'BAN' || operation === 'UNBAN') {
      const banned = operation === 'BAN';
      if (target.id === caller.id) {
        throw new HttpError(400, 'VALIDATION', 'You cannot suspend your own account.');
      }
      const { error } = await db.from('profiles')
        .update({ banned, ban_reason: banned ? reason : null, updated_at: new Date().toISOString() })
        .eq('id', playerId);
      if (error) throw new HttpError(500, 'INTERNAL', 'The account could not be updated.');

      await audit(db, {
        ...logBase,
        actionType: banned ? 'ADMIN_BAN' : 'ADMIN_UNBAN',
        metadata: { previouslyBanned: target.banned },
      });

      return ok(req, { banned });
    }

    if (operation === 'SET_ROLE') {
      requirePermission(caller, 'roles');     // OWNER only
      const role = String(body.role || '').toUpperCase() as Role;
      if (!ROLES.includes(role)) {
        throw new HttpError(400, 'VALIDATION', 'Unknown role.');
      }
      if (target.id === caller.id) {
        throw new HttpError(400, 'VALIDATION',
          'You cannot change your own role. Ask another OWNER, or use the SQL editor.');
      }
      // Granting OWNER is allowed (an OWNER may want a second one), but
      // granting a rank above your own is not — which for an OWNER is nothing.
      if (RANK[role] > callerRank) {
        throw new HttpError(403, 'PERMISSION_DENIED',
          'You cannot grant a role higher than your own.');
      }

      const { error } = await db.from('profiles')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('id', playerId);
      if (error) throw new HttpError(500, 'INTERNAL', 'The role could not be changed.');

      await audit(db, {
        ...logBase,
        actionType: 'ADMIN_SET_ROLE',
        metadata: { from: target.role, to: role },
      });

      return ok(req, { role });
    }

    throw new HttpError(400, 'VALIDATION', 'Unknown moderation operation.');
  } catch (err) {
    return fail(req, err);
  }
});
