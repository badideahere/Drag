// js/sim/build.js
// Turns (base car) + (owned upgrades) + (tuning) into the resolved spec that
// Vehicle consumes. The dyno, the garage stat sheet and the race all call this,
// so they can never disagree with each other.

import { CARS } from '../data/cars.js';
import { UPGRADES, getUpgradeLevel } from '../data/upgrades.js';
import { CLUTCH_TYPES, DIFF_TYPES } from './drivetrain.js';
import { TIRE_COMPOUNDS } from './tires.js';
import { clamp, lerp } from './util.js';
import { peakOutputs, Engine } from './engine.js';

const deep = (o) => JSON.parse(JSON.stringify(o));

/** Hard limits so nobody can tune their way to a physically silly car. */
export const TUNING_LIMITS = {
  finalDrive: { min: 2.5, max: 6.2, step: 0.01 },
  gearRatio: { min: 0.45, max: 5.0, step: 0.01 },
  pressurePsi: { min: 8, max: 55, step: 0.5 },
  launchRpm: { min: 800, max: 9500, step: 50 },
  shiftRpm: { min: 1500, max: 9800, step: 50 },
  boostTargetKpa: { min: 0, max: 320, step: 1 },
  clutchEngageSpeed: { min: 0.3, max: 4.0, step: 0.1 },
  throttleMap: ['linear', 'progressive', 'aggressive'],
};

export function defaultTuning(carId) {
  const car = CARS[carId];
  if (!car) return {};
  return {
    finalDrive: car.gearbox.finalDrive,
    gearRatios: car.gearbox.ratios.slice(),
    frontPsi: car.tires.frontPsi ?? car.tires.pressurePsi,
    rearPsi: car.tires.pressurePsi,
    launchRpm: car.tuning?.launchRpm ?? 3000,
    shiftRpm: car.tuning?.shiftRpm ?? car.engine.redlineRpm * 0.95,
    boostTargetKpa: car.engine.turbo?.targetBoostKpa ?? car.engine.supercharger?.maxBoostKpa ?? 0,
    throttleMap: 'linear',
    clutchEngageSpeed: 1.6,
  };
}

/** Clamp a tuning object into legal ranges. Called on the client AND in the Edge Function. */
export function sanitizeTuning(carId, tuning = {}) {
  const car = CARS[carId];
  const base = defaultTuning(carId);
  if (!car) return base;
  const L = TUNING_LIMITS;
  const out = { ...base, ...tuning };

  out.finalDrive = clamp(Number(out.finalDrive) || base.finalDrive, L.finalDrive.min, L.finalDrive.max);
  const ratios = Array.isArray(out.gearRatios) ? out.gearRatios : base.gearRatios;
  out.gearRatios = base.gearRatios.map((def, i) => {
    const v = Number(ratios[i]);
    if (!isFinite(v)) return def;
    return clamp(v, L.gearRatio.min, L.gearRatio.max);
  });
  // Gears must stay in descending order — no 2nd taller than 5th.
  for (let i = 1; i < out.gearRatios.length; i++) {
    if (out.gearRatios[i] >= out.gearRatios[i - 1]) {
      out.gearRatios[i] = out.gearRatios[i - 1] * 0.92;
    }
  }
  out.frontPsi = clamp(Number(out.frontPsi) || base.frontPsi, L.pressurePsi.min, L.pressurePsi.max);
  out.rearPsi = clamp(Number(out.rearPsi) || base.rearPsi, L.pressurePsi.min, L.pressurePsi.max);
  out.launchRpm = clamp(Number(out.launchRpm) || base.launchRpm, L.launchRpm.min, car.engine.limiterRpm);
  out.shiftRpm = clamp(Number(out.shiftRpm) || base.shiftRpm, L.shiftRpm.min, car.engine.floatRpm);
  out.boostTargetKpa = clamp(Number(out.boostTargetKpa) || 0, L.boostTargetKpa.min, L.boostTargetKpa.max);
  out.throttleMap = L.throttleMap.includes(out.throttleMap) ? out.throttleMap : 'linear';
  out.clutchEngageSpeed = clamp(Number(out.clutchEngageSpeed) || 1.6, L.clutchEngageSpeed.min, L.clutchEngageSpeed.max);
  return out;
}

