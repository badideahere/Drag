// js/sim/vehicle.js
// The vehicle: the full mechanical chain, integrated at a fixed 600 Hz substep.
//
//   throttle -> engine -> torque curve -> rpm -> clutch -> gearbox -> final drive
//            -> differential -> wheels -> tires -> traction -> acceleration
//
// Everything the HUD, the dyno, the timing system and the AI read comes out of
// this integrator. There is no separate "display" value anywhere.

import { Engine } from './engine.js';
import { Clutch, Gearbox, Differential } from './drivetrain.js';
import { TireAxle, SURFACES } from './tires.js';
import { clamp, rpmToRad, radToRpm, MPS_TO_MPH, MPS_TO_KMH, M_TO_FT } from './util.js';

const G = 9.80665;
const AIR_DENSITY = 1.225;
export const SUBSTEP = 1 / 600;

/** Driver inputs. Everything that touches the car goes through this struct. */
export function makeInputs() {
  return {
    throttle: 0,      // 0..1
    brake: 0,         // 0..1
    clutch: 0,        // 0..1, 1 = pedal fully depressed (disengaged)
    shiftUp: false,
    shiftDown: false,
    selectGear: null, // number | null for direct selection
    lineLock: false,  // burnout button
    starter: false,
    launchControl: false,
  };
}

export class Vehicle {
  /**
   * @param {object} spec resolved vehicle spec (see js/sim/build.js)
   * @param {object} opts { surface, ambientC, condition }
   */
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.surface = SURFACES[opts.surface] || SURFACES.prepped;
    this.ambientC = opts.ambientC ?? 22;

    const cond = opts.condition || {};

    this.engine = new Engine({ ...spec.engine, ambientC: this.ambientC });
    this.engine.health = cond.engineHealth ?? 100;

    this.clutch = new Clutch({ ...spec.clutch, ambientC: this.ambientC });
    this.clutch.health = cond.clutchHealth ?? 100;

    this.gearbox = new Gearbox({ ...spec.gearbox, ambientC: this.ambientC });
    this.gearbox.health = cond.transmissionHealth ?? 100;

    this.diff = new Differential(spec.differential);

    const tireHealth = cond.tireHealth ?? 100;
    this.axleF = new TireAxle({
      compound: spec.tires.compound, radius: spec.tires.frontRadius ?? spec.tires.radius,
      widthMm: spec.tires.frontWidthMm ?? 225, pressurePsi: spec.tires.frontPsi ?? spec.tires.pressurePsi,
      driven: spec.drivetrain !== 'RWD', ambientC: this.ambientC, inertia: spec.tires.frontInertia ?? 1.1,
    });
    this.axleR = new TireAxle({
      compound: spec.tires.compound, radius: spec.tires.radius,
      widthMm: spec.tires.widthMm ?? 275, pressurePsi: spec.tires.pressurePsi,
      driven: spec.drivetrain !== 'FWD', ambientC: this.ambientC, inertia: spec.tires.rearInertia ?? 1.45,
    });
    this.axleF.health = tireHealth;
    this.axleR.health = tireHealth;

    // Chassis
    this.mass = spec.massKg;
    this.wheelbase = spec.wheelbaseM ?? 2.68;
    this.cgHeight = spec.cgHeightM ?? 0.52;
    this.weightDistFront = spec.weightDistFront ?? 0.55;
    this.cd = spec.cd ?? 0.34;
    this.frontalArea = spec.frontalAreaM2 ?? 2.1;
    this.brakeTorqueNm = spec.brakeTorqueNm ?? 2600;
    this.brakeBiasFront = spec.brakeBiasFront ?? 0.68;

    // Drive split
    const dt = spec.drivetrain;
    this.driveSplitFront = dt === 'FWD' ? 1 : dt === 'RWD' ? 0 : (spec.awdSplitFront ?? 0.38);
    this.drivetrainLoss = dt === 'AWD' ? 0.86 : dt === 'RWD' ? 0.90 : 0.91;

    // State
    this.position = 0;      // metres down track
    this.speed = 0;         // m/s
    this.accel = 0;         // m/s^2
    this.inputShaftOmega = 0; // used when the gearbox is in neutral
    this.launchRpmTarget = spec.tuning?.launchRpm ?? 3200;
    this.shiftRpmTarget = spec.tuning?.shiftRpm ?? spec.engine.redlineRpm * 0.95;
    this.launchControlArmed = false;

