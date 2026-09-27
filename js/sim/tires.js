// js/sim/tires.js
// Longitudinal tire model for drag racing: slip-curve force, thermal grip window,
// pressure sensitivity, wear, and heat generation (which is what the burnout uses).

import { clamp, lerp } from './util.js';

/**
 * Tire compounds. `peakMu` is the coefficient at the ideal temperature and pressure
 * on a prepped surface. `optC` is the centre of the grip window.
 */
export const TIRE_COMPOUNDS = {
  street: {
    id: 'street', name: 'Street Radial',
    peakMu: 1.05, optC: 62, windowC: 34, coldMu: 0.88, hotFalloff: 0.0055,
    optPsi: 32, psiTolerance: 7, slipPeak: 0.16, shapeC: 1.55, wearRate: 0.55,
    heatRate: 2.6, coolRate: 1.15, thermalMassKj: 6.0, rollingResist: 0.013, price: 0,
    desc: 'Hard compound, long life, very little launch grip.',
  },
  sport: {
    id: 'sport', name: 'Sport Performance',
    peakMu: 1.22, optC: 78, windowC: 32, coldMu: 0.96, hotFalloff: 0.0062,
    optPsi: 30, psiTolerance: 6, slipPeak: 0.15, shapeC: 1.62, wearRate: 0.85,
    heatRate: 2.4, coolRate: 1.0, thermalMassKj: 7.5, rollingResist: 0.0135, price: 95000,
    desc: 'Softer street tire. Noticeably better bite once warm.',
  },
  drag_radial: {
    id: 'drag_radial', name: 'Drag Radial',
    peakMu: 1.66, optC: 88, windowC: 26, coldMu: 1.06, hotFalloff: 0.0085,
    optPsi: 18, psiTolerance: 5, slipPeak: 0.13, shapeC: 1.72, wearRate: 1.5,
    heatRate: 2.3, coolRate: 0.85, thermalMassKj: 11.0, rollingResist: 0.016, price: 240000,
    desc: 'Street-legal drag tire. Wants heat and low pressure.',
  },
  slick: {
    id: 'slick', name: 'Drag Slick',
    peakMu: 2.14, optC: 96, windowC: 22, coldMu: 1.10, hotFalloff: 0.0110,
    optPsi: 13, psiTolerance: 4, slipPeak: 0.11, shapeC: 1.85, wearRate: 2.3,
    heatRate: 2.2, coolRate: 0.72, thermalMassKj: 14.0, rollingResist: 0.019, price: 620000,
    desc: 'Bias-ply slick. Enormous grip, narrow window, punishing when cold.',
  },
};

export const SURFACES = {
  prepped: { id: 'prepped', name: 'Prepped Track', grip: 1.0 },
  clean: { id: 'clean', name: 'Clean Asphalt', grip: 0.86 },
  dusty: { id: 'dusty', name: 'Dusty Surface', grip: 0.72 },
  cold: { id: 'cold', name: 'Cold Night Asphalt', grip: 0.80 },
};

export class TireAxle {
  /**
   * @param {object} cfg { compound, radius, widthMm, pressurePsi, driven, ambientC }
   */
  constructor(cfg) {
    this.compound = TIRE_COMPOUNDS[cfg.compound] || TIRE_COMPOUNDS.street;
    this.radius = cfg.radius;               // metres
    this.widthMm = cfg.widthMm ?? 245;
    this.pressurePsi = cfg.pressurePsi ?? this.compound.optPsi;
    this.driven = !!cfg.driven;
    this.ambientC = cfg.ambientC ?? 20;

    this.tempC = this.ambientC;
    this.health = 100;          // 0-100, persists on the car
    this.slipRatio = 0;
    this.slipVelocity = 0;      // m/s of contact patch scrub
    this.force = 0;             // N longitudinal
    this.load = 0;              // N vertical
    this.smoke = 0;             // 0..1 how hard it is smoking right now
    this.omega = 0;             // rad/s wheel speed
    this.inertia = cfg.inertia ?? 1.35; // kg m^2 for the pair, incl. brake/hub
  }

  reset(healthPercent = this.health, ambientC = this.ambientC) {
    this.ambientC = ambientC;
    this.tempC = ambientC;
    this.health = healthPercent;
    this.slipRatio = 0; this.slipVelocity = 0; this.force = 0; this.smoke = 0; this.omega = 0;
  }

  /** Multiplier from tire temperature — cold is bad, too hot is worse. */
  get thermalMu() {
    const c = this.compound;
    const d = this.tempC - c.optC;
    if (d < 0) {
      // Ramp up from the cold coefficient to peak across the window.
      const t = clamp(1 + d / c.windowC, 0, 1);
      return lerp(c.coldMu / c.peakMu, 1, Math.pow(t, 0.85));
    }
    if (d <= c.windowC * 0.35) return 1;
    // Past the window the compound greases over and it gets worse fast.
    return clamp(1 - (d - c.windowC * 0.35) * c.hotFalloff, 0.42, 1);
  }

