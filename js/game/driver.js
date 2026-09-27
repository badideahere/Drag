// js/game/driver.js
// Driver assists and the AI driver.
//
// Arcade and Manual modes borrow pieces of this (auto-clutch, auto-shift).
// The AI uses the whole thing. Critically, the AI drives the *same* Vehicle
// class through the *same* inputs a human uses — it has no shortcut to speed.

import { clamp, lerp, makeRng, gauss, radToRpm } from '../sim/util.js';

/**
 * Operates the clutch pedal so the player doesn't have to.
 * It is a controller, not a cheat: it produces a pedal position and the
 * clutch model decides what that does.
 */
export class AutoClutch {
  constructor(spec) {
    this.spec = spec;
    this.pedal = 1;         // 1 = fully depressed
    this.launchTimer = 0;
    this.launchDone = false;
  }

  reset() { this.pedal = 1; this.launchTimer = 0; this.launchDone = false; }

  /**
   * @returns clutch pedal 0..1
   */
  update(dt, v, throttle, opts = {}) {
    const rpm = v.engine.rpm;
    const idle = this.spec.engine.idleRpm;
    const gear = v.gearbox.gear;
    const speed = v.speed;
    const aggression = opts.aggression ?? 1;

    if (gear === 0) { this.pedal = 1; return this.pedal; }

    // Mid-shift: pull the clutch, then let it back in.
    if (v.gearbox.inShift) {
      this.pedal = 1;
      return this.pedal;
    }

    // A deliberate burnout is not a launch and must not be treated like one.
    // The normal ramp below feeds the clutch in gradually and backs it off
    // again whenever rpm hasn't caught up to the launch target — logic that
    // exists to protect a car that is trying to get moving. A line-locked
    // burnout is never trying to get moving: the wheel is meant to spin
    // freely against a brake holding the other end of the car, exactly like
    // a driver who has simply locked the clutch and is working the throttle
    // and brake. Running it through the launch ramp instead fights the
    // engine with a slipping clutch's load right as revs are still building,
    // which bogs it before the wheel ever gets to actually spin.
    if (opts.lineLock) {
      this.launchTimer = 0;
      this.pedal += (0 - this.pedal) * clamp(dt * 16, 0, 1);
      return this.pedal;
    }

    // Moving normally: clutch stays out.
    if (speed > 3) {
      this.launchDone = true;
      // Unless the engine is about to stall from a bad downshift.
      const target = rpm < idle * 1.15 ? 0.7 : 0;
      this.pedal += (target - this.pedal) * clamp(dt * 14, 0, 1);
      return this.pedal;
    }

    // Standing start.
    const launchRpm = opts.launchRpm ?? this.spec.tuning.launchRpm;
    if (throttle < 0.05 && speed < 0.4) {
      this.launchTimer = 0;
      this.pedal += (1 - this.pedal) * clamp(dt * 10, 0, 1);
      return this.pedal;
    }

    // The pedal comes up on a timed ramp — a real driver does not sit at the
    // bite point waiting for the tacho. Engine speed error only modulates it:
    // bogging buys a little more slip, flaring lets it out faster.
    //
    // This range has to span from a cautious street launch (over a second of
    // controlled slip) down to a genuinely fast dump (a tenth of a second) —
    // if the floor sits too high, driver skill stops showing up in reaction
    // time at all, because the fixed mechanical delay swamps it.
    this.launchTimer += dt;
    const engageTime = lerp(1.35, 0.10, clamp(aggression, 0, 1));
    const ramp = clamp(1 - this.launchTimer / engageTime, 0, 1);

    // Hold the crank near the launch rpm. Below it the driver feeds in more slip
    // rather than letting the engine bog; above it the pedal comes up faster.
    // A confident (high-aggression) driver trusts the revs they already held
    // going into the light and leans on this protection much less — it is
    // there to save a cautious or unskilled driver from stalling it, not to
    // cap how fast anyone is allowed to leave.
    const caution = 1 - clamp(aggression, 0, 1);
    const bogLine = Math.max(launchRpm * 0.55, idle * 1.9);
    const err = (rpm - launchRpm) / Math.max(launchRpm, 1);
    let correction = clamp(-err * 0.9, -0.30, 0.45) * lerp(0.35, 1, caution);
    if (rpm < bogLine) correction += clamp((bogLine - rpm) / bogLine, 0, 1) * 0.75 * lerp(0.4, 1, caution);
    const wanted = clamp(ramp + correction, 0, 1);

    const rate = wanted < this.pedal ? lerp(20, 9, caution) : lerp(24, 14, caution);
    this.pedal += (wanted - this.pedal) * clamp(dt * rate, 0, 1);
    this.pedal = clamp(this.pedal, 0, 1);
    return this.pedal;
  }
}

