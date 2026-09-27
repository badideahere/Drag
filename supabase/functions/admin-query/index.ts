// supabase/functions/admin-query/index.ts
//
// Every read the admin panel performs.
//
// It lives behind an Edge Function rather than being read directly from the
// browser for two reasons: RLS deliberately blocks clients from reading other
// players' rows and the audit log at all, and player search has to run as a
// query IN the database with a LIMIT rather than by downloading every account
// and filtering in JavaScript.

import { preflight } from '../_shared/cors.ts';
import {
  serviceClient, authenticate, requirePermission, readBody, requireUuid,
  ok, fail, HttpError, throttle,
} from '../_shared/common.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const db = serviceClient();
    const body = await readBody(req);
    const caller = await authenticate(req, db);
    throttle(`admin-query:${caller.id}`, 120);

    const action = String(body.action || '');
    const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 200);
    const offset = Math.max(Number(body.offset) || 0, 0);

    /* ------------------------------------------------------- dashboard */
    if (action === 'dashboard') {
      requirePermission(caller, 'viewPlayers');
      const { data, error } = await db.rpc('admin_dashboard');
      if (error) throw new HttpError(500, 'INTERNAL', 'Could not load the dashboard.');
      return ok(req, { data });
    }

    /* ---------------------------------------------------------- search */
    if (action === 'search') {
      requirePermission(caller, 'viewPlayers');
      const q = String(body.query || '').trim().slice(0, 80);
      if (q.length < 2) return ok(req, { data: [] });

      const { data, error } = await db.rpc('admin_search_players', {
        q, lim: limit, off: offset,
      });
      if (error) throw new HttpError(500, 'INTERNAL', 'The search failed.');
      return ok(req, { data: data || [] });
    }

    /* ----------------------------------------------------- one player */
    if (action === 'player') {
      requirePermission(caller, 'viewPlayers');
      const playerId = requireUuid(body, 'playerId');

      const [profileRes, statsRes, carsRes, racesRes] = await Promise.all([
        db.from('profiles')
          .select('id, username, email, role, banned, ban_reason, money_cents, created_at, last_seen')
          .eq('id', playerId).maybeSingle(),
        db.from('player_statistics').select('*').eq('player_id', playerId).maybeSingle(),
        db.from('player_cars')
          .select('*, player_upgrades(slot, level), player_tuning(tuning)')
          .eq('player_id', playerId)
          .order('acquired_at', { ascending: true }),
        db.from('race_results').select('*')
          .eq('player_id', playerId)
          .order('created_at', { ascending: false })
          .limit(25),
      ]);

      if (!profileRes.data) throw new HttpError(404, 'NOT_FOUND', 'No player with that id.');

      return ok(req, {
        data: {
          profile: profileRes.data,
          statistics: statsRes.data,
          cars: carsRes.data || [],
          races: racesRes.data || [],
        },
      });
    }

    /* ----------------------------------------------------------- races */
    if (action === 'races') {
      requirePermission(caller, 'viewRaces');
      let query = db.from('race_results').select('*').order('created_at', { ascending: false });
      if (body.playerId) query = query.eq('player_id', requireUuid(body, 'playerId'));
      const { data, error } = await query.limit(limit);
      if (error) throw new HttpError(500, 'INTERNAL', 'Could not load race results.');

      // Attach driver names without a join, in one extra query.
      const ids = [...new Set((data || []).map((r: any) => r.player_id))];
      const names: Record<string, string> = {};
      if (ids.length) {
        const { data: profiles } = await db
          .from('profiles').select('id, username').in('id', ids);
        for (const p of profiles || []) names[p.id] = p.username;
      }
      return ok(req, {
        data: (data || []).map((r: any) => ({ ...r, username: names[r.player_id] || null })),
      });
    }

    /* ------------------------------------------------------- audit log */
    if (action === 'audit') {
      requirePermission(caller, 'viewAudit');
      let query = db.from('admin_actions').select('*').order('created_at', { ascending: false });
      if (body.adminId) query = query.eq('admin_id', requireUuid(body, 'adminId'));
      if (body.targetId) query = query.eq('target_player_id', requireUuid(body, 'targetId'));
      const { data, error } = await query.range(offset, offset + limit - 1);
      if (error) throw new HttpError(500, 'INTERNAL', 'Could not load the audit log.');
      return ok(req, { data: data || [] });
    }

    throw new HttpError(400, 'VALIDATION', 'Unknown query action.');
  } catch (err) {
    return fail(req, err);
  }
});
