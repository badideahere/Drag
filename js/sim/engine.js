// js/sim/engine.js
// Engine simulation: torque curve, forced induction, thermal model, health & over-rev damage.
// All torque values are in Newton-metres at the crankshaft. All speeds in rad/s unless named *Rpm.

import { lerp, clamp, rpmToRad, radToRpm } from './util.js';

const KPA_ATM = 101.325;

/**
 * Interpolate a torque curve. Curve is an array of [rpm, torqueNm] pairs, ascending by rpm.
 * Returns naturally-aspirated torque at the given rpm, extrapolating flat past the ends.
 */
export function curveTorque(curve, rpm) {
  if (!curve || curve.length === 0) return 0;
  if (rpm <= curve[0][0]) {
    // Below the first point, fall away toward zero at 0 rpm so idle behaves sanely.
    const f = clamp(rpm / Math.max(curve[0][0], 1), 0, 1);
    return curve[0][1] * (0.35 + 0.65 * f);
  }
  if (rpm >= curve[curve.length - 1][0]) {
    // Past the last point, power falls off rather than staying flat.
    const last = curve[curve.length - 1];
    const over = (rpm - last[0]) / Math.max(last[0] * 0.25, 500);
    return last[1] * clamp(1 - 0.55 * over, 0.15, 1);
  }
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1];
    if (rpm >= a[0] && rpm <= b[0]) {
      const t = (rpm - a[0]) / (b[0] - a[0]);
      // Smoothstep keeps the curve from looking like a polygon on the dyno.
      const s = t * t * (3 - 2 * t);
      return lerp(a[1], b[1], s);
    }
  }
  return curve[curve.length - 1][1];
}

/** Horsepower derived from torque, never stored independently. */
export function torqueToHp(torqueNm, rpm) {
  // kW = Nm * rad/s / 1000 ; hp = kW / 0.7457
  return (torqueNm * rpmToRad(rpm)) / 1000 / 0.7457;
}

export function peakOutputs(spec, sampleStep = 100) {
  const probe = new Engine(spec);
  let bestTq = 0, bestTqRpm = 0, bestHp = 0, bestHpRpm = 0;
  for (let rpm = spec.idleRpm; rpm <= spec.redlineRpm; rpm += sampleStep) {
    const tq = probe.steadyStateTorque(rpm, 1.0);
    const hp = torqueToHp(tq, rpm);
    if (tq > bestTq) { bestTq = tq; bestTqRpm = rpm; }
    if (hp > bestHp) { bestHp = hp; bestHpRpm = rpm; }
  }
  return { peakTorqueNm: bestTq, peakTorqueRpm: bestTqRpm, peakHp: bestHp, peakHpRpm: bestHpRpm };
}

export class Engine {
  /**
   * @param {object} spec resolved engine spec (after upgrades & tuning are applied)
   */
  constructor(spec) {
    this.spec = spec;

    this.rpm = 0;
    this.omega = 0;            // rad/s
    this.running = false;
    this.starting = 0;         // seconds of cranking remaining
    this.throttle = 0;         // 0..1 driver input
    this.effectiveThrottle = 0;// after limiter cut / throttle map
    this.load = 0;             // 0..1 normalised

    this.torque = 0;           // net crank torque this step (Nm)
    this.indicatedTorque = 0;  // combustion torque before friction
    this.hp = 0;

    // Forced induction
    this.boostKpa = 0;         // gauge pressure, kPa
    this.spool = 0;            // 0..1 turbo shaft energy fraction
    this.wastegateOpen = 0;    // 0..1
    this.blowOff = 0;          // transient flag for audio

    // Thermal
    this.coolantC = spec.ambientC ?? 20;
    this.oilC = spec.ambientC ?? 20;
    this.intakeC = spec.ambientC ?? 20;

    // Health / damage
    this.health = 100;
    this.overRev = 0;          // 0..1 severity indicator for HUD
    this.limiterActive = false;
    this.knock = 0;
    this.overRevPeak = 0;
    this.damageEvents = [];

    this.inertia = spec.inertia ?? 0.22; // kg m^2 (crank + flywheel)
  }

