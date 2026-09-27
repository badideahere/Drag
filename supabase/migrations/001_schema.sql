-- =========================================================================
-- STAGED — database schema
-- Run this FIRST in the Supabase SQL editor, then run 002_seed.sql.
-- =========================================================================
--
-- SECURITY MODEL, in one paragraph:
--
--   The browser can READ its own data and the public leaderboards. It cannot
--   WRITE anything at all. There is no INSERT, UPDATE or DELETE policy for
--   normal users on any table in this file. Every write — buying a car,
--   fitting an upgrade, saving a tune, repairing, recording a race, changing
--   money — happens inside an Edge Function that uses the service_role key,
--   re-reads the real price or reward from the database, and then writes.
--
--   That means editing the JavaScript in your browser cannot give you money,
--   cars, upgrades or leaderboard times. The worst a tampered client can do is
--   send a request that the server then refuses.
--
-- Money is stored as BIGINT cents. Never floats: 0.1 + 0.2 is not 0.3, and a
-- currency column that drifts is a currency column that gets exploited.

-- ---------------------------------------------------------------- extensions
create extension if not exists "pgcrypto";

-- ===========================================================================
-- REFERENCE DATA (seeded from the game files by tools/generate-seed.mjs)
-- ===========================================================================

create table if not exists public.car_definitions (
  id                text primary key,
  name              text not null,
  class             text not null,
  price_cents       bigint not null check (price_cents >= 0),
  hp                integer not null,
  torque_nm         integer not null,
  weight_kg         integer not null,
  drivetrain        text not null check (drivetrain in ('FWD', 'RWD', 'AWD')),
  engine_name       text not null,
  aspiration        text not null check (aspiration in ('na', 'turbo', 'supercharged')),
  gear_count        integer not null check (gear_count between 1 and 10),
  tire_compound     text not null,

  -- These let the server re-run the same tuning validation the client does,
  -- without the server having to duplicate the whole car file.
  base_ratios       jsonb not null,
  base_final_drive  numeric(6,3) not null,
  idle_rpm          integer not null,
  redline_rpm       integer not null,
  limiter_rpm       integer not null,
  max_safe_rpm      integer not null,
  float_rpm         integer not null,
  base_front_psi    numeric(5,2) not null,
  base_rear_psi     numeric(5,2) not null,

  enabled           boolean not null default true,
  created_at        timestamptz not null default now()
);

create table if not exists public.upgrade_definitions (
  slot          text not null,
  level         integer not null check (level >= 1),
  name          text not null,
  category      text not null,
  slot_name     text not null,
  price_cents   bigint not null check (price_cents >= 0),
  enabled       boolean not null default true,
  primary key (slot, level)
);

-- ===========================================================================
-- PLAYERS
-- ===========================================================================

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null,
  email         text,                       -- mirrored from auth.users for admin search
  role          text not null default 'PLAYER'
                  check (role in ('PLAYER', 'MODERATOR', 'ADMIN', 'OWNER')),
  banned        boolean not null default false,
  ban_reason    text,
  money_cents   bigint not null default 750000 check (money_cents >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_seen     timestamptz not null default now()
);

create index if not exists profiles_username_idx on public.profiles (lower(username));
create index if not exists profiles_email_idx    on public.profiles (lower(email));
create index if not exists profiles_role_idx     on public.profiles (role) where role <> 'PLAYER';
create index if not exists profiles_last_seen_idx on public.profiles (last_seen desc);

create table if not exists public.player_cars (
  id                    uuid primary key default gen_random_uuid(),
  player_id             uuid not null references public.profiles(id) on delete cascade,
  car_id                text not null references public.car_definitions(id),
  nickname              text,

  engine_health         numeric(5,2) not null default 100 check (engine_health between 0 and 100),
  transmission_health   numeric(5,2) not null default 100 check (transmission_health between 0 and 100),
  clutch_health         numeric(5,2) not null default 100 check (clutch_health between 0 and 100),
  tire_health           numeric(5,2) not null default 100 check (tire_health between 0 and 100),

  odometer_m            bigint not null default 0,
  best_et_quarter       numeric(7,3),
  best_mph_quarter      numeric(7,3),
  best_et_eighth        numeric(7,3),
  best_mph_eighth       numeric(7,3),

  is_starter            boolean not null default false,
  acquired_at           timestamptz not null default now()
);