    // Derived visuals
    this.pitch = 0;         // radians, positive = nose up
    this.pitchVel = 0;
    this.suspensionF = 0;   // metres of travel, positive = compressed
    this.suspensionR = 0;
    this.wheelieHeight = 0;

    this.loadF = 0;
    this.loadR = 0;
    this.smokeRate = 0;
    this.events = [];
    this.warnings = new Map();  // key -> expiry time
    this.time = 0;
    this.prevClutchEngagement = 1;
    this.driveshaftShock = 0;
    this.lineLock = false;
    this.stalled = false;
    this.distanceFt = 0;

    // A car arrives at the track with the engine running. Pass
    // { running: false } if you want to make the driver crank it first.
    if (opts.running !== false) {
      this.engine.running = true;
      this.engine.omega = rpmToRad(spec.engine.idleRpm);
      this.engine.rpm = spec.engine.idleRpm;
    }
  }

  get drivenAxles() {
    const d = this.spec.drivetrain;
    if (d === 'FWD') return [this.axleF];
    if (d === 'RWD') return [this.axleR];
    return [this.axleF, this.axleR];
  }
  get freeAxles() {
    const d = this.spec.drivetrain;
    if (d === 'FWD') return [this.axleR];
    if (d === 'RWD') return [this.axleF];
    return [];
  }

  get drivenInertia() {
    return this.drivenAxles.reduce((s, a) => s + a.inertia, 0);
  }
  get drivenRadius() {
    const a = this.drivenAxles;
    return a.reduce((s, x) => s + x.radius, 0) / a.length;
  }
  get drivenOmega() {
    const a = this.drivenAxles;
    return a.reduce((s, x) => s + x.omega, 0) / a.length;
  }
  set drivenOmega(v) { for (const a of this.drivenAxles) a.omega = v; }

  startEngine() { this.engine.start(); this.stalled = false; }

  reset(opts = {}) {
    this.position = 0; this.speed = 0; this.accel = 0; this.time = 0;
    this.inputShaftOmega = 0; this.pitch = 0; this.pitchVel = 0;
    this.axleF.omega = 0; this.axleR.omega = 0;
    this.gearbox.reset(this.gearbox.health);
    this.engine.reset(this.engine.health);
    this.clutch.reset(this.clutch.health, this.ambientC);
    if (opts.coolTires !== false) {
      this.axleF.tempC = this.ambientC; this.axleR.tempC = this.ambientC;
    }
    this.warnings.clear();
    this.events.length = 0;
    if (opts.running !== false) {
      this.engine.running = true;
      this.engine.omega = rpmToRad(this.spec.engine.idleRpm);
      this.engine.rpm = this.spec.engine.idleRpm;
    }
  }

  warn(key, seconds = 1.6) { this.warnings.set(key, this.time + seconds); }
  activeWarnings() {
    const out = [];
    for (const [k, t] of this.warnings) { if (t > this.time) out.push(k); else this.warnings.delete(k); }
    return out;
  }

  /**
   * Advance the vehicle by dt seconds using fixed substeps.
   * @param {number} dt frame delta in seconds
   * @param {object} inputs see makeInputs()
   */
  update(dt, inputs) {
    const steps = Math.max(1, Math.min(48, Math.round(dt / SUBSTEP)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.substep(h, inputs);
    this.updateVisual(dt);
  }

  substep(dt, inp) {
    this.time += dt;
    const spec = this.spec;

    // ---------------------------------------------------------------- inputs
    if (inp.starter && !this.engine.running) this.engine.start();
    this.clutch.engagement = clamp(1 - inp.clutch, 0, 1);
    this.lineLock = !!inp.lineLock;

    let throttle = clamp(inp.throttle, 0, 1);

    // Launch control: a rev limiter held at the launch rpm while stationary.
    if (inp.launchControl && this.speed < 0.6 && spec.tuning?.launchControl) {
      if (this.engine.rpm > this.launchRpmTarget) throttle *= 0.05;
    }

    // ------------------------------------------------------- weight transfer
    const staticF = this.mass * G * this.weightDistFront;
    const staticR = this.mass * G * (1 - this.weightDistFront);
    const transfer = (this.mass * this.accel * this.cgHeight) / this.wheelbase;
    this.loadF = Math.max(staticF - transfer, 0);
    this.loadR = Math.max(staticR + transfer, 0);
    // Once the front is unloaded the car is carrying the wheels; cap the rear.
    const totalLoad = this.mass * G;
    if (this.loadF <= 1) this.loadR = totalLoad;

    // --------------------------------------------------------- tire forces
    const surfaceGrip = this.surface.grip;
    const imbalance = clamp(Math.abs(this.loadF - this.loadR) / Math.max(totalLoad, 1), 0, 1);
    const diffMult = this.diff.tractionMultiplier(imbalance);

    const fxF = this.axleF.computeForce(this.speed, this.loadF, surfaceGrip * (this.axleF.driven ? diffMult : 1));
    const fxR = this.axleR.computeForce(this.speed, this.loadR, surfaceGrip * (this.axleR.driven ? diffMult : 1));

    // ------------------------------------------------------------- gearbox
    // Requests are processed before the ratio is read so a shift takes effect now.
    this.handleShiftRequests(inp);

    const ratio = this.gearbox.currentRatio;         // crank->wheel, 0 in neutral/mid-shift
    const eff = this.gearbox.efficiency * this.drivetrainLoss;
    const rDriven = this.drivenRadius;
    const iDriven = this.drivenInertia;

    // ------------------------------------------------------------- brakes
    const brakeCmd = clamp(inp.brake, 0, 1);
    let brakeF = this.brakeTorqueNm * this.brakeBiasFront * brakeCmd;
    let brakeR = this.brakeTorqueNm * (1 - this.brakeBiasFront) * brakeCmd;
    if (this.lineLock) {
      // Line lock holds only the non-driven end so the driven tires can spin.
      if (spec.drivetrain === 'RWD') { brakeF = this.brakeTorqueNm * 1.05 * Math.max(brakeCmd, 0.85); brakeR = 0; }
      else if (spec.drivetrain === 'FWD') { brakeR = this.brakeTorqueNm * 1.05 * Math.max(brakeCmd, 0.85); brakeF = 0; }
      else {
        // AWD has no undriven end to lean on, and with both driven axles'
        // brake torque combining into one resistance the engine has to push
        // through as a single locked system, there is no brake level that
        // both holds the car still AND lets the tyres break loose — with
        // load shared across four contact patches instead of two, this
        // drivetrain has enough combined grip that genuine held wheelspin
        // from a standstill usually is not achievable at all, on or off a
        // brake. A firmer brake here only trades "the car creeps forward"
        // for "the engine stalls fighting a brake it cannot overcome" — and
        // stalling is the worse outcome for something the player did not do
        // wrong. So this stays light: enough to slow the creep, never
        // enough to be the reason the engine dies.
        const awdBrake = this.brakeTorqueNm * 0.05 * Math.max(brakeCmd, 0.85);
        brakeF = awdBrake; brakeR = awdBrake;
      }
    }

    // ------------------------------------------------------------- clutch
    const engineOmega = this.engine.omega;
    let inputOmega, driveInertia, loadTorqueAtInput;

    if (ratio !== 0) {
      inputOmega = this.drivenOmega * ratio;
      driveInertia = this.gearbox.inertia + iDriven / (ratio * ratio);
      // Everything resisting the driven wheels, reflected up to the input shaft.
      const drivenFx = this.drivenAxles.reduce((s, a) => s + a.force, 0);
      const drivenBrake = this.drivenAxles.reduce(
        (s, a) => s + (a === this.axleF ? brakeF : brakeR), 0);
      const wheelResist = drivenFx * rDriven + Math.sign(this.drivenOmega || 1) * drivenBrake;
      loadTorqueAtInput = wheelResist / (ratio * eff);
    } else {
      inputOmega = this.inputShaftOmega;
      driveInertia = this.gearbox.inertia;
      loadTorqueAtInput = this.inputShaftOmega * 0.012; // idle drag on a free shaft
    }

    const engineNetTorque = this.engine.running
      ? (this.engine.indicatedTorque - this.engine.frictionTorque(this.engine.rpm))
      : -this.engine.frictionTorque(this.engine.rpm) * 1.6;

    // A dead engine sitting almost still is not a mechanical fight worth
    // resolving through the full lock/slip solve. Right at zero relative
    // speed that solve is not well-conditioned: it can flip between "locked"
    // and "slipping" every substep as tiny load-torque feedback pushes the
    // sign of the slip back and forth, and each mode integrates the wheel
    // completely differently — the result is a chattering engine and a car
    // that visibly, wrongly creeps. There is nothing to fight over here:
    // let the crank and the wheels settle independently.
    const engineDeadAndSlow = !this.engine.running
      && Math.abs(this.speed) < 0.3
      && Math.abs(radToRpm(engineOmega)) < 250;

    const sol = engineDeadAndSlow
      ? (() => {
        this.clutch.locked = false;
        this.clutch.transmitted = 0;
        this.clutch.slipSpeed = engineOmega - inputOmega;
        return { locked: false, torque: 0 };
      })()
      : this.clutch.solve({
        engineOmega, inputOmega,
        engineTorque: engineNetTorque,
        engineInertia: this.engine.inertia,
        driveInertia,
        loadTorque: loadTorqueAtInput,
        dt,
      });

    // Clutch dump detection — a hard release under load shocks the driveline.
    const shock = this.clutch.shockFactor(this.prevClutchEngagement);
    if (shock > 0 && this.engine.rpm > 2000 && ratio !== 0) {
      this.driveshaftShock = shock * clamp(this.engine.rpm / 6000, 0, 1.4);
      this.events.push({ type: 'clutch-dump', severity: this.driveshaftShock });
      // Shock loads the gearbox.
      this.gearbox.health = clamp(
        this.gearbox.health - Math.pow(this.driveshaftShock, 2) * 1.1, 0, 100);
    }
    this.prevClutchEngagement = this.clutch.engagement;
    this.driveshaftShock = Math.max(0, this.driveshaftShock - dt * 4);

    // --------------------------------------------------------- integration
    let forcedOmega = null;

    if (sol.locked && ratio !== 0) {
      // Rigid: engine speed is dictated by the wheels through the gearset.
      // This is where a money shift physically over-revs the engine.
      const newInputOmega = inputOmega + sol.sharedAlpha * dt;
      this.drivenOmega = newInputOmega / ratio;
      forcedOmega = newInputOmega;
      // Free (undriven) axle rolls with the car.
      for (const a of this.freeAxles) this.integrateFreeAxle(a, dt, a === this.axleF ? brakeF : brakeR);
    } else {
      // Slipping (or neutral): both sides integrate independently.
      const clutchTorque = sol.torque;
      if (engineDeadAndSlow) {
        // Nothing is driving these wheels and nothing is worth tracking on
        // the crank side either — let every wheel just roll with the car,
        // the same stable way a free (undriven) axle already does. The
        // explicit integration below is fine once there is real drive
        // torque or load to damp it; with zero torque and a small wheel
        // inertia fighting a stiff tyre model entirely alone, it resonates.
        for (const a of this.drivenAxles) this.integrateFreeAxle(a, dt, a === this.axleF ? brakeF : brakeR);
        if (ratio !== 0) this.inputShaftOmega = this.drivenOmega * ratio;
      } else if (ratio !== 0) {
        const wheelDriveTorque = clutchTorque * ratio * eff;
        const share = 1 / this.drivenAxles.length;
        for (const a of this.drivenAxles) {
          const br = (a === this.axleF ? brakeF : brakeR);
          const brakeTq = Math.sign(a.omega || (wheelDriveTorque || 1)) * br;
          let alpha = (wheelDriveTorque * share - a.force * a.radius - brakeTq) / a.inertia;
          const next = a.omega + alpha * dt;
          // Brakes can hold a wheel but not reverse it.
          a.omega = (a.omega > 0 && next < 0 && br > 0 && wheelDriveTorque <= 0) ? 0 : next;
        }
        this.inputShaftOmega = this.drivenOmega * ratio;
      } else {
        // Neutral: the input shaft spins freely, wheels just roll/brake.
        const alphaIn = (clutchTorque - loadTorqueAtInput) / Math.max(driveInertia, 0.01);
        this.inputShaftOmega += alphaIn * dt;
        for (const a of this.drivenAxles) this.integrateFreeAxle(a, dt, a === this.axleF ? brakeF : brakeR);
      }
      for (const a of this.freeAxles) this.integrateFreeAxle(a, dt, a === this.axleF ? brakeF : brakeR);
    }

    // ------------------------------------------------------------- engine
    this.engine.airflowValue = clamp(this.speed / 28, 0, 1.4);
    this.engine.step(dt, {
      throttle,
      clutchTorque: sol.locked ? 0 : sol.torque,
      forcedOmega,
      ignitionOn: true,
    });

    // -------------------------------------------------------- vehicle body
    const tractionForce = fxF + fxR;
    const drag = 0.5 * AIR_DENSITY * this.cd * this.frontalArea * this.speed * Math.abs(this.speed);
    const rrCoeff = (this.axleF.compound.rollingResist + this.axleR.compound.rollingResist) / 2;
    const rolling = rrCoeff * this.mass * G * Math.sign(this.speed) * clamp(Math.abs(this.speed) / 1.2, 0, 1);

    let netForce = tractionForce - drag - rolling;

    // Static friction: a stationary car does not creep from whatever residual
    // force a dead engine's own friction (still nominally coupled through a
    // fully engaged clutch) happens to leave on the driven wheels. Real tyres
    // have a breakaway threshold comfortably above their rolling resistance;
    // without one here, a handful of newtons — orders of magnitude below any
    // real drive force — could integrate into an endless, unphysical creep.
    // A real launch clears this in the very first substep; nothing else does.
    const stictionN = this.mass * G * 0.006;
    if (Math.abs(this.speed) < 0.05 && Math.abs(netForce) < stictionN) {
      this.speed = 0;
      netForce = 0;
    }

    // Static hold: with the brakes on and nothing driving, don't creep.
    if (Math.abs(this.speed) < 0.08 && brakeCmd > 0.15 && Math.abs(tractionForce) < this.mass * G * 0.6) {
      this.speed = 0;
      netForce = 0;
    }

    const a = netForce / this.mass;
    this.accel = a;
    this.speed += a * dt;
    if (Math.abs(this.speed) < 1e-4) this.speed = 0;
    this.position += this.speed * dt;
    this.distanceFt = this.position * M_TO_FT;

    // ------------------------------------------------- component updates
    this.clutch.update(dt, this.speed);
    this.gearbox.update(dt, Math.abs(this.clutch.transmitted));
    this.axleF.update(dt, this.speed, this.ambientC);
    this.axleR.update(dt, this.speed, this.ambientC);

    this.smokeRate = Math.max(this.axleF.driven ? this.axleF.smoke : 0,
      this.axleR.driven ? this.axleR.smoke : 0);

    this.collectEvents();
  }

  integrateFreeAxle(a, dt, brakeTorque) {
    // A rolling wheel tracks the car unless the brake locks it.
    const rollOmega = this.speed / a.radius;
    const lockCapacity = a.mu(this.surface.grip) * a.load * a.radius;
    if (brakeTorque >= lockCapacity && Math.abs(this.speed) > 0.05) {
      a.omega = Math.max(0, a.omega - (brakeTorque / a.inertia) * dt);
    } else {
      a.omega += (rollOmega - a.omega) * clamp(dt * 45, 0, 1);
    }
  }

  handleShiftRequests(inp) {
    const ctx = {
      clutchEngagement: this.clutch.engagement,
      throttle: this.engine.throttle,
      inputTorque: Math.abs(this.clutch.transmitted),
      mismatchRad: 0,
    };
    let target = null;
    if (inp.selectGear != null) { target = inp.selectGear; inp.selectGear = null; }
    else if (inp.shiftUp) { target = Math.min(this.gearbox.gear + 1, this.gearbox.gearCount); inp.shiftUp = false; }
    else if (inp.shiftDown) { target = Math.max(this.gearbox.gear - 1, -1); inp.shiftDown = false; }
    if (target == null) return;

    // How badly mismatched will the engine be in the requested gear?
    const newRatio = this.gearbox.ratioFor(target);
    if (newRatio !== 0) {
      const wouldBe = this.drivenOmega * newRatio;
      ctx.mismatchRad = wouldBe - this.engine.omega;
      const wouldBeRpm = radToRpm(Math.abs(wouldBe));
      if (wouldBeRpm > this.spec.engine.maxSafeRpm) this.warn('MONEY SHIFT', 2.4);
    }
    this.gearbox.requestGear(target, ctx);
  }

  collectEvents() {
    for (const e of this.engine.drainEvents()) {
      this.events.push(e);
      if (e.type === 'overrev-warn') this.warn('ENGINE OVER-REV');
      else if (e.type === 'valvetrain') this.warn('VALVETRAIN DAMAGE', 2.5);
      else if (e.type === 'catastrophic') this.warn('ENGINE DAMAGE', 3);
      else if (e.type === 'engine-failure') this.warn('ENGINE FAILURE', 8);
      else if (e.type === 'overheat') this.warn('ENGINE OVERHEATING', 2);
      else if (e.type === 'stall') { this.warn('STALLED', 3); this.stalled = true; }
    }
    for (const e of this.clutch.drainEvents()) {
      this.events.push(e);
      if (e.type === 'clutch-overheat') this.warn('CLUTCH HOT', 2);
      if (e.type === 'clutch-failure') this.warn('CLUTCH FAILED', 6);
    }
    for (const e of this.gearbox.drainEvents()) {
      this.events.push(e);
      if (e.type === 'trans-stress') this.warn('TRANSMISSION STRESS', 1.8);
      if (e.type === 'trans-overload') this.warn('TRANSMISSION OVERLOAD', 2);
      if (e.type === 'missed-shift') this.warn('MISSED SHIFT', 1.5);
    }
    if (this.engine.limiterActive) this.warn('REV LIMITER', 0.4);
    if (this.axleF.tempC > this.axleF.compound.optC + 60 || this.axleR.tempC > this.axleR.compound.optC + 60) {
      this.warn('TIRES OVERHEATED', 1.5);
    }
  }

  /** Visual-only state: body pitch and suspension travel follow real acceleration. */
  updateVisual(dt) {
    const targetPitch = clamp(this.accel * 0.0085, -0.09, 0.14);
    const k = 42, c = 9.2;
    const force = (targetPitch - this.pitch) * k - this.pitchVel * c;
    this.pitchVel += force * dt;
    this.pitch += this.pitchVel * dt;

    const loadRatioF = this.loadF / Math.max(this.mass * G * this.weightDistFront, 1);
    const loadRatioR = this.loadR / Math.max(this.mass * G * (1 - this.weightDistFront), 1);
    this.suspensionF += ((loadRatioF - 1) * 0.055 - this.suspensionF) * clamp(dt * 12, 0, 1);
    this.suspensionR += ((loadRatioR - 1) * 0.06 - this.suspensionR) * clamp(dt * 12, 0, 1);
    this.wheelieHeight = this.loadF < 400 ? clamp((400 - this.loadF) / 400, 0, 1) * 0.28 : 0;
  }

  // -------------------------------------------------------------- readouts
  get speedMph() { return this.speed * MPS_TO_MPH; }
  get speedKmh() { return this.speed * MPS_TO_KMH; }

  telemetry() {
    const ratio = this.gearbox.ratioFor(this.gearbox.gear);
    const wheelTorque = this.clutch.transmitted * ratio * this.gearbox.efficiency * this.drivetrainLoss;
    return {
      time: this.time,
      position: this.position,
      distanceFt: this.distanceFt,
      speed: this.speed,
      speedMph: this.speedMph,
      speedKmh: this.speedKmh,
      accel: this.accel,
      accelG: this.accel / G,
      engine: this.engine.telemetry(),
      clutch: this.clutch.telemetry(),
      gearbox: this.gearbox.telemetry(),
      diff: this.diff.telemetry(),
      tiresFront: this.axleF.telemetry(),
      tiresRear: this.axleR.telemetry(),
      loadF: this.loadF,
      loadR: this.loadR,
      wheelTorque,
      wheelRpm: radToRpm(this.drivenOmega),
      slip: this.drivenAxles.reduce((s, a) => s + Math.abs(a.slipRatio), 0) / this.drivenAxles.length,
      smoke: this.smokeRate,
      warnings: this.activeWarnings(),
      stalled: !this.engine.running,
    };
  }

  /** Persisted condition, written back to the cloud save after a run. */
  condition() {
    return {
      engineHealth: this.engine.health,
      transmissionHealth: this.gearbox.health,
      clutchHealth: this.clutch.health,
      tireHealth: Math.min(this.axleF.health, this.axleR.health),
    };
  }
}