/** Picks gears. Shifts on the tuned shift rpm, allowing for shift time. */
export class AutoShifter {
  constructor(spec) { this.spec = spec; this.cooldown = 0; this.pending = null; this.prepTimer = 0; }
  reset() { this.cooldown = 0; this.pending = null; this.prepTimer = 0; }

  update(dt, v, throttle, inputs, opts = {}) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (v.gearbox.inShift) { this.pending = null; return; }

    // A shift is queued: hold the clutch out and ease off the throttle for a
    // brief moment before actually pulling the trigger. Without this, the
    // gearbox reads clutch engagement and throttle at the exact instant the
    // shift is requested — which, requested the instant we decide to shift,
    // is still whatever it was a moment ago (fully locked, full throttle).
    // That scores every automatic shift as a driver who never lifted, even
    // though the entire point of this assist is that they didn't have to.
    // A real automatic gearbox does not grind itself on every shift either.
    if (this.pending) {
      inputs.clutch = 1;
      inputs.throttle = Math.min(inputs.throttle, 0.15);
      this.prepTimer -= dt;
      if (this.prepTimer <= 0 || v.clutch.engagement < 0.25) {
        if (this.pending === 'up') inputs.shiftUp = true; else inputs.shiftDown = true;
        this.cooldown = v.gearbox.shiftTime + 0.28;
        this.pending = null;
      }
      return;
    }

    if (this.cooldown > 0) return;

    const g = v.gearbox.gear;
    const shiftRpm = (opts.shiftRpm ?? this.spec.tuning.shiftRpm) * (opts.shiftBias ?? 1);

    // Shift on ROAD SPEED, not on whatever the crank happens to be doing.
    // With the clutch out the engine free-revs, and with the tires spinning the
    // crank runs ahead of the car — reading either would upshift far too early.
    const roadRpm = g > 0
      ? radToRpm((Math.abs(v.speed) / v.drivenRadius) * v.gearbox.ratioFor(g))
      : 0;
    const rpm = g > 0 ? Math.min(v.engine.rpm, roadRpm) : v.engine.rpm;

    // ...but if the engine is already bouncing off the limiter with the clutch
    // engaged, sitting there waiting for the speedo to catch up wastes the run.
    const onLimiter = v.engine.limiterActive && v.clutch.locked && v.speed > 8;

    if (g === 0 && throttle > 0.02) { inputs.selectGear = 1; this.cooldown = 0.25; return; }
    if (g > 0 && g < v.gearbox.gearCount && (rpm >= shiftRpm || onLimiter) && throttle > 0.4) {
      this.pending = 'up';
      this.prepTimer = 0.09;
      return;
    }
    // Downshift only when genuinely lugging, and never back into the limiter.
    if (g > 1 && rpm < this.spec.engine.idleRpm * 1.6 && v.speed < 8) {
      const nextRpm = radToRpm(Math.abs(v.drivenOmega) * v.gearbox.ratioFor(g - 1));
      if (nextRpm < this.spec.engine.limiterRpm * 0.92) {
        this.pending = 'down';
        this.prepTimer = 0.09;
      }
    }
  }
}