create index if not exists player_cars_player_idx on public.player_cars (player_id, acquired_at);

create table if not exists public.player_upgrades (
  id              uuid primary key default gen_random_uuid(),
  player_car_id   uuid not null references public.player_cars(id) on delete cascade,
  slot            text not null,
  level           integer not null check (level >= 1),
  purchased_at    timestamptz not null default now(),
  unique (player_car_id, slot)
);

create index if not exists player_upgrades_car_idx on public.player_upgrades (player_car_id);

create table if not exists public.player_tuning (
  player_car_id   uuid primary key references public.player_cars(id) on delete cascade,
  tuning          jsonb not null,
  updated_at      timestamptz not null default now()
);

-- ===========================================================================
-- RESULTS AND STATISTICS
-- ===========================================================================

create table if not exists public.race_results (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.profiles(id) on delete cascade,
  player_car_id   uuid references public.player_cars(id) on delete set null,
  car_id          text not null references public.car_definitions(id),

  mode            text not null,
  distance_ft     integer not null check (distance_ft between 100 and 6000),
  driving_mode    text,
  difficulty      text,

  reaction        numeric(7,3),
  foul            boolean not null default false,
  sixty           numeric(7,3),
  three_thirty    numeric(7,3),
  eighth_et       numeric(7,3),
  eighth_mph      numeric(7,3),
  thousand_et     numeric(7,3),
  quarter_et      numeric(7,3),
  quarter_mph     numeric(7,3),
  et              numeric(7,3),
  trap_mph        numeric(7,3),

  result          text check (result in ('win', 'loss', 'none')),
  opponent_name   text,
  opponent_car_id text,
  opponent_et     numeric(7,3),

  payout_cents    bigint not null default 0,
  valid           boolean not null default true,
  reject_reason   text,
  created_at      timestamptz not null default now()
);

create index if not exists race_results_player_idx on public.race_results (player_id, created_at desc);
create index if not exists race_results_created_idx on public.race_results (created_at desc);
create index if not exists race_results_invalid_idx on public.race_results (created_at desc) where valid = false;

create table if not exists public.player_statistics (
  player_id               uuid primary key references public.profiles(id) on delete cascade,
  races                   integer not null default 0,
  wins                    integer not null default 0,
  losses                  integer not null default 0,
  red_lights              integer not null default 0,
  perfect_lights          integer not null default 0,
  total_earnings_cents    bigint  not null default 0,
  total_distance_m        bigint  not null default 0,
  best_et_quarter         numeric(7,3),
  best_mph_quarter        numeric(7,3),
  best_et_eighth          numeric(7,3),
  best_mph_eighth         numeric(7,3),
  best_reaction           numeric(7,3),
  updated_at              timestamptz not null default now()
);

