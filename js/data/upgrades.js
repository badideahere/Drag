// js/data/upgrades.js
// Upgrades are declarative: each level lists the simulation variables it changes.
// js/sim/build.js applies them. Nothing here is cosmetic — if an upgrade has no
// effect entry, it does nothing in the game.
//
// `effects` keys understood by build.js:
//   torqueMult          number          flat multiplier on the whole NA curve
//   torqueLowMult       number          multiplier weighted toward low rpm
//   torqueHighMult      number          multiplier weighted toward high rpm
//   revDelta            number          adds to redline / limiter / safe / float rpm
//   safeRevDelta        number          adds to maxSafeRpm and floatRpm only
//   massDelta           kg              negative removes weight
//   cgHeightDelta       m
//   weightDistFrontDelta fraction
//   engineInertiaMult   number          lighter rotating assembly
//   frictionMult        number
//   coolingKwMult       number
//   thermalLimitDelta   °C
//   overRevSensMult     number
//   clutchType          string          key of CLUTCH_TYPES
//   gearboxTorqueMult   number
//   shiftTimeMult       number
//   gearboxEfficiencyDelta number
//   addGear             number          extra ratio appended (close-ratio boxes)
//   diffType            string          key of DIFF_TYPES
//   finalDriveDelta     number
//   installTurbo        object          turbo spec — converts an NA engine
//   installSupercharger object
//   boostTargetDelta    kPa
//   maxBoostDelta       kPa
//   spoolRpmDelta       rpm
//   lagMult             number
//   intercoolerEff      number          absolute effectiveness 0..0.95
//   tireCompound        string
//   tireWidthDelta      mm
//   launchControl       bool

