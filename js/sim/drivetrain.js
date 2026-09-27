// js/sim/drivetrain.js
// Clutch, gearbox and differential.
//
// The clutch is the important one. It is solved properly: either it is locked
// (crank and input shaft share a speed) or it is slipping (it transmits exactly
// its torque capacity and the difference becomes heat). That single distinction
// is what produces bogging, clutch kick, riding the clutch, and smoked clutches
// without any of it being scripted.

import { clamp, radToRpm } from './util.js';

export const CLUTCH_TYPES = {
  stock: { id: 'stock', name: 'Stock Organic', capacityNm: 320, thermalMassKj: 5.5, coolKw: 5.2, maxTempC: 320, wearRate: 1.0, engageSharpness: 1.0, price: 0 },
  stage1: { id: 'stage1', name: 'Stage 1 Organic', capacityNm: 460, thermalMassKj: 6.8, coolKw: 6.4, maxTempC: 360, wearRate: 0.85, engageSharpness: 1.15, price: 85000 },
  stage2: { id: 'stage2', name: 'Stage 2 Kevlar', capacityNm: 680, thermalMassKj: 8.6, coolKw: 7.8, maxTempC: 430, wearRate: 0.65, engageSharpness: 1.4, price: 220000 },
  twin: { id: 'twin', name: 'Twin-Disc Ceramic', capacityNm: 1050, thermalMassKj: 11.5, coolKw: 9.5, maxTempC: 520, wearRate: 0.45, engageSharpness: 1.9, price: 540000 },
  triple: { id: 'triple', name: 'Triple-Disc Race', capacityNm: 1650, thermalMassKj: 15.0, coolKw: 11.5, maxTempC: 620, wearRate: 0.32, engageSharpness: 2.4, price: 1150000 },
};

export const DIFF_TYPES = {
  open: { id: 'open', name: 'Open Differential', lockFactor: 0.15, tractionBonus: 0.90, price: 0 },
  lsd: { id: 'lsd', name: 'Limited Slip (1.5-way)', lockFactor: 0.62, tractionBonus: 1.03, price: 180000 },
  locked: { id: 'locked', name: 'Spool / Locked', lockFactor: 1.0, tractionBonus: 1.08, price: 320000 },
};

export class Clutch {
  constructor(cfg) {
    this.type = CLUTCH_TYPES[cfg.type] || CLUTCH_TYPES.stock;
    this.capacityNm = cfg.capacityNm ?? this.type.capacityNm;
    this.engagement = 1;     // 0 = pedal to the floor (disengaged), 1 = fully engaged
    this.slipSpeed = 0;      // rad/s across the disc
    this.transmitted = 0;    // Nm actually passed through
    this.locked = false;
    this.tempC = cfg.ambientC ?? 20;
    this.ambientC = cfg.ambientC ?? 20;
    this.health = 100;
    this.slipEnergyKj = 0;
    this.events = [];
    this.smoking = 0;
  }

  reset(healthPercent = this.health, ambientC = this.ambientC) {
    this.engagement = 1; this.slipSpeed = 0; this.transmitted = 0; this.locked = false;
    this.ambientC = ambientC; this.tempC = ambientC;
    this.health = healthPercent; this.slipEnergyKj = 0; this.smoking = 0;
    this.events.length = 0;
  }

  /** Torque the clutch can hold right now. */
  get capacity() {
    // Pedal position -> clamp force. Real clutches bite over a short band, and a
    // race clutch bites much more abruptly than a stock organic disc.
    const e = clamp(this.engagement, 0, 1);
    const sharp = this.type.engageSharpness;
    const clampForce = Math.pow(e, 1 / Math.max(sharp * 0.85, 0.35));

    // Heat fade
    const over = this.tempC - this.type.maxTempC * 0.62;
    const thermal = over > 0 ? clamp(1 - over / (this.type.maxTempC * 0.55), 0.18, 1) : 1;

    // Wear: a worn disc simply cannot hold torque.
    const wearFactor = clamp(0.22 + 0.78 * Math.pow(clamp(this.health, 0, 100) / 100, 0.8), 0.1, 1);

    return this.capacityNm * clampForce * thermal * wearFactor;
  }