create table if not exists public.leaderboard_entries (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.profiles(id) on delete cascade,
  username        text not null,            -- snapshot, so the board still reads if a name changes
  car_id          text not null references public.car_definitions(id),
  car_name        text not null,
  car_class       text,
  category        text not null check (category in
                    ('quarter_et', 'quarter_mph', 'eighth_et', 'eighth_mph')),
  value           numeric(7,3) not null,
  driving_mode    text,
  race_result_id  uuid references public.race_results(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (player_id, car_id, category, driving_mode)
);

create index if not exists leaderboard_cat_value_idx
  on public.leaderboard_entries (category, value);
create index if not exists leaderboard_car_idx
  on public.leaderboard_entries (category, car_id, value);

-- ===========================================================================
-- ADMIN AUDIT LOG
-- ===========================================================================

create table if not exists public.admin_actions (
  id                uuid primary key default gen_random_uuid(),
  admin_id          uuid not null references public.profiles(id) on delete set null,
  admin_username    text,
  target_player_id  uuid references public.profiles(id) on delete set null,
  target_username   text,
  action_type       text not null check (action_type in (
                      'ADMIN_ADD_MONEY', 'ADMIN_REMOVE_MONEY', 'ADMIN_SET_MONEY',
                      'ADMIN_GIVE_CAR', 'ADMIN_REMOVE_CAR', 'ADMIN_REPAIR_CAR',
                      'ADMIN_RESET_CAR', 'ADMIN_BAN', 'ADMIN_UNBAN',
                      'ADMIN_SET_ROLE')),
  amount_cents      bigint,
  car_id            text,
  player_car_id     uuid,
  reason            text,
  metadata          jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);
create index if not exists admin_actions_target_idx  on public.admin_actions (target_player_id, created_at desc);
create index if not exists admin_actions_admin_idx   on public.admin_actions (admin_id, created_at desc);

-- ===========================================================================
-- NEW ACCOUNT SETUP
-- Creating an auth user automatically creates the profile, the statistics row
-- and the starter car. Doing it here rather than in the browser means a player
-- cannot skip it, repeat it, or hand themselves a different starter car.
-- ===========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  starter_id   text := 'corso_hatch';    -- keep in sync with CONFIG.STARTER_CAR_ID
  start_money  bigint := 750000;         -- keep in sync with CONFIG.STARTING_MONEY
  new_car_id   uuid;
  base         public.car_definitions%rowtype;
  chosen_name  text;
begin
  chosen_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    split_part(coalesce(new.email, 'driver'), '@', 1));

  insert into public.profiles (id, username, email, money_cents)
  values (new.id, left(chosen_name, 24), new.email, start_money);

  insert into public.player_statistics (player_id) values (new.id);

  select * into base from public.car_definitions where id = starter_id;
  if found then
    insert into public.player_cars (player_id, car_id, is_starter)
    values (new.id, starter_id, true)
    returning id into new_car_id;

    -- Give the starter car the same default tune the game would build.
    insert into public.player_tuning (player_car_id, tuning)
    values (new_car_id, jsonb_build_object(
      'finalDrive',        base.base_final_drive,
      'gearRatios',        base.base_ratios,
      'frontPsi',          base.base_front_psi,
      'rearPsi',           base.base_rear_psi,
      'launchRpm',         greatest(base.idle_rpm, round(base.redline_rpm * 0.42)),
      'shiftRpm',          round(base.redline_rpm * 0.96),
      'boostTargetKpa',    0,
      'throttleMap',       'linear',
      'clutchEngageSpeed', 1.6
    ));
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the mirrored email in step if the player changes it.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email, updated_at = now() where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ===========================================================================
-- DEFENCE IN DEPTH
-- Even if somebody later adds an UPDATE policy to profiles by mistake, these
-- columns still cannot be changed by anything except the service role.
-- ===========================================================================

create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return new;
  end if;
  if new.money_cents is distinct from old.money_cents
     or new.role   is distinct from old.role
     or new.banned is distinct from old.banned
     or new.id     is distinct from old.id then
    raise exception 'money, role and ban status can only be changed by the server';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_columns_trg on public.profiles;
create trigger guard_profile_columns_trg
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

-- ===========================================================================
-- ROW LEVEL SECURITY
-- ===========================================================================

alter table public.profiles            enable row level security;
alter table public.player_cars         enable row level security;
alter table public.player_upgrades     enable row level security;
alter table public.player_tuning       enable row level security;
alter table public.race_results        enable row level security;
alter table public.player_statistics   enable row level security;
alter table public.leaderboard_entries enable row level security;
alter table public.admin_actions       enable row level security;
alter table public.car_definitions     enable row level security;
alter table public.upgrade_definitions enable row level security;

-- Reference data is public: the dealership needs it before you log in.
drop policy if exists car_defs_read on public.car_definitions;
create policy car_defs_read on public.car_definitions
  for select using (true);

drop policy if exists upgrade_defs_read on public.upgrade_definitions;
create policy upgrade_defs_read on public.upgrade_definitions
  for select using (true);

-- A player reads their own profile and nobody else's.
drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles
  for select using (auth.uid() = id);

-- Own garage, own upgrades, own tunes, own results, own statistics.
drop policy if exists cars_read_own on public.player_cars;
create policy cars_read_own on public.player_cars
  for select using (auth.uid() = player_id);