/** Traction management — modulates throttle to hold the tires near peak slip. */
export class TractionHelper {
  constructor() { this.cut = 0; }
  reset() { this.cut = 0; }
  /**
   * Holds the driven tires near their peak slip, where the grip actually is.
   * Proportional only, deliberately — an integral term winds up during the
   * initial wheelspin and then strangles the engine down to idle.
   * A low `strength` leaves the tires spinning, which is how a clumsy AI feels.
   */
  update(dt, v, throttle, strength = 1) {
    if (strength <= 0) { this.cut = 0; return throttle; }
    const axles = v.drivenAxles;
    const slip = axles.reduce((s, a) => s + a.slipRatio, 0) / axles.length;
    const target = axles[0].compound.slipPeak * 1.12;
    const err = slip - target;

    // Saturating gain: responds hard to a little slip, never demands more than 88%.
    const want = err > 0 ? clamp((err * 1.7) / (1 + err * 0.62), 0, 0.88) : 0;
    const rate = want > this.cut ? 34 : 20;
    this.cut += (want - this.cut) * clamp(dt * rate, 0, 1);

    // Never cut so far that the engine falls out of its powerband.
    const idle = v.spec.engine.idleRpm;
    const floor = idle * 2.1;
    if (v.engine.rpm < floor) {
      this.cut *= clamp((v.engine.rpm - idle) / Math.max(floor - idle, 1), 0, 1);
    }
    return throttle * (1 - this.cut * strength);
  }
}

/** Personality presets. Different opponents genuinely feel different. */
export const AI_PERSONALITIES = [
  { id: 'sandbagger', name: 'Cautious', launchBias: 0.72, shiftBias: 0.88, tractionStrength: 0.95, reactionMean: 0.38, reactionSd: 0.10, mistakeChance: 0.04, throttleDiscipline: 0.9 },
  { id: 'consistent', name: 'Consistent', launchBias: 0.94, shiftBias: 0.99, tractionStrength: 0.75, reactionMean: 0.24, reactionSd: 0.05, mistakeChance: 0.05, throttleDiscipline: 0.8 },
  { id: 'aggressive', name: 'Aggressive', launchBias: 1.14, shiftBias: 1.02, tractionStrength: 0.35, reactionMean: 0.19, reactionSd: 0.06, mistakeChance: 0.13, throttleDiscipline: 0.45 },
  { id: 'hotshoe', name: 'Hot Shoe', launchBias: 1.02, shiftBias: 1.00, tractionStrength: 0.62, reactionMean: 0.14, reactionSd: 0.03, mistakeChance: 0.03, throttleDiscipline: 0.95 },
  { id: 'wildcard', name: 'Wildcard', launchBias: 1.25, shiftBias: 0.94, tractionStrength: 0.15, reactionMean: 0.28, reactionSd: 0.14, mistakeChance: 0.24, throttleDiscipline: 0.3 },
];

export class AIDriver {
  /**
   * @param {Vehicle} vehicle
   * @param {object} cfg { skill 0..1, personality, seed, name }
   */
  constructor(vehicle, cfg = {}) {
    this.v = vehicle;
    this.spec = vehicle.spec;
    this.skill = clamp(cfg.skill ?? 0.6, 0, 1);
    this.rng = makeRng(cfg.seed ?? (Math.random() * 1e9) | 0);
    this.personality = cfg.personality
      || AI_PERSONALITIES[Math.floor(this.rng() * AI_PERSONALITIES.length)];
    this.name = cfg.name || 'Opponent';

    const p = this.personality;
    // Reaction time: better drivers are quicker and more repeatable.
    this.reactionTime = clamp(
      lerp(p.reactionMean * 1.5, p.reactionMean * 0.62, this.skill)
      + gauss(this.rng) * p.reactionSd * (1.6 - this.skill),
      0.02, 1.2);

    // Launch rpm the AI actually aims for, with its own error.
    const baseLaunch = this.spec.tuning.launchRpm;
    this.launchRpm = clamp(
      baseLaunch * p.launchBias * (1 + gauss(this.rng) * 0.11 * (1.3 - this.skill)),
      this.spec.engine.idleRpm * 1.4, this.spec.engine.limiterRpm * 0.98);

    this.shiftRpm = clamp(
      this.spec.tuning.shiftRpm * p.shiftBias * (1 + gauss(this.rng) * 0.05 * (1.3 - this.skill)),
      2000, this.spec.engine.floatRpm * 0.98);

    this.tractionStrength = clamp(p.tractionStrength * lerp(0.45, 1.15, this.skill), 0, 1);
    this.mistakeChance = p.mistakeChance * lerp(1.9, 0.35, this.skill);

    this.clutch = new AutoClutch(this.spec);
    this.shifter = new AutoShifter(this.spec);
    this.traction = new TractionHelper();

    this.inputs = {
      throttle: 0, brake: 0, clutch: 1, shiftUp: false, shiftDown: false,
      selectGear: null, lineLock: false, starter: false, launchControl: false,
    };
    this.launched = false;
    this.greenAt = null;
    this.timeSinceGreen = -1;
    this.pendingMistake = null;
    this.finished = false;
  }