  /**
   * Solve the clutch for one substep.
   * @param {object} p {
   *   engineOmega, inputOmega,   // rad/s either side
   *   engineTorque,              // net crank torque (combustion - friction)
   *   engineInertia, driveInertia,
   *   loadTorque,                // torque resisting the gearbox input shaft (reflected)
   *   dt
   * }
   * @returns {{locked:boolean, torque:number, sharedAlpha:number|null}}
   */
  solve(p) {
    const cap = this.capacity;
    const dw = p.engineOmega - p.inputOmega;
    this.slipSpeed = dw;

    if (cap <= 1) {
      // Fully disengaged (or destroyed): nothing gets through.
      this.locked = false;
      this.transmitted = 0;
      return { locked: false, torque: 0 };
    }

    // Torque required to hold both sides at a common acceleration:
    //   alpha = (Te - Tl) / (Ie + Id)
    //   Tc = Ie*alpha - Te   (torque the clutch must apply to the engine side)
    const Ie = p.engineInertia, Id = Math.max(p.driveInertia, 0.004);
    const alphaShared = (p.engineTorque - p.loadTorque) / (Ie + Id);
    const required = p.engineTorque - Ie * alphaShared;

    const nearlyMatched = Math.abs(dw) < 3.5; // rad/s ~ 33 rpm

    if (nearlyMatched && Math.abs(required) <= cap) {
      this.locked = true;
      this.transmitted = required;
      this.slipSpeed = 0;
      return { locked: true, torque: required, sharedAlpha: alphaShared };
    }

    // Slipping: transmits exactly its capacity, in the direction of the slip.
    this.locked = false;
    const dir = Math.abs(dw) < 0.05 ? Math.sign(required || 1) : Math.sign(dw);
    this.transmitted = cap * dir;
    return { locked: false, torque: this.transmitted };
  }

  /** Heat, wear and failure. Call once per substep after solve(). */
  update(dt, vehicleSpeed = 0) {
    const powerKw = Math.abs(this.transmitted * this.slipSpeed) / 1000;
    this.slipEnergyKj += powerKw * dt;

    const cooling = this.type.coolKw * (0.5 + 0.5 * clamp(Math.abs(vehicleSpeed) / 30, 0, 1))
      * clamp((this.tempC - this.ambientC) / 200, 0, 1.4);

    // thermalMassKj is kJ per degree C of the whole clutch pack + flywheel.
    this.tempC = clamp(
      this.tempC + ((powerKw - cooling) / this.type.thermalMassKj) * dt,
      this.ambientC, 900
    );

    // Wear is driven by slip energy, and multiplied hard once the disc is cooking.
    const heatMult = this.tempC > this.type.maxTempC * 0.75
      ? 1 + Math.pow((this.tempC - this.type.maxTempC * 0.75) / 90, 1.9) * 4
      : 1;
    const wear = powerKw * dt * this.type.wearRate * heatMult * 0.0085;
    this.health = clamp(this.health - wear, 0, 100);

    this.smoking = clamp((this.tempC - this.type.maxTempC * 0.85) / 140, 0, 1);

    if (this.tempC > this.type.maxTempC && Math.abs(this.slipSpeed) > 8) {
      this.events.push({ type: 'clutch-overheat', severity: clamp((this.tempC - this.type.maxTempC) / 160, 0, 1) });
    }
    if (this.health <= 0.5) {
      this.events.push({ type: 'clutch-failure', severity: 1 });
    }
  }

  /** A sudden pedal release under load: instantaneous shock through the driveline. */
  shockFactor(previousEngagement) {
    const d = this.engagement - previousEngagement;
    return d > 0.55 ? clamp(d, 0, 1) : 0;
  }

  drainEvents() { const e = this.events.slice(); this.events.length = 0; return e; }

  telemetry() {
    return {
      engagement: this.engagement,
      slipRpm: radToRpm(this.slipSpeed),
      transmitted: this.transmitted,
      locked: this.locked,
      tempC: this.tempC,
      health: this.health,
      capacityNm: this.capacity,
      smoking: this.smoking,
    };
  }
}

export class Gearbox {
  /**
   * @param {object} cfg { ratios:[...], finalDrive, shiftTime, type, health }
   */
  constructor(cfg) {
    this.ratios = cfg.ratios.slice();       // index 0 = 1st gear
    this.reverseRatio = cfg.reverseRatio ?? -(cfg.ratios[0] * 1.05);
    this.finalDrive = cfg.finalDrive;
    this.baseShiftTime = cfg.shiftTime ?? 0.28;
    this.efficiency = cfg.efficiency ?? 0.93;
    this.inertia = cfg.inertia ?? 0.06;     // input-shaft side
    this.maxTorqueNm = cfg.maxTorqueNm ?? 600;

    this.gear = 0;          // 0 = neutral, -1 = reverse, 1..n = forward gears
    this.targetGear = 0;
    this.shiftTimer = 0;
    this.inShift = false;
    this.health = 100;
    this.shiftStress = 0;   // 0..1 rolling indicator for HUD
    this.tempC = cfg.ambientC ?? 20;
    this.events = [];
    this.lastShiftQuality = 1;
    this.missedShift = false;
  }

