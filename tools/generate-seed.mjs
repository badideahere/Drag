// tools/generate-seed.mjs
// Generates supabase/migrations/002_seed.sql from js/data/cars.js and
// js/data/upgrades.js, so the prices and specs the SERVER enforces can never
// drift away from the ones the game displays.
//
// Run it from the project root whenever you add or edit a car or an upgrade:
//     node tools/generate-seed.mjs
//
// Then run the regenerated 002_seed.sql in the Supabase SQL editor.

import { writeFileSync, mkdirSync } from 'node:fs';
import { CAR_LIST } from '../js/data/cars.js';
import { UPGRADE_LIST } from '../js/data/upgrades.js';
import { buildVehicleSpec, specSummary } from '../js/sim/build.js';

const q = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

const lines = [];

lines.push(`-- supabase/migrations/002_seed.sql`);
lines.push(`-- GENERATED FILE — do not edit by hand.`);
lines.push(`-- Produced by: node tools/generate-seed.mjs`);
lines.push(`-- Source of truth: js/data/cars.js and js/data/upgrades.js`);
lines.push(``);
lines.push(`-- Vehicles ------------------------------------------------------------`);
lines.push(`insert into public.car_definitions`);
lines.push(`  (id, name, class, price_cents, hp, torque_nm, weight_kg, drivetrain,`);
lines.push(`   engine_name, aspiration, gear_count, tire_compound,`);
lines.push(`   base_ratios, base_final_drive, idle_rpm, redline_rpm, limiter_rpm,`);
lines.push(`   max_safe_rpm, float_rpm, base_front_psi, base_rear_psi, enabled)`);
lines.push(`values`);

const carRows = CAR_LIST.map((car) => {
  const spec = buildVehicleSpec(car.id, {});
  const s = specSummary(spec);
  return '  (' + [
    q(car.id),
    q(car.name),
    q(car.class),
    car.priceCents,
    Math.round(s.peakHp),
    Math.round(s.peakTorqueNm),
    car.massKg,
    q(car.drivetrain),
    q(car.engine.name),
    q(car.engine.aspiration),
    car.gearbox.ratios.length,
    q(car.tires.compound),
    j(car.gearbox.ratios),
    car.gearbox.finalDrive,
    car.engine.idleRpm,
    car.engine.redlineRpm,
    car.engine.limiterRpm,
    car.engine.maxSafeRpm,
    car.engine.floatRpm,
    car.tires.frontPsi ?? car.tires.pressurePsi,
    car.tires.pressurePsi,
    'true',
  ].join(', ') + ')';
});
lines.push(carRows.join(',\n') + ';');

lines.push(``);
lines.push(`-- If a car already exists, refresh its values rather than failing.`);
lines.push(`-- (The insert above uses a plain INSERT so a second run would error;`);
lines.push(`--  run 002_seed_refresh.sql instead when updating an existing project.)`);
lines.push(``);
lines.push(`-- Upgrades ------------------------------------------------------------`);
lines.push(`insert into public.upgrade_definitions`);
lines.push(`  (slot, level, name, category, slot_name, price_cents, enabled)`);
lines.push(`values`);

const upRows = [];
for (const slot of UPGRADE_LIST) {
  for (const lv of slot.levels) {
    upRows.push('  (' + [
      q(slot.id),
      lv.level,
      q(lv.name),
      q(slot.category),
      q(slot.name),
      lv.priceCents,
      'true',
    ].join(', ') + ')');
  }
}
lines.push(upRows.join(',\n') + ';');
lines.push('');

mkdirSync('supabase/migrations', { recursive: true });
writeFileSync('supabase/migrations/002_seed.sql', lines.join('\n'));

// A second file that upserts instead of inserting, for updating a live project.
const upsert = lines
  .join('\n')
  .replace(
    /(insert into public\.car_definitions[\s\S]*?);\n/,
    (m) => m.replace(/;\n$/, `\non conflict (id) do update set
  name = excluded.name,
  class = excluded.class,
  price_cents = excluded.price_cents,
  hp = excluded.hp,
  torque_nm = excluded.torque_nm,
  weight_kg = excluded.weight_kg,
  drivetrain = excluded.drivetrain,
  engine_name = excluded.engine_name,
  aspiration = excluded.aspiration,
  gear_count = excluded.gear_count,
  tire_compound = excluded.tire_compound,
  base_ratios = excluded.base_ratios,
  base_final_drive = excluded.base_final_drive,
  idle_rpm = excluded.idle_rpm,
  redline_rpm = excluded.redline_rpm,
  limiter_rpm = excluded.limiter_rpm,
  max_safe_rpm = excluded.max_safe_rpm,
  float_rpm = excluded.float_rpm,
  base_front_psi = excluded.base_front_psi,
  base_rear_psi = excluded.base_rear_psi,
  enabled = excluded.enabled;\n`))
  .replace(
    /(insert into public\.upgrade_definitions[\s\S]*?);\n?$/,
    (m) => m.replace(/;\n?$/, `\non conflict (slot, level) do update set
  name = excluded.name,
  category = excluded.category,
  slot_name = excluded.slot_name,
  price_cents = excluded.price_cents,
  enabled = excluded.enabled;\n`))
  .replace('-- supabase/migrations/002_seed.sql', '-- supabase/migrations/002_seed_refresh.sql')
  .replace(
    '-- Produced by: node tools/generate-seed.mjs',
    '-- Produced by: node tools/generate-seed.mjs\n-- Safe to re-run on a live project: it updates rows instead of inserting them.');

writeFileSync('supabase/migrations/002_seed_refresh.sql', upsert);

console.log(`Wrote ${CAR_LIST.length} cars and ${upRows.length} upgrade levels.`);