  reset(healthPercent = this.health) {
    this.rpm = 0; this.omega = 0; this.running = false; this.starting = 0;
    this.boostKpa = 0; this.spool = 0; this.overRev = 0; this.knock = 0;
    this.coolantC = this.spec.ambientC ?? 20;
    this.oilC = this.spec.ambientC ?? 20;
    this.health = healthPercent;
    this.damageEvents.length = 0;
  }

  start() {
    if (this.running || this.starting > 0) return;
    this.starting = 0.65;
  }

  stall() {
    this.running = false;
    this.omega = 0;
    this.rpm = 0;
    this.boostKpa = 0;
    this.spool = 0;
  }

  get healthFactor() {
    // 100% health = full power. Falls off, and gets ugly below 40%.
    const h = clamp(this.health, 0, 100) / 100;
    return clamp(0.35 + 0.65 * Math.pow(h, 0.6), 0.2, 1);
  }

  get thermalFactor() {
    const s = this.spec;
    const over = this.coolantC - (s.thermalLimitC ?? 108);
    if (over <= 0) {
      // Cold engines make slightly less power too.
      const cold = (s.warmC ?? 82) - this.coolantC;
      if (cold > 0) return clamp(1 - cold * 0.0015, 0.88, 1);
      return 1;
    }
    return clamp(1 - over * 0.012, 0.45, 1);
  }

  /** Maximum boost the setup can physically make at this rpm/load. */
  boostCeiling(rpm, load) {
    const s = this.spec;
    if (s.aspiration === 'turbo') {
      const t = s.turbo;
      // Flow-based ceiling: small turbos hit target early, big ones need rpm.
      const spoolRpm = t.spoolRpm ?? 3000;
      const flow = clamp((rpm - spoolRpm * 0.45) / (spoolRpm * 1.15), 0, 1);
      const capable = t.maxBoostKpa * Math.pow(flow, 0.85) * clamp(0.25 + 0.75 * load, 0, 1);
      return Math.min(capable, t.targetBoostKpa);
    }
    if (s.aspiration === 'supercharged') {
      const sc = s.supercharger;
      const f = clamp((rpm - (sc.engageRpm ?? 900)) / ((sc.fullRpm ?? 4200) - (sc.engageRpm ?? 900)), 0, 1);
      // Belt-driven: boost tracks rpm almost immediately, load modulates it only a little.
      return sc.maxBoostKpa * f * clamp(0.45 + 0.55 * load, 0, 1);
    }
    return 0;
  }

  /** Parasitic drag from a belt-driven blower, in Nm. */
  superchargerDrag() {
    if (this.spec.aspiration !== 'supercharged') return 0;
    const sc = this.spec.supercharger;
    return (this.boostKpa / 100) * (sc.parasiticNm ?? 45);
  }

  /** Torque multiplier from manifold pressure, including intercooler / heat soak. */
  boostMultiplier() {
    if (this.boostKpa <= 0) return 1;
    const s = this.spec;
    const ic = s.intercooler ?? { effectiveness: 0.55, capacityKw: 20 };
    // Charge temperature rise before the intercooler
    const pressureRatio = (KPA_ATM + this.boostKpa) / KPA_ATM;
    const adiabaticRise = (s.ambientC ?? 20 + 273) * (Math.pow(pressureRatio, 0.286) - 1);
    const postIcRise = adiabaticRise * (1 - clamp(ic.effectiveness, 0, 0.95));
    this.intakeC = (s.ambientC ?? 20) + postIcRise + this.heatSoakC;
    // Density gain, derated by charge temperature and by knock when it's hot.
    const densityGain = pressureRatio * ((s.ambientC ?? 20) + 273) / (this.intakeC + 273);
    const knockDerate = 1 - this.knock * 0.25;
    return clamp(1 + (densityGain - 1) * 0.92 * knockDerate, 1, 4.5);
  }