  /** Multiplier from inflation pressure — off-optimum shrinks the contact patch. */
  get pressureMu() {
    const c = this.compound;
    const d = Math.abs(this.pressurePsi - c.optPsi);
    if (d <= c.psiTolerance * 0.3) return 1;
    const excess = d - c.psiTolerance * 0.3;
    return clamp(1 - Math.pow(excess / c.psiTolerance, 1.7) * 0.30, 0.55, 1);
  }

  get healthMu() {
    const h = clamp(this.health, 0, 100) / 100;
    return clamp(0.45 + 0.55 * Math.pow(h, 0.7), 0.45, 1);
  }

  /** Peak available coefficient of friction right now. */
  mu(surfaceGrip) {
    return this.compound.peakMu * this.thermalMu * this.pressureMu * this.healthMu * surfaceGrip;
  }

  /**
   * Normalised slip curve (magic-formula shaped). Returns 0..1 of peak mu.
   */
  slipCurve(s) {
    const c = this.compound;
    const B = 1 / Math.max(c.slipPeak, 0.01) * 1.05;
    const C = c.shapeC;
    const E = 0.94;
    const x = Math.abs(s);
    const bx = B * x;
    const val = Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
    return clamp(val, 0, 1.0);
  }

  /**
   * Compute longitudinal force.
   * @param {number} vehicleSpeed m/s
   * @param {number} load N on this axle
   * @param {number} surfaceGrip 0..1
   */
  computeForce(vehicleSpeed, load, surfaceGrip) {
    this.load = Math.max(load, 0);
    const contactSpeed = this.omega * this.radius;
    this.slipVelocity = contactSpeed - vehicleSpeed;
    // Reference speed keeps the slip ratio finite at a standstill.
    const vRef = Math.max(Math.abs(vehicleSpeed), 2.2);
    this.slipRatio = this.slipVelocity / vRef;

    const peak = this.mu(surfaceGrip) * this.load;
    const f = peak * this.slipCurve(this.slipRatio) * Math.sign(this.slipRatio || 1);
    this.force = f;
    return f;
  }

  /**
   * Thermal + wear update. Heat comes from friction power at the contact patch,
   * which is exactly what a burnout is doing.
   */
  update(dt, vehicleSpeed, airTempC = this.ambientC) {
    const c = this.compound;
    // Only a fraction of the friction power at the contact patch ends up in the
    // carcass — the rest leaves as smoke, noise and heat into the road surface.
    const frictionPowerKw = Math.abs(this.force * this.slipVelocity) / 1000;
    const rollKw = Math.abs(this.load * vehicleSpeed) * 0.000018;
    const heatIn = (frictionPowerKw * 0.26 + rollKw) * c.heatRate;

    // Cooling: conduction into the road plus airflow over the sidewall.
    const dTemp = this.tempC - airTempC;
    const coolOut = (0.30 + 0.055 * Math.abs(vehicleSpeed)) * dTemp * 0.10 * c.coolRate;

    // kJ per degree C for the working mass of both tires on this axle.
    const thermalMass = (c.thermalMassKj ?? 7) + this.widthMm * 0.004;
    this.tempC = clamp(this.tempC + (heatIn - coolOut) / thermalMass * dt, airTempC - 5, 260);

    // Wear: scrubbing wears the tire; heat above the window accelerates it hard.
    const heatMult = this.tempC > c.optC + c.windowC * 0.5
      ? 1 + Math.pow((this.tempC - c.optC - c.windowC * 0.5) / 40, 1.8) * 3
      : 1;
    const wear = Math.abs(this.slipVelocity) * (this.load / 9000) * c.wearRate * heatMult * 0.00042;
    this.health = clamp(this.health - wear * dt * 14, 0, 100);

    // Smoke: needs real scrub speed and real temperature, not just throttle.
    const scrub = Math.abs(this.slipVelocity);
    const heatFactor = clamp((this.tempC - c.optC * 0.7) / 90, 0, 1);
    this.smoke = clamp((scrub - 2.5) / 22, 0, 1) * clamp(0.35 + heatFactor, 0, 1.2);
  }

  telemetry() {
    return {
      compound: this.compound.id,
      tempC: this.tempC,
      health: this.health,
      pressurePsi: this.pressurePsi,
      slipRatio: this.slipRatio,
      slipVelocity: this.slipVelocity,
      force: this.force,
      load: this.load,
      omega: this.omega,
      rpm: (this.omega * 30) / Math.PI,
      smoke: this.smoke,
      gripFraction: this.thermalMu * this.pressureMu * this.healthMu,
    };
  }
}