/** Gather every effect object from an upgrade map { slotId: level }. */
function collectEffects(upgrades = {}) {
  const list = [];
  for (const [slot, level] of Object.entries(upgrades)) {
    const lv = getUpgradeLevel(slot, Number(level));
    if (lv) list.push({ slot, level: Number(level), ...lv.effects });
  }
  return list;
}

/**
 * Reshape a torque curve with separate low/high-rpm weighting so a camshaft
 * really does trade bottom end for top end.
 */
function reshapeCurve(curve, flat, low, high) {
  if (!curve.length) return curve;
  const minR = curve[0][0], maxR = curve[curve.length - 1][0];
  return curve.map(([rpm, tq]) => {
    const t = clamp((rpm - minR) / Math.max(maxR - minR, 1), 0, 1);
    const weighted = lerp(low, high, t);
    return [rpm, tq * flat * weighted];
  });
}

/**
 * @param {string} carId
 * @param {object} opts { upgrades:{slot:level}, tuning:{}, condition:{} }
 * @returns resolved spec for `new Vehicle(spec)`
 */
export function buildVehicleSpec(carId, opts = {}) {
  const base = CARS[carId];
  if (!base) throw new Error(`Unknown car: ${carId}`);

  const spec = deep(base);
  const effects = collectEffects(opts.upgrades);
  const tuning = sanitizeTuning(carId, opts.tuning);

  // --------------------------------------------------------------- engine
  let flatMult = 1, lowMult = 1, highMult = 1;
  let revDelta = 0, safeRevDelta = 0;
  let inertiaMult = 1, frictionMult = 1, coolingMult = 1, thermalDelta = 0, overRevMult = 1;
  let boostTargetDelta = 0, maxBoostDelta = 0, spoolDelta = 0, lagMult = 1, icEff = null;
  let launchControl = !!base.tuning?.launchControl;

  // Forced induction is mutually exclusive on one engine. The shop is meant to
  // stop a player owning both a turbo and a supercharger upgrade at once, but
  // this stays defensive: if both are somehow present, turbo wins (matching
  // the install order below), and the losing side's boost-related deltas —
  // which share key names with the winning side's — must not get added in on
  // top of it.
  const hasTurboInstall = effects.some((e) => e.installTurbo);
  const hasSuperchargerInstall = effects.some((e) => e.installSupercharger);
  const finalAspiration = hasTurboInstall ? 'turbo'
    : hasSuperchargerInstall ? 'supercharged'
      : base.engine.aspiration;

  // ------------------------------------------------------------- chassis
  let massDelta = 0, cgDelta = 0, distDelta = 0;

  // ---------------------------------------------------------- drivetrain
  let clutchType = base.clutch.type;
  let diffType = base.differential.type;
  let gbTorqueMult = 1, shiftTimeMult = 1, gbEffDelta = 0;

  // --------------------------------------------------------------- tires
  let tireCompound = base.tires.compound;
  let tireWidthDelta = 0;

  for (const e of effects) {
    if (e.torqueMult) flatMult *= e.torqueMult;
    if (e.torqueLowMult) lowMult *= e.torqueLowMult;
    if (e.torqueHighMult) highMult *= e.torqueHighMult;
    if (e.revDelta) revDelta += e.revDelta;
    if (e.safeRevDelta) safeRevDelta += e.safeRevDelta;
    if (e.engineInertiaMult) inertiaMult *= e.engineInertiaMult;
    if (e.frictionMult) frictionMult *= e.frictionMult;
    if (e.coolingKwMult) coolingMult *= e.coolingKwMult;
    if (e.thermalLimitDelta) thermalDelta += e.thermalLimitDelta;
    if (e.overRevSensMult) overRevMult *= e.overRevSensMult;

    if (e.massDelta) massDelta += e.massDelta;
    if (e.cgHeightDelta) cgDelta += e.cgHeightDelta;
    if (e.weightDistFrontDelta) distDelta += e.weightDistFrontDelta;

    if (e.clutchType) clutchType = e.clutchType;
    if (e.diffType) diffType = e.diffType;
    if (e.gearboxTorqueMult) gbTorqueMult *= e.gearboxTorqueMult;
    if (e.shiftTimeMult) shiftTimeMult *= e.shiftTimeMult;
    if (e.gearboxEfficiencyDelta) gbEffDelta += e.gearboxEfficiencyDelta;

    if (e.tireCompound) tireCompound = e.tireCompound;
    if (e.tireWidthDelta) tireWidthDelta += e.tireWidthDelta;

    if (e.installTurbo && spec.engine.aspiration !== 'supercharged') {
      spec.engine.aspiration = 'turbo';
      spec.engine.turbo = { ...(spec.engine.turbo || {}), ...e.installTurbo };
      delete spec.engine.supercharger;
    }
    if (e.installSupercharger && spec.engine.aspiration !== 'turbo') {
      spec.engine.aspiration = 'supercharged';
      spec.engine.supercharger = { ...(spec.engine.supercharger || {}), ...e.installSupercharger };
      delete spec.engine.turbo;
    }
    const boostSlotWins = (e.slot === 'turbo' && finalAspiration === 'turbo')
      || (e.slot === 'supercharger' && finalAspiration === 'supercharged');
    if (e.boostTargetDelta && e.slot === 'turbo' && finalAspiration === 'turbo') boostTargetDelta += e.boostTargetDelta;
    if (e.maxBoostDelta && boostSlotWins) maxBoostDelta += e.maxBoostDelta;
    if (e.spoolRpmDelta && e.slot === 'turbo' && finalAspiration === 'turbo') spoolDelta += e.spoolRpmDelta;
    if (e.lagMult && e.slot === 'turbo' && finalAspiration === 'turbo') lagMult *= e.lagMult;
    if (e.intercoolerEff != null) icEff = Math.max(icEff ?? 0, e.intercoolerEff);
    if (e.launchControl) launchControl = true;
  }

  // Apply engine changes
  spec.engine.torqueCurve = reshapeCurve(spec.engine.torqueCurve, flatMult, lowMult, highMult);
  spec.engine.redlineRpm += revDelta;
  spec.engine.limiterRpm += revDelta;
  spec.engine.maxSafeRpm += revDelta + safeRevDelta;
  spec.engine.floatRpm += revDelta + safeRevDelta;
  spec.engine.inertia = (spec.engine.inertia ?? 0.22) * inertiaMult;
  spec.engine.frictionNm = (spec.engine.frictionNm ?? 18) * frictionMult;
  spec.engine.frictionSlope = (spec.engine.frictionSlope ?? 0.0055) * frictionMult;
  spec.engine.coolingKw = (spec.engine.coolingKw ?? 55) * coolingMult;
  spec.engine.thermalLimitC = (spec.engine.thermalLimitC ?? 108) + thermalDelta;
  spec.engine.overRevSensitivity = (spec.engine.overRevSensitivity ?? 1) * overRevMult;
  spec.engine.throttleMap = tuning.throttleMap;

  if (icEff != null) {
    spec.engine.intercooler = { ...(spec.engine.intercooler || {}), effectiveness: icEff };
  }
  if (spec.engine.aspiration === 'turbo' && spec.engine.turbo) {
    const t = spec.engine.turbo;
    t.maxBoostKpa = Math.max(0, t.maxBoostKpa + maxBoostDelta);
    t.targetBoostKpa = Math.max(0, t.targetBoostKpa + boostTargetDelta);
    t.spoolRpm = clamp(t.spoolRpm + spoolDelta, 1200, 7000);
    t.lagSeconds = clamp(t.lagSeconds * lagMult, 0.12, 2.0);
    // Player boost setting cannot exceed what the hardware can flow.
    if (tuning.boostTargetKpa > 0) {
      t.targetBoostKpa = clamp(tuning.boostTargetKpa, 0, t.maxBoostKpa);
    }
  }
  if (spec.engine.aspiration === 'supercharged' && spec.engine.supercharger) {
    const sc = spec.engine.supercharger;
    sc.maxBoostKpa = Math.max(0, sc.maxBoostKpa + maxBoostDelta);
    if (tuning.boostTargetKpa > 0) {
      sc.maxBoostKpa = Math.min(sc.maxBoostKpa, tuning.boostTargetKpa + maxBoostDelta);
    }
  }
  if (spec.engine.aspiration === 'na') {
    delete spec.engine.turbo; delete spec.engine.supercharger;
  }

  // Chassis
  spec.massKg = Math.max(spec.massKg + massDelta, 620);
  spec.cgHeightM = clamp(spec.cgHeightM + cgDelta, 0.24, 0.8);
  spec.weightDistFront = clamp(spec.weightDistFront + distDelta, 0.30, 0.72);

  // Drivetrain
  const ct = CLUTCH_TYPES[clutchType] || CLUTCH_TYPES.stock;
  spec.clutch = { type: ct.id, capacityNm: ct.capacityNm };
  spec.differential = { type: DIFF_TYPES[diffType] ? diffType : 'open' };

  spec.gearbox.ratios = tuning.gearRatios.slice(0, spec.gearbox.ratios.length);
  spec.gearbox.finalDrive = tuning.finalDrive;
  spec.gearbox.maxTorqueNm = spec.gearbox.maxTorqueNm * gbTorqueMult;
  spec.gearbox.shiftTime = spec.gearbox.shiftTime * shiftTimeMult;
  spec.gearbox.efficiency = clamp(spec.gearbox.efficiency + gbEffDelta, 0.85, 0.98);

  // Tires
  const comp = TIRE_COMPOUNDS[tireCompound] ? tireCompound : 'street';
  spec.tires.compound = comp;
  spec.tires.widthMm = (spec.tires.widthMm ?? 245) + tireWidthDelta;
  spec.tires.pressurePsi = tuning.rearPsi;
  spec.tires.frontPsi = tuning.frontPsi;

  // Tuning carried into the vehicle
  spec.tuning = {
    launchRpm: clamp(tuning.launchRpm, 800, spec.engine.limiterRpm),
    shiftRpm: clamp(tuning.shiftRpm, 1500, spec.engine.floatRpm),
    launchControl,
    throttleMap: tuning.throttleMap,
    clutchEngageSpeed: tuning.clutchEngageSpeed,
  };
  spec.resolvedTuning = tuning;
  spec.upgrades = { ...(opts.upgrades || {}) };
  spec.condition = opts.condition || {};

  return spec;
}