  get heatSoakC() {
    return clamp((this.coolantC - (this.spec.warmC ?? 82)) * 0.5, 0, 45);
  }

  /** Steady-state crank torque at a given rpm and throttle — used by the dyno. */
  steadyStateTorque(rpm, throttle) {
    const saved = {
      boost: this.boostKpa, spool: this.spool, intake: this.intakeC,
    };
    this.boostKpa = this.boostCeiling(rpm, throttle);
    const brake = curveTorque(this.spec.torqueCurve, rpm) * this.boostMultiplier() * this.healthFactor;
    const t = brake * throttle - this.superchargerDrag();
    this.boostKpa = saved.boost; this.spool = saved.spool; this.intakeC = saved.intake;
    return Math.max(t, 0);
  }

  frictionTorque(rpm) {
    const s = this.spec;
    const base = s.frictionNm ?? 18;
    // Pumping + mechanical losses climb with rpm.
    return base + rpm * (s.frictionSlope ?? 0.0055);
  }

  /**
   * Advance the engine one substep.
   * @param {number} dt seconds
   * @param {object} io { throttle, clutchTorque (Nm resisting the crank), forcedOmega|null, ignitionOn }
   */
  step(dt, io) {
    const s = this.spec;
    this.throttle = clamp(io.throttle ?? 0, 0, 1);

    // --- Starter -----------------------------------------------------------
    if (this.starting > 0) {
      this.starting -= dt;
      this.omega = Math.max(this.omega, rpmToRad(260));
      if (this.starting <= 0) { this.running = true; this.omega = rpmToRad(s.idleRpm * 0.85); }
    }

    // --- Rev limiter -------------------------------------------------------
    // The limiter is a fuel/spark cut on the *engine*, not a clamp on rpm.
    // If the drivetrain forces the crank faster (money shift), the limiter cannot help.
    this.limiterActive = this.running && this.rpm > s.limiterRpm;
    let mapped = this.mapThrottle(this.throttle);
    if (this.limiterActive) {
      // Hard fuel cut with a stutter — it bounces off the limiter rather than
      // easing through it, but it can do nothing about being driven from the wheels.
      const over = this.rpm - s.limiterRpm;
      mapped *= over > 120 ? 0 : (Math.random() < 0.22 ? 0.45 : 0);
    }

    // --- Idle control ------------------------------------------------------
    if (this.running && this.rpm < s.idleRpm + 350 && this.throttle < 0.06) {
      const deficit = clamp((s.idleRpm + 120 - this.rpm) / 600, 0, 1);
      mapped = Math.max(mapped, deficit * 0.28);
    }
    this.effectiveThrottle = mapped;

    // --- Forced induction dynamics ----------------------------------------
    this.load = clamp(mapped * clamp(this.rpm / Math.max(s.peakTorqueRpmHint ?? 4000, 1000), 0.2, 1.2), 0, 1);
    this.updateBoost(dt, mapped);

    // --- Torque production -------------------------------------------------
    // The torque curve is BRAKE torque (what a dyno measures). Friction is added
    // back in before the throttle scales it, so wide-open throttle reproduces the
    // curve exactly and a shut throttle leaves pure engine braking behind.
    let friction = this.frictionTorque(this.rpm) + this.superchargerDrag();
    if (!this.running) friction *= 1.6; // dragging a dead engine costs more

    let brake = 0;
    if (this.running) {
      brake = curveTorque(s.torqueCurve, this.rpm) * this.boostMultiplier()
        * this.healthFactor * this.thermalFactor;
      // Valve float above a mechanically forced over-rev.
      if (this.rpm > s.floatRpm) {
        brake *= clamp(1 - (this.rpm - s.floatRpm) / 1500, 0, 1);
      }
    }
    const combustion = (brake + friction) * mapped;
    this.indicatedTorque = combustion;
    const net = combustion - friction;

    // --- Crank dynamics ----------------------------------------------------
    if (io.forcedOmega != null) {
      // Clutch is locked: the drivetrain dictates crank speed. This is where
      // a money shift can physically throw the engine past the limiter.
      this.omega = Math.max(io.forcedOmega, 0);
    } else {
      const alpha = (net - (io.clutchTorque ?? 0)) / this.inertia;
      this.omega += alpha * dt;
      if (this.omega < 0) this.omega = 0;
    }

    this.rpm = radToRpm(this.omega);
    this.torque = net;
    this.hp = torqueToHp(Math.max(net, 0), this.rpm);

    // --- Stall detection ---------------------------------------------------
    if (this.running && this.rpm < (s.stallRpm ?? 380) && this.starting <= 0) {
      this.stall();
      this.damageEvents.push({ type: 'stall', severity: 0 });
    }

    this.updateThermal(dt);
    this.updateOverRev(dt);
  }