export const UPGRADES = {
  /* =================================================================== ENGINE */
  intake: {
    id: 'intake', category: 'Engine', name: 'Intake',
    blurb: 'More air into the engine. Helps most at high rpm.',
    levels: [
      { level: 1, name: 'Panel Filter', priceCents: 12000, effects: { torqueHighMult: 1.02 } },
      { level: 2, name: 'Cold Air Intake', priceCents: 48000, effects: { torqueHighMult: 1.045, torqueMult: 1.01 } },
      { level: 3, name: 'Velocity Stack Manifold', priceCents: 185000, effects: { torqueHighMult: 1.08, torqueMult: 1.02 } },
    ],
  },
  exhaust: {
    id: 'exhaust', category: 'Engine', name: 'Exhaust',
    blurb: 'Less backpressure. Frees up power and helps a turbo spool.',
    levels: [
      { level: 1, name: 'Cat-Back System', priceCents: 42000, effects: { torqueMult: 1.025 } },
      { level: 2, name: 'Long-Tube Headers', priceCents: 165000, effects: { torqueMult: 1.05, torqueHighMult: 1.03 } },
      { level: 3, name: 'Full Race Exhaust', priceCents: 420000, effects: { torqueMult: 1.08, torqueHighMult: 1.05, spoolRpmDelta: -260, lagMult: 0.9 } },
    ],
  },
  camshaft: {
    id: 'camshaft', category: 'Engine', name: 'Camshaft',
    blurb: 'Trades idle quality and low-end torque for top end.',
    levels: [
      { level: 1, name: 'Mild Street Cam', priceCents: 135000, effects: { torqueHighMult: 1.06, torqueLowMult: 0.98, revDelta: 250 } },
      { level: 2, name: 'Stage 2 Cam', priceCents: 340000, effects: { torqueHighMult: 1.11, torqueLowMult: 0.94, revDelta: 500 } },
      { level: 3, name: 'Solid Roller Race Cam', priceCents: 780000, effects: { torqueHighMult: 1.18, torqueLowMult: 0.88, revDelta: 900, overRevSensMult: 1.2 } },
    ],
  },
  heads: {
    id: 'heads', category: 'Engine', name: 'Cylinder Heads',
    blurb: 'Better flow across the range. Expensive, but it is real power.',
    levels: [
      { level: 1, name: 'Ported Heads', priceCents: 280000, effects: { torqueMult: 1.05, torqueHighMult: 1.04 } },
      { level: 2, name: 'CNC Race Heads', priceCents: 690000, effects: { torqueMult: 1.09, torqueHighMult: 1.08 } },
    ],
  },
  block: {
    id: 'block', category: 'Engine', name: 'Engine Build',
    blurb: 'Forged internals. Survives far more rpm and boost.',
    levels: [
      { level: 1, name: 'Forged Rods & Pistons', priceCents: 520000, effects: { safeRevDelta: 500, overRevSensMult: 0.65, torqueMult: 1.02, engineInertiaMult: 0.94 } },
      { level: 2, name: 'Billet Race Short Block', priceCents: 1450000, effects: { safeRevDelta: 1100, overRevSensMult: 0.42, torqueMult: 1.05, engineInertiaMult: 0.86, frictionMult: 0.92 } },
    ],
  },
  turbo: {
    id: 'turbo', category: 'Engine', name: 'Turbocharger',
    blurb: 'Adds or enlarges a turbo. Bigger means more power and more lag.',
    requiresAspiration: ['na', 'turbo'],
    levels: [
      {
        level: 1, name: 'Small Journal-Bearing Turbo', priceCents: 480000,
        effects: { installTurbo: { maxBoostKpa: 78, targetBoostKpa: 62, spoolRpm: 2500, lagSeconds: 0.45 }, boostTargetDelta: 14, maxBoostDelta: 16, spoolRpmDelta: -200, lagMult: 0.88 },
      },
      {
        level: 2, name: 'Ball-Bearing Street Turbo', priceCents: 1150000,
        effects: { installTurbo: { maxBoostKpa: 118, targetBoostKpa: 96, spoolRpm: 3100, lagSeconds: 0.55 }, boostTargetDelta: 34, maxBoostDelta: 40, spoolRpmDelta: 150, lagMult: 0.95 },
      },
      {
        level: 3, name: 'Large Frame Race Turbo', priceCents: 2600000,
        effects: { installTurbo: { maxBoostKpa: 175, targetBoostKpa: 148, spoolRpm: 4100, lagSeconds: 0.85 }, boostTargetDelta: 62, maxBoostDelta: 72, spoolRpmDelta: 700, lagMult: 1.25 },
      },
    ],
  },
  supercharger: {
    id: 'supercharger', category: 'Engine', name: 'Supercharger',
    blurb: 'Belt-driven boost with no lag. Costs some power to drive.',
    requiresAspiration: ['na', 'supercharged'],
    conflictsWith: ['turbo'],
    levels: [
      {
        level: 1, name: 'Roots Blower', priceCents: 720000,
        effects: { installSupercharger: { maxBoostKpa: 62, engageRpm: 900, fullRpm: 3800, parasiticNm: 38 }, maxBoostDelta: 12 },
      },
      {
        level: 2, name: 'Twin-Screw Blower', priceCents: 1680000,
        effects: { installSupercharger: { maxBoostKpa: 105, engageRpm: 850, fullRpm: 3600, parasiticNm: 58 }, maxBoostDelta: 26 },
      },
    ],
  },
  intercooler: {
    id: 'intercooler', category: 'Engine', name: 'Intercooler',
    blurb: 'Cooler intake charge. Only matters on a boosted engine.',
    requiresAspiration: ['turbo', 'supercharged'],
    levels: [
      { level: 1, name: 'Upgraded Front-Mount', priceCents: 165000, effects: { intercoolerEff: 0.70 } },
      { level: 2, name: 'Race Bar-and-Plate', priceCents: 390000, effects: { intercoolerEff: 0.82 } },
      { level: 3, name: 'Air-to-Water Intercooler', priceCents: 860000, effects: { intercoolerEff: 0.91, thermalLimitDelta: 4 } },
    ],
  },
  cooling: {
    id: 'cooling', category: 'Engine', name: 'Cooling System',
    blurb: 'Keeps coolant temperature down on repeat runs.',
    levels: [
      { level: 1, name: 'Aluminium Radiator', priceCents: 95000, effects: { coolingKwMult: 1.25, thermalLimitDelta: 3 } },
      { level: 2, name: 'Race Cooling Package', priceCents: 260000, effects: { coolingKwMult: 1.6, thermalLimitDelta: 7 } },
    ],
  },

  /* ============================================================== DRIVETRAIN */
  clutch: {
    id: 'clutch', category: 'Drivetrain', name: 'Clutch',
    blurb: 'Torque capacity and heat resistance. The single most useful upgrade on a fast car.',
    levels: [
      { level: 1, name: 'Stage 1 Organic', priceCents: 85000, effects: { clutchType: 'stage1' } },
      { level: 2, name: 'Stage 2 Kevlar', priceCents: 220000, effects: { clutchType: 'stage2' } },
      { level: 3, name: 'Twin-Disc Ceramic', priceCents: 540000, effects: { clutchType: 'twin' } },
      { level: 4, name: 'Triple-Disc Race', priceCents: 1150000, effects: { clutchType: 'triple' } },
    ],
  },
  transmission: {
    id: 'transmission', category: 'Drivetrain', name: 'Transmission',
    blurb: 'Stronger gearset, faster shifts, less loss.',
    levels: [
      { level: 1, name: 'Short-Throw & Bushings', priceCents: 68000, effects: { shiftTimeMult: 0.86, gearboxTorqueMult: 1.05 } },
      { level: 2, name: 'Built Gearset', priceCents: 480000, effects: { shiftTimeMult: 0.72, gearboxTorqueMult: 1.55, gearboxEfficiencyDelta: 0.01 } },
      { level: 3, name: 'Dog-Box Sequential', priceCents: 1350000, effects: { shiftTimeMult: 0.42, gearboxTorqueMult: 2.3, gearboxEfficiencyDelta: 0.02 } },
    ],
  },
  differential: {
    id: 'differential', category: 'Drivetrain', name: 'Differential',
    blurb: 'How well the driven axle actually puts torque down.',
    levels: [
      { level: 1, name: 'Limited Slip (1.5-way)', priceCents: 180000, effects: { diffType: 'lsd' } },
      { level: 2, name: 'Spool / Locked', priceCents: 320000, effects: { diffType: 'locked' } },
    ],
  },
  driveshaft: {
    id: 'driveshaft', category: 'Drivetrain', name: 'Driveshaft & Axles',
    blurb: 'Lighter, stronger rotating parts. Survives clutch dumps.',
    levels: [
      { level: 1, name: 'Chromoly Driveshaft', priceCents: 145000, effects: { gearboxTorqueMult: 1.18, massDelta: -8 } },
      { level: 2, name: 'Carbon Shaft & Race Axles', priceCents: 420000, effects: { gearboxTorqueMult: 1.45, massDelta: -16, gearboxEfficiencyDelta: 0.01 } },
    ],
  },

  /* ================================================================= CHASSIS */
  weight: {
    id: 'weight', category: 'Chassis', name: 'Weight Reduction',
    blurb: 'Removes mass. Every kilogram is acceleration everywhere.',
    levels: [
      { level: 1, name: 'Interior Strip', priceCents: 75000, effects: { massDelta: -65, cgHeightDelta: -0.01 } },
      { level: 2, name: 'Lexan & Lightweight Panels', priceCents: 230000, effects: { massDelta: -145, cgHeightDelta: -0.02 } },
      { level: 3, name: 'Carbon Body & Tube Front End', priceCents: 640000, effects: { massDelta: -265, cgHeightDelta: -0.04, weightDistFrontDelta: -0.03 } },
    ],
  },
  suspension: {
    id: 'suspension', category: 'Chassis', name: 'Suspension',
    blurb: 'Drag-specific geometry. Plants the driven axle on launch.',
    levels: [
      { level: 1, name: 'Lowering Springs', priceCents: 62000, effects: { cgHeightDelta: -0.03 } },
      { level: 2, name: 'Adjustable Coilovers', priceCents: 185000, effects: { cgHeightDelta: -0.05, weightDistFrontDelta: -0.015 } },
      { level: 3, name: 'Drag Suspension & Ladder Bars', priceCents: 460000, effects: { cgHeightDelta: -0.02, weightDistFrontDelta: -0.05 } },
    ],
  },

  /* =================================================================== TIRES */
  tires: {
    id: 'tires', category: 'Tires', name: 'Tire Compound',
    blurb: 'The cheapest lap time on the list. Softer compounds need heat.',
    levels: [
      { level: 1, name: 'Sport Performance', priceCents: 95000, effects: { tireCompound: 'sport' } },
      { level: 2, name: 'Drag Radial', priceCents: 240000, effects: { tireCompound: 'drag_radial', tireWidthDelta: 25 } },
      { level: 3, name: 'Drag Slick', priceCents: 620000, effects: { tireCompound: 'slick', tireWidthDelta: 55 } },
    ],
  },
  electronics: {
    id: 'electronics', category: 'Drivetrain', name: 'Engine Management',
    blurb: 'Standalone ECU. Unlocks launch control and boost control.',
    levels: [
      { level: 1, name: 'Piggyback Tune', priceCents: 110000, effects: { torqueMult: 1.03, launchControl: true } },
      { level: 2, name: 'Standalone ECU', priceCents: 340000, effects: { torqueMult: 1.06, launchControl: true, boostTargetDelta: 12 } },
    ],
  },
};