/** Headline numbers for the garage / dealership cards. Uses the real engine model. */
export function specSummary(spec) {
  const peaks = peakOutputs(spec.engine);
  return {
    peakHp: peaks.peakHp,
    peakHpRpm: peaks.peakHpRpm,
    peakTorqueNm: peaks.peakTorqueNm,
    peakTorqueLbFt: peaks.peakTorqueNm * 0.737562149,
    peakTorqueRpm: peaks.peakTorqueRpm,
    massKg: spec.massKg,
    massLb: spec.massKg * 2.2046226218,
    powerToWeight: peaks.peakHp / (spec.massKg / 1000),
    drivetrain: spec.drivetrain,
    gearCount: spec.gearbox.ratios.length,
    aspiration: spec.engine.aspiration,
    boostPsi: spec.engine.aspiration === 'turbo'
      ? spec.engine.turbo.targetBoostKpa * 0.145038
      : spec.engine.aspiration === 'supercharged'
        ? spec.engine.supercharger.maxBoostKpa * 0.145038
        : 0,
    tireCompound: spec.tires.compound,
    clutchType: spec.clutch.type,
    diffType: spec.differential.type,
  };
}

/** Dyno sweep. Same Engine class the race uses, so the graph cannot lie. */
export function dynoSweep(spec, step = 100) {
  const points = [];
  const e = new Engine(spec.engine);
  for (let rpm = spec.engine.idleRpm; rpm <= spec.engine.redlineRpm + step; rpm += step) {
    const boost = e.boostCeiling(rpm, 1);
    e.boostKpa = boost;
    const tq = e.steadyStateTorque(rpm, 1);
    const hp = (tq * ((rpm * Math.PI) / 30)) / 1000 / 0.7457;
    points.push({
      rpm, torqueNm: tq, torqueLbFt: tq * 0.737562149, hp,
      boostKpa: boost, boostPsi: boost * 0.145038,
    });
  }
  return points;
}