  mapThrottle(t) {
    const map = this.spec.throttleMap ?? 'linear';
    if (map === 'progressive') return Math.pow(t, 1.6);
    if (map === 'aggressive') return Math.pow(t, 0.62);
    return t;
  }

  updateBoost(dt, throttle) {
    const s = this.spec;
    if (s.aspiration === 'na') { this.boostKpa = 0; this.spool = 0; return; }

    if (s.aspiration === 'supercharged') {
      const target = this.boostCeiling(this.rpm, throttle);
      // Belt drive: essentially instant, tiny lag from manifold volume only.
      this.boostKpa += (target - this.boostKpa) * clamp(dt / 0.06, 0, 1);
      this.spool = clamp(this.boostKpa / Math.max(s.supercharger.maxBoostKpa, 1), 0, 1);
      return;
    }

    const t = s.turbo;
    const ceiling = this.boostCeiling(this.rpm, throttle);
    // Exhaust energy available to spin the turbine
    const exhaustEnergy = clamp((this.rpm / (t.spoolRpm ?? 3000)) * (0.15 + 0.85 * throttle), 0, 1.6);
    const spoolTarget = clamp(exhaustEnergy, 0, 1);
    // Larger turbos have more rotational inertia -> longer lag.
    const spoolTau = t.lagSeconds ?? 0.55;
    const decayTau = (t.lagSeconds ?? 0.55) * 1.8;
    const tau = spoolTarget > this.spool ? spoolTau : decayTau;
    this.spool += (spoolTarget - this.spool) * clamp(dt / tau, 0, 1);

    let raw = ceiling * this.spool;

    // Wastegate: bleeds anything over the target, with a little overshoot (spring creep).
    const target = t.targetBoostKpa;
    if (raw > target) {
      this.wastegateOpen = clamp((raw - target) / 30, 0, 1);
      raw = target + (raw - target) * 0.18 * (1 - this.wastegateOpen * 0.8);
    } else {
      this.wastegateOpen = 0;
    }

    // Blow-off on throttle lift while under boost.
    if (throttle < 0.12 && this.boostKpa > 25) {
      this.blowOff = 0.18;
      raw = 0;
    }
    if (this.blowOff > 0) this.blowOff -= dt;

    const fill = raw > this.boostKpa ? 0.10 : 0.07;
    this.boostKpa += (raw - this.boostKpa) * clamp(dt / fill, 0, 1);
    this.boostKpa = Math.max(this.boostKpa, 0);
  }