drop policy if exists upgrades_read_own on public.player_upgrades;
create policy upgrades_read_own on public.player_upgrades
  for select using (exists (
    select 1 from public.player_cars c
    where c.id = player_car_id and c.player_id = auth.uid()));

drop policy if exists tuning_read_own on public.player_tuning;
create policy tuning_read_own on public.player_tuning
  for select using (exists (
    select 1 from public.player_cars c
    where c.id = player_car_id and c.player_id = auth.uid()));

drop policy if exists results_read_own on public.race_results;
create policy results_read_own on public.race_results
  for select using (auth.uid() = player_id);

drop policy if exists stats_read_own on public.player_statistics;
create policy stats_read_own on public.player_statistics
  for select using (auth.uid() = player_id);

-- Leaderboards are meant to be seen by everyone who is signed in.
drop policy if exists leaderboard_read on public.leaderboard_entries;
create policy leaderboard_read on public.leaderboard_entries
  for select to authenticated using (true);

-- admin_actions deliberately has RLS on and NO policies at all. That denies
-- every client, including admins — the admin panel reads the log through the
-- admin-query Edge Function, which checks the caller's role first. An audit log
-- a client can reach is an audit log a client can eventually tamper with.

-- NOTE the absence of any INSERT / UPDATE / DELETE policy above. That is the
-- point. All writes go through Edge Functions using the service_role key,
-- which bypasses RLS entirely and does its own checking.

-- ===========================================================================
-- HELPER VIEWS AND FUNCTIONS USED BY THE EDGE FUNCTIONS
-- (they run as service_role, so RLS does not apply to them)
-- ===========================================================================

-- Player search for the admin panel. Runs IN THE DATABASE with a LIMIT, so the
-- admin panel never downloads the whole user table to filter it in the browser.
create or replace function public.admin_search_players(
  q text, lim integer default 25, off integer default 0)
returns table (
  id uuid, username text, email text, role text, banned boolean,
  money_cents bigint, created_at timestamptz, last_seen timestamptz,
  car_count bigint)
language sql
security definer
set search_path = public
as $$
  select p.id, p.username, p.email, p.role, p.banned, p.money_cents,
         p.created_at, p.last_seen,
         (select count(*) from public.player_cars c where c.player_id = p.id)
  from public.profiles p
  where q is null or q = ''
     or p.username ilike '%' || q || '%'
     or p.email    ilike '%' || q || '%'
     or p.id::text = q
  order by p.last_seen desc
  limit least(coalesce(lim, 25), 100) offset coalesce(off, 0);
$$;

revoke all on function public.admin_search_players(text, integer, integer) from public, anon, authenticated;

-- Aggregate numbers for the admin dashboard, computed server-side.
create or replace function public.admin_dashboard()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'totalPlayers',      (select count(*) from public.profiles),
    'activePlayers',     (select count(*) from public.profiles where last_seen > now() - interval '7 days'),
    'bannedPlayers',     (select count(*) from public.profiles where banned),
    'totalRaces',        (select count(*) from public.race_results),
    'totalCars',         (select count(*) from public.player_cars),
    'totalMoneyCents',   (select coalesce(sum(money_cents), 0) from public.profiles),
    'averageMoneyCents', (select coalesce(round(avg(money_cents)), 0) from public.profiles),
    'payoutsLast7dCents',(select coalesce(sum(payout_cents), 0) from public.race_results
                            where created_at > now() - interval '7 days'),
    'adminIssuedCents',  (select coalesce(sum(amount_cents), 0) from public.admin_actions
                            where action_type = 'ADMIN_ADD_MONEY'),
    'topBalances',       (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
                            select p.id, p.username, p.money_cents,
                                   coalesce(s.races, 0) as races
                            from public.profiles p
                            left join public.player_statistics s on s.player_id = p.id
                            order by p.money_cents desc limit 10) t),
    'recentActions',     (select coalesce(jsonb_agg(a), '[]'::jsonb) from (
                            select * from public.admin_actions
                            order by created_at desc limit 10) a)
  );
$$;

revoke all on function public.admin_dashboard() from public, anon, authenticated;