  /** Called by the race when the tree goes green. */
  onGreen(raceTime) { this.greenAt = raceTime; }

  /**
   * Pre-stage burnout / stage behaviour. Once staged, a driver who is actually
   * ready to leave does not sit at idle waiting for the tree — they bring the
   * engine up near the launch rpm and hold it there with the brake, exactly
   * like a foot-brake or two-step launch. Skipping this step was the reason
   * skilled drivers still measured slow reaction times: the clutch could not
   * be released quickly because the engine had nothing to grab except idle.
   */
  stage(dt) {
    const i = this.inputs;
    i.brake = 1;
    i.clutch = 1;
    i.selectGear = this.v.gearbox.gear === 1 ? null : 1;

    const rpm = this.v.engine.rpm;
    const target = this.launchRpm ?? this.spec.tuning.launchRpm;
    if (rpm < target * 0.97) {
      i.throttle = clamp((target - rpm) / 700, 0.15, 0.85);
    } else {
      // Hold it right there rather than creeping past the target.
      i.throttle = clamp(0.35 + (target - rpm) / 900, 0, 0.6);
    }
    return i;
  }

  /**
   * Warm the tires before staging. You cannot just drop the clutch against the
   * line lock — the engine has to be up on the cam first or it simply stalls.
   */
  burnout(dt, intensity = 1) {
    const i = this.inputs;
    if (this.spec.drivetrain === 'AWD') { this.stage(dt); return i; }
    i.lineLock = true;
    i.brake = 1;
    i.selectGear = this.v.gearbox.gear === 1 ? null : 1;

    const rpm = this.v.engine.rpm;
    const targetRpm = clamp(this.spec.engine.limiterRpm * 0.62, this.spec.engine.idleRpm * 3.2,
      this.spec.engine.limiterRpm * 0.8);

    if (!this._burnoutRolling && rpm < targetRpm * 0.92) {
      // Build revs with the clutch in.
      i.clutch = 1;
      i.throttle = 0.9 * intensity;
      return i;
    }
    this._burnoutRolling = true;
    // Feed the clutch to hold the engine near the target while the tires spin.
    const err = (rpm - targetRpm) / targetRpm;
    const wanted = clamp(0.42 - err * 1.8, 0, 1);
    i.clutch += (wanted - i.clutch) * clamp(dt * 7, 0, 1);
    i.throttle = clamp(0.95 * intensity, 0, 1);
    if (rpm < this.spec.engine.idleRpm * 1.5) i.clutch = 1;
    return i;
  }