  updateThermal(dt) {
    const s = this.spec;
    const ambient = s.ambientC ?? 20;
    // Heat in scales with actual power produced.
    const powerKw = Math.max(this.hp, 0) * 0.7457;
    const heatIn = powerKw * 1.6;                       // kW of waste heat reaching coolant
    const coolingCap = (s.coolingKw ?? 55) * (0.35 + 0.65 * clamp(this.airflow, 0, 1.4));
    const dT = (heatIn - coolingCap * clamp((this.coolantC - ambient) / 80, 0, 1.3)) / (s.thermalMassKj ?? 42);
    this.coolantC = clamp(this.coolantC + dT * dt, ambient, 180);
    this.oilC += ((this.coolantC + 12) - this.oilC) * clamp(dt / 6, 0, 1);

    // Knock builds when it's hot and boosted, and washes out when it cools.
    const knockThreshold = (s.thermalLimitC ?? 108) - 6;
    if (this.coolantC > knockThreshold && this.boostKpa > 20) {
      this.knock = clamp(this.knock + dt * 0.35, 0, 1);
    } else {
      this.knock = clamp(this.knock - dt * 0.5, 0, 1);
    }

    // Sustained overheating damages the engine.
    if (this.coolantC > (s.thermalLimitC ?? 108) + 12) {
      const sev = (this.coolantC - (s.thermalLimitC ?? 108) - 12) / 30;
      this.health = clamp(this.health - sev * dt * 2.4, 0, 100);
      if (sev > 0.6) this.damageEvents.push({ type: 'overheat', severity: sev });
    }
  }

  /** Set by the vehicle each step: 0 at a standstill, ~1 at highway speed. */
  set airflowValue(v) { this._airflow = v; }
  get airflow() { return this._airflow ?? 0; }

  updateOverRev(dt) {
    const s = this.spec;
    const safe = s.maxSafeRpm;
    const k = s.overRevSensitivity ?? 1;

    if (this.rpm <= safe) {
      this.overRev = Math.max(0, this.overRev - dt * 2);
      // Coming back down below the safe line closes the event. The real damage
      // from a money shift happens in that fraction of a second, not over time,
      // so it is applied here from how far the engine actually went.
      if (this.overRevPeak > 0) {
        const over = this.overRevPeak;
        const hit = Math.pow(over / 1000, 2.2) * 45 * k;
        this.health = clamp(this.health - hit, 0, 100);
        if (over > 250 && over <= 900) {
          this.damageEvents.push({ type: 'overrev-warn', severity: over / 1000 });
        } else if (over > 900 && over <= 2000) {
          this.damageEvents.push({ type: 'valvetrain', severity: over / 2000 });
        } else if (over > 2000) {
          this.damageEvents.push({ type: 'catastrophic', severity: clamp(over / 3500, 0, 1) });
          if (Math.random() < clamp((over - 2000) / 2200, 0, 0.9)) this.health = 0;
        }
        if (this.health <= 0) {
          this.running = false;
          this.damageEvents.push({ type: 'engine-failure', severity: 1 });
        }
        this.overRevPeak = 0;
      }
      return;
    }

    const over = this.rpm - safe;
    this.overRevPeak = Math.max(this.overRevPeak, over);
    this.overRev = clamp(over / (s.floatRpm - safe + 800), 0, 1);

    // Sustained over-rev keeps eating health on top of the one-shot hit above.
    const rate = Math.pow(over / 1000, 2.1) * 30 * k;
    this.health = clamp(this.health - rate * dt, 0, 100);
    if (over > 250) this.damageEvents.push({ type: 'overrev-warn', severity: clamp(over / 1000, 0, 1) });
    if (this.health <= 0) {
      this.running = false;
      this.damageEvents.push({ type: 'engine-failure', severity: 1 });
    }
  }

  drainEvents() {
    const e = this.damageEvents.slice();
    this.damageEvents.length = 0;
    return e;
  }

  telemetry() {
    return {
      rpm: this.rpm,
      throttle: this.throttle,
      effectiveThrottle: this.effectiveThrottle,
      load: this.load,
      torque: this.torque,
      indicatedTorque: this.indicatedTorque,
      hp: this.hp,
      boostKpa: this.boostKpa,
      boostPsi: this.boostKpa * 0.145038,
      spool: this.spool,
      coolantC: this.coolantC,
      oilC: this.oilC,
      intakeC: this.intakeC,
      health: this.health,
      running: this.running,
      limiter: this.limiterActive,
      overRev: this.overRev,
      knock: this.knock,
    };
  }
}