  reset(healthPercent = this.health) {
    this.gear = 0; this.targetGear = 0; this.shiftTimer = 0; this.inShift = false;
    this.health = healthPercent; this.shiftStress = 0; this.events.length = 0;
    this.missedShift = false;
  }

  get gearCount() { return this.ratios.length; }

  get shiftTime() {
    const healthPenalty = 1 + (1 - clamp(this.health, 0, 100) / 100) * 1.3;
    return this.baseShiftTime * healthPenalty;
  }

  /** Total reduction from crank to wheel for a gear index. Zero in neutral. */
  ratioFor(gear) {
    if (gear === 0) return 0;
    if (gear === -1) return this.reverseRatio * this.finalDrive;
    const r = this.ratios[gear - 1];
    return r == null ? 0 : r * this.finalDrive;
  }

  get currentRatio() { return this.inShift ? 0 : this.ratioFor(this.gear); }

  /**
   * Request a gear. Returns true if the change started.
   * Nothing here prevents selecting a stupid gear — that is the point.
   */
  requestGear(g, ctx = {}) {
    if (this.inShift) return false;
    if (g === this.gear) return false;
    if (g > this.gearCount || g < -1) return false;

    // A broken gearbox sometimes refuses the gate.
    const missChance = clamp((1 - this.health / 100) * 0.55, 0, 0.5);
    if (g !== 0 && Math.random() < missChance) {
      this.missedShift = true;
      this.events.push({ type: 'missed-shift', severity: 0.4 });
      this.gear = 0;
      this.inShift = true;
      this.shiftTimer = this.shiftTime * 1.8;
      this.targetGear = 0;
      return false;
    }
    this.missedShift = false;

    // Shifting without lifting, or with the clutch still out, hurts the box.
    const clutchOut = ctx.clutchEngagement ?? 1;
    const throttle = ctx.throttle ?? 0;
    const deltaOmega = Math.abs(ctx.mismatchRad ?? 0);

    let stress = 0;
    stress += clutchOut * 0.55 * throttle;
    stress += clamp(deltaOmega / 300, 0, 1) * 0.6;
    stress += clamp((ctx.inputTorque ?? 0) / Math.max(this.maxTorqueNm, 1) - 1, 0, 2) * 0.5;
    this.shiftStress = clamp(stress, 0, 1);

    if (stress > 0.35) {
      const dmg = Math.pow(stress, 2.0) * 3.2;
      this.health = clamp(this.health - dmg, 0, 100);
      this.events.push({ type: 'trans-stress', severity: clamp(stress, 0, 1) });
    }
    this.lastShiftQuality = clamp(1 - stress, 0, 1);

    this.targetGear = g;
    this.inShift = true;
    // A clean shift with the clutch in is quick; a graunched one is slow.
    this.shiftTimer = this.shiftTime * (1 + stress * 0.9);
    return true;
  }

  update(dt, inputTorque = 0) {
    if (this.inShift) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) {
        this.gear = this.targetGear;
        this.inShift = false;
        this.shiftTimer = 0;
      }
    }
    this.shiftStress = Math.max(0, this.shiftStress - dt * 1.4);

    // Sustained torque above the box's rating slowly kills it.
    const over = Math.abs(inputTorque) - this.maxTorqueNm;
    if (over > 0) {
      this.health = clamp(this.health - (over / this.maxTorqueNm) * dt * 2.6, 0, 100);
      if (over > this.maxTorqueNm * 0.4) {
        this.events.push({ type: 'trans-overload', severity: clamp(over / this.maxTorqueNm, 0, 1) });
      }
    }
  }

  drainEvents() { const e = this.events.slice(); this.events.length = 0; return e; }

  telemetry() {
    return {
      gear: this.gear,
      gearCount: this.gearCount,
      ratio: this.ratioFor(this.gear),
      gearRatio: this.gear > 0 ? this.ratios[this.gear - 1] : 0,
      finalDrive: this.finalDrive,
      inShift: this.inShift,
      health: this.health,
      shiftStress: this.shiftStress,
    };
  }
}

export class Differential {
  constructor(cfg) {
    this.type = DIFF_TYPES[cfg.type] || DIFF_TYPES.open;
  }
  /**
   * With a single lumped driven axle the differential's job here is how well it
   * puts power down when one side is unloaded. An open diff wastes torque the
   * moment weight shifts; a spool doesn't care.
   */
  tractionMultiplier(weightImbalance = 0) {
    const t = this.type;
    const loss = (1 - t.lockFactor) * clamp(weightImbalance, 0, 1) * 0.35;
    return clamp(t.tractionBonus - loss, 0.55, 1.15);
  }
  telemetry() { return { type: this.type.id, name: this.type.name, lockFactor: this.type.lockFactor }; }
}