  update(dt, raceTime) {
    const i = this.inputs;
    i.lineLock = false;

    if (this.greenAt == null) { this.stage(dt); return i; }

    const since = raceTime - this.greenAt;
    this.timeSinceGreen = since;

    if (since < this.reactionTime) {
      // Still on the brake, revs held at the launch point.
      i.brake = 1;
      i.clutch = 1;
      const rpm = this.v.engine.rpm;
      i.throttle = rpm < this.launchRpm ? clamp((this.launchRpm - rpm) / 900, 0, 0.75) : 0.02;
      if (this.spec.tuning.launchControl) { i.launchControl = true; i.throttle = 0.95; }
      return i;
    }

    if (!this.launched) {
      this.launched = true;
      // Roll a mistake for this run: a bog, a fluffed shift, or too much throttle.
      if (this.rng() < this.mistakeChance) {
        const r = this.rng();
        this.pendingMistake = r < 0.34 ? 'bog' : r < 0.67 ? 'overthrottle' : 'missshift';
      }
    }

    i.brake = 0;
    i.launchControl = false;

    // Base throttle
    let throttle = 1;
    if (this.pendingMistake === 'bog' && since < this.reactionTime + 0.95) {
      throttle = 0.22; // fell asleep on the pedal
    }
    if (this.pendingMistake === 'overthrottle' && since < this.reactionTime + 1.4) {
      throttle = 1; // and the traction helper is disabled below
    }

    // Traction management, unless this run is the "too much throttle" run.
    const strength = this.pendingMistake === 'overthrottle' ? 0 : this.tractionStrength;
    throttle = this.traction.update(dt, this.v, throttle, strength);

    // Small continuous throttle noise for less disciplined drivers.
    const disc = this.personality.throttleDiscipline;
    if (disc < 0.95 && this.v.speed > 2) {
      throttle *= 1 - (1 - disc) * 0.06 * Math.abs(gauss(this.rng));
    }
    i.throttle = clamp(throttle, 0, 1);

    // Clutch and gears
    i.clutch = this.clutch.update(dt, this.v, i.throttle, {
      launchRpm: this.launchRpm,
      aggression: lerp(0.3, 1, this.skill),
    });

    const shiftBias = this.pendingMistake === 'missshift'
      ? (this.rng() > 0.5 ? 0.72 : 1.08) // shift far too early or drag it out
      : 1;
    this.shifter.update(dt, this.v, i.throttle, i, {
      shiftRpm: this.shiftRpm, shiftBias,
    });

    return i;
  }

  reset() {
    this.clutch.reset(); this.shifter.reset(); this.traction.reset();
    this.launched = false; this.greenAt = null; this.pendingMistake = null;
    this.finished = false; this.timeSinceGreen = -1; this._burnoutRolling = false;
  }
}

/**
 * Applies driver assists for the three player driving modes.
 * Returns the input object the Vehicle should be stepped with.
 */
export class PlayerAssist {
  constructor(spec, mode = 'arcade') {
    this.mode = mode;
    this.spec = spec;
    this.clutch = new AutoClutch(spec);
    this.shifter = new AutoShifter(spec);
    this.traction = new TractionHelper();
  }
  setMode(m) { this.mode = m; this.reset(); }
  reset() { this.clutch.reset(); this.shifter.reset(); this.traction.reset(); }

  /**
   * @param {object} raw raw key state { throttle, brake, clutch, shiftUp, shiftDown, selectGear, lineLock, starter }
   */
  apply(dt, v, raw) {
    const out = raw;
    if (this.mode === 'realistic') {
      return out; // nothing is done for you
    }
    if (this.mode === 'manual') {
      // Clutch is automatic, gears are yours.
      out.clutch = this.clutch.update(dt, v, out.throttle, { aggression: 0.85, lineLock: out.lineLock });
      return out;
    }
    // Arcade: clutch and gearbox are automatic, and traction is managed —
    // except during a deliberate burnout, where excess wheelspin is the
    // entire point and traction control would just fight the player's own
    // burnout button.
    out.throttle = out.lineLock ? out.throttle : this.traction.update(dt, v, out.throttle, 0.78);
    out.clutch = this.clutch.update(dt, v, out.throttle, { aggression: 0.8, lineLock: out.lineLock });
    this.shifter.update(dt, v, out.throttle, out, {});
    return out;
  }
}
