-- supabase/migrations/002_seed_refresh.sql
-- GENERATED FILE — do not edit by hand.
-- Produced by: node tools/generate-seed.mjs
-- Safe to re-run on a live project: it updates rows instead of inserting them.
-- Source of truth: js/data/cars.js and js/data/upgrades.js

-- Vehicles ------------------------------------------------------------
insert into public.car_definitions
  (id, name, class, price_cents, hp, torque_nm, weight_kg, drivetrain,
   engine_name, aspiration, gear_count, tire_compound,
   base_ratios, base_final_drive, idle_rpm, redline_rpm, limiter_rpm,
   max_safe_rpm, float_rpm, base_front_psi, base_rear_psi, enabled)
values
  ('corso_hatch', 'Corso 1.8 Sport', 'D', 450000, 143, 181, 1120, 'FWD', '1.8L Inline-4', 'na', 5, 'street', '[3.42,1.95,1.32,1.03,0.82]'::jsonb, 4.07, 820, 6800, 6750, 7100, 7600, 32, 32, true),
  ('vector_350', 'Vector 350 GT', 'C', 2850000, 339, 392, 1615, 'RWD', '5.0L V8', 'na', 6, 'street', '[3.66,2.43,1.69,1.32,1,0.65]'::jsonb, 3.31, 720, 7000, 6950, 7350, 7900, 34, 32, true),
  ('kestrel_gtx', 'Kestrel GT-X', 'C', 3400000, 305, 391, 1520, 'AWD', '2.5L Turbo Flat-4', 'turbo', 6, 'street', '[3.45,2.06,1.44,1.08,0.82,0.66]'::jsonb, 4.11, 780, 6800, 6750, 7050, 7450, 33, 33, true),
  ('ronin_rs', 'Ronin RS-2', 'B', 6200000, 427, 498, 1285, 'RWD', '2.0L Turbo Inline-4', 'turbo', 6, 'sport', '[3.63,2.19,1.54,1.21,1,0.79]'::jsonb, 3.9, 850, 7600, 7550, 7900, 8400, 32, 30, true),
  ('brute_454', 'Brute 454 SS', 'B', 7800000, 483, 682, 1780, 'RWD', '7.4L Big-Block V8', 'na', 4, 'street', '[2.52,1.88,1.46,1]'::jsonb, 3.73, 720, 6000, 5950, 6300, 6700, 34, 30, true),
  ('apex_v10', 'Apex 610 V10', 'A', 21500000, 612, 561, 1465, 'RWD', '5.2L V10', 'na', 7, 'sport', '[3.13,2.14,1.62,1.29,1.03,0.84,0.69]'::jsonb, 3.62, 900, 8800, 8750, 9100, 9600, 32, 30, true),
  ('vandal_sc', 'Vandal SC-720', 'A', 17800000, 790, 995, 1905, 'RWD', '6.2L Supercharged V8', 'supercharged', 6, 'sport', '[2.97,2.07,1.43,1,0.71,0.57]'::jsonb, 3.73, 700, 6600, 6550, 6900, 7300, 32, 29, true),
  ('prowler_ps', 'Prowler Pro-Street', 'S', 48000000, 1254, 1331, 1310, 'RWD', '6.0L Twin-Turbo V8', 'turbo', 4, 'drag_radial', '[2.6,1.75,1.32,1]'::jsonb, 4.86, 950, 7800, 7700, 8100, 8600, 42, 17, true)
on conflict (id) do update set
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
  enabled = excluded.enabled;

-- If a car already exists, refresh its values rather than failing.
-- (The insert above uses a plain INSERT so a second run would error;
--  run 002_seed_refresh.sql instead when updating an existing project.)

-- Upgrades ------------------------------------------------------------
insert into public.upgrade_definitions
  (slot, level, name, category, slot_name, price_cents, enabled)