export const UPGRADE_LIST = Object.values(UPGRADES);

/**
 * A car's current effective aspiration given the upgrades already fitted —
 * mirrors the precedence in js/sim/build.js (turbo wins if somehow both are
 * present). Needed to decide whether a forced-induction upgrade is buyable.
 */
export function effectiveAspiration(baseAspiration, currentUpgrades = {}) {
  const turboLevel = currentUpgrades.turbo || 0;
  const scLevel = currentUpgrades.supercharger || 0;
  if (turboLevel > 0) return 'turbo';
  if (scLevel > 0) return 'supercharged';
  return baseAspiration;
}

/**
 * Whether `slot` can be bought right now, given the car's base aspiration and
 * whatever is already fitted. Enforces each slot's `requiresAspiration` and
 * `conflictsWith` — declared on the upgrade data but otherwise inert. Used by
 * both the shop UI (to greet the player with a reason instead of a dead
 * button) and mirrored server-side, since a client-only check is not one a
 * modified client, or a direct call to the purchase endpoint, has to respect.
 */
export function upgradeAvailability(baseAspiration, currentUpgrades, slot) {
  const def = UPGRADES[slot];
  if (!def) return { ok: false, reason: 'Unknown upgrade.' };
  const current = effectiveAspiration(baseAspiration, currentUpgrades);

  if (def.conflictsWith) {
    for (const otherSlot of def.conflictsWith) {
      if ((currentUpgrades[otherSlot] || 0) > 0) {
        return { ok: false, reason: `Conflicts with your ${UPGRADES[otherSlot]?.name || otherSlot}.` };
      }
    }
  }
  // Also block the reverse direction: something already fitted that lists
  // THIS slot as a conflict (covers slots that declare the relationship only
  // on one side, as turbo/supercharger do here).
  for (const [ownedSlot, level] of Object.entries(currentUpgrades)) {
    if (!level || ownedSlot === slot) continue;
    const ownedDef = UPGRADES[ownedSlot];
    if (ownedDef?.conflictsWith?.includes(slot)) {
      return { ok: false, reason: `Conflicts with your ${ownedDef.name}.` };
    }
  }
  if (def.requiresAspiration && !def.requiresAspiration.includes(current)) {
    const need = def.requiresAspiration.filter((a) => a !== current);
    const label = need.includes('turbo') || need.includes('supercharged')
      ? 'a boosted engine' : need.join(' or ');
    return { ok: false, reason: `Requires ${label}.` };
  }
  return { ok: true, reason: null };
}
export const UPGRADE_CATEGORIES = ['Engine', 'Drivetrain', 'Chassis', 'Tires'];

export function getUpgrade(id) { return UPGRADES[id] || null; }

export function getUpgradeLevel(id, level) {
  const u = UPGRADES[id];
  if (!u) return null;
  return u.levels.find((l) => l.level === level) || null;
}

/** Total spent on a slot up to and including `level` — used for resale/repair maths. */
export function cumulativeCost(id, level) {
  const u = UPGRADES[id];
  if (!u) return 0;
  return u.levels.filter((l) => l.level <= level).reduce((s, l) => s + l.priceCents, 0);
}