values
  ('intake', 1, 'Panel Filter', 'Engine', 'Intake', 12000, true),
  ('intake', 2, 'Cold Air Intake', 'Engine', 'Intake', 48000, true),
  ('intake', 3, 'Velocity Stack Manifold', 'Engine', 'Intake', 185000, true),
  ('exhaust', 1, 'Cat-Back System', 'Engine', 'Exhaust', 42000, true),
  ('exhaust', 2, 'Long-Tube Headers', 'Engine', 'Exhaust', 165000, true),
  ('exhaust', 3, 'Full Race Exhaust', 'Engine', 'Exhaust', 420000, true),
  ('camshaft', 1, 'Mild Street Cam', 'Engine', 'Camshaft', 135000, true),
  ('camshaft', 2, 'Stage 2 Cam', 'Engine', 'Camshaft', 340000, true),
  ('camshaft', 3, 'Solid Roller Race Cam', 'Engine', 'Camshaft', 780000, true),
  ('heads', 1, 'Ported Heads', 'Engine', 'Cylinder Heads', 280000, true),
  ('heads', 2, 'CNC Race Heads', 'Engine', 'Cylinder Heads', 690000, true),
  ('block', 1, 'Forged Rods & Pistons', 'Engine', 'Engine Build', 520000, true),
  ('block', 2, 'Billet Race Short Block', 'Engine', 'Engine Build', 1450000, true),
  ('turbo', 1, 'Small Journal-Bearing Turbo', 'Engine', 'Turbocharger', 480000, true),
  ('turbo', 2, 'Ball-Bearing Street Turbo', 'Engine', 'Turbocharger', 1150000, true),
  ('turbo', 3, 'Large Frame Race Turbo', 'Engine', 'Turbocharger', 2600000, true),
  ('supercharger', 1, 'Roots Blower', 'Engine', 'Supercharger', 720000, true),
  ('supercharger', 2, 'Twin-Screw Blower', 'Engine', 'Supercharger', 1680000, true),
  ('intercooler', 1, 'Upgraded Front-Mount', 'Engine', 'Intercooler', 165000, true),
  ('intercooler', 2, 'Race Bar-and-Plate', 'Engine', 'Intercooler', 390000, true),
  ('intercooler', 3, 'Air-to-Water Intercooler', 'Engine', 'Intercooler', 860000, true),
  ('cooling', 1, 'Aluminium Radiator', 'Engine', 'Cooling System', 95000, true),
  ('cooling', 2, 'Race Cooling Package', 'Engine', 'Cooling System', 260000, true),
  ('clutch', 1, 'Stage 1 Organic', 'Drivetrain', 'Clutch', 85000, true),
  ('clutch', 2, 'Stage 2 Kevlar', 'Drivetrain', 'Clutch', 220000, true),
  ('clutch', 3, 'Twin-Disc Ceramic', 'Drivetrain', 'Clutch', 540000, true),
  ('clutch', 4, 'Triple-Disc Race', 'Drivetrain', 'Clutch', 1150000, true),
  ('transmission', 1, 'Short-Throw & Bushings', 'Drivetrain', 'Transmission', 68000, true),
  ('transmission', 2, 'Built Gearset', 'Drivetrain', 'Transmission', 480000, true),
  ('transmission', 3, 'Dog-Box Sequential', 'Drivetrain', 'Transmission', 1350000, true),
  ('differential', 1, 'Limited Slip (1.5-way)', 'Drivetrain', 'Differential', 180000, true),
  ('differential', 2, 'Spool / Locked', 'Drivetrain', 'Differential', 320000, true),
  ('driveshaft', 1, 'Chromoly Driveshaft', 'Drivetrain', 'Driveshaft & Axles', 145000, true),
  ('driveshaft', 2, 'Carbon Shaft & Race Axles', 'Drivetrain', 'Driveshaft & Axles', 420000, true),
  ('weight', 1, 'Interior Strip', 'Chassis', 'Weight Reduction', 75000, true),
  ('weight', 2, 'Lexan & Lightweight Panels', 'Chassis', 'Weight Reduction', 230000, true),
  ('weight', 3, 'Carbon Body & Tube Front End', 'Chassis', 'Weight Reduction', 640000, true),
  ('suspension', 1, 'Lowering Springs', 'Chassis', 'Suspension', 62000, true),
  ('suspension', 2, 'Adjustable Coilovers', 'Chassis', 'Suspension', 185000, true),
  ('suspension', 3, 'Drag Suspension & Ladder Bars', 'Chassis', 'Suspension', 460000, true),
  ('tires', 1, 'Sport Performance', 'Tires', 'Tire Compound', 95000, true),
  ('tires', 2, 'Drag Radial', 'Tires', 'Tire Compound', 240000, true),
  ('tires', 3, 'Drag Slick', 'Tires', 'Tire Compound', 620000, true),
  ('electronics', 1, 'Piggyback Tune', 'Drivetrain', 'Engine Management', 110000, true),
  ('electronics', 2, 'Standalone ECU', 'Drivetrain', 'Engine Management', 340000, true)
on conflict (slot, level) do update set
  name = excluded.name,
  category = excluded.category,
  slot_name = excluded.slot_name,
  price_cents = excluded.price_cents,
  enabled = excluded.enabled;
