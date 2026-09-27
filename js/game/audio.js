// js/game/audio.js
// All audio is synthesised at runtime with the Web Audio API. There are no
// sample files and no music tracks, so nothing here can infringe anyone's
// copyright. The engine note is built from a firing-pulse oscillator bank
// whose frequency comes straight out of the simulation's crank rpm.

import { clamp, lerp } from '../sim/util.js';

const NOISE_SECONDS = 2;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.volumes = { master: 0.8, engine: 0.9, effects: 0.85, music: 0.35 };
    this._noiseBuf = null;
    this._lastShift = 0;
    this._ambience = null;
  }

  /** Must be called from a user gesture (click / keypress). */
  async resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return false; }
      this.ctx = new AC();
      this._build();
    }
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
    this.ready = this.ctx.state === 'running';
    return this.ready;
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.volumes.master, t, 0.02);
    this.engineBus.gain.setTargetAtTime(this.volumes.engine, t, 0.02);
    this.fxBus.gain.setTargetAtTime(this.volumes.effects, t, 0.02);
    if (this._ambience) this._ambience.gain.gain.setTargetAtTime(this.volumes.music * 0.30, t, 0.3);
  }

  _build() {
    const ctx = this.ctx;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.volumes.master;
    // A gentle limiter so a money shift does not blow anyone's ears off.
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;
    this.masterGain.connect(this.comp).connect(ctx.destination);

    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = this.volumes.engine;
    this.engineBus.connect(this.masterGain);

    this.fxBus = ctx.createGain();
    this.fxBus.gain.value = this.volumes.effects;
    this.fxBus.connect(this.masterGain);

    // ---- shared noise buffer
    const len = ctx.sampleRate * NOISE_SECONDS;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;

    // ---------------------------------------------------------- engine voice
    // Firing pulses: a rich periodic wave gives the hard edge a plain sawtooth
    // cannot. Three detuned copies make it sound like more than one cylinder.
    const harmonics = 22;
    const real = new Float32Array(harmonics);
    const imag = new Float32Array(harmonics);
    for (let i = 1; i < harmonics; i++) {
      imag[i] = (1 / Math.pow(i, 0.82)) * (i % 2 === 0 ? 0.55 : 1);
    }
    this.wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

    this.oscs = [];
    this.oscGain = ctx.createGain();
    this.oscGain.gain.value = 0;

    for (const detune of [-9, 0, 7]) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.wave);
      o.frequency.value = 40;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = detune === 0 ? 0.6 : 0.3;
      o.connect(g).connect(this.oscGain);
      o.start();
      this.oscs.push({ osc: o, gain: g, detune });
    }

    // Sub-octave body for big-displacement engines
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.sub.frequency.value = 20;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0;
    this.sub.connect(this.subGain).connect(this.oscGain);
    this.sub.start();

    // Induction / exhaust rasp
    this.rasp = ctx.createBufferSource();
    this.rasp.buffer = buf;
    this.rasp.loop = true;
    this.raspFilter = ctx.createBiquadFilter();
    this.raspFilter.type = 'bandpass';
    this.raspFilter.frequency.value = 700;
    this.raspFilter.Q.value = 0.9;
    this.raspGain = ctx.createGain();
    this.raspGain.gain.value = 0;
    this.rasp.connect(this.raspFilter).connect(this.raspGain).connect(this.oscGain);
    this.rasp.start();

    // Tone shaping: load opens the exhaust up
    this.toneFilter = ctx.createBiquadFilter();
    this.toneFilter.type = 'lowpass';
    this.toneFilter.frequency.value = 900;
    this.toneFilter.Q.value = 0.7;
    this.oscGain.connect(this.toneFilter).connect(this.engineBus);

    // ------------------------------------------------------------- turbo
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turbo.frequency.value = 2000;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    const turboBp = ctx.createBiquadFilter();
    turboBp.type = 'bandpass';
    turboBp.frequency.value = 3200;
    turboBp.Q.value = 3;
    this.turbo.connect(this.turboGain).connect(turboBp).connect(this.engineBus);
    this.turbo.start();

    // Supercharger whine sits an octave down and tracks rpm exactly
    this.blower = ctx.createOscillator();
    this.blower.type = 'sawtooth';
    this.blower.frequency.value = 900;
    this.blowerGain = ctx.createGain();
    this.blowerGain.gain.value = 0;
    const blowerBp = ctx.createBiquadFilter();
    blowerBp.type = 'bandpass';
    blowerBp.frequency.value = 1800;
    blowerBp.Q.value = 6;
    this.blower.connect(this.blowerGain).connect(blowerBp).connect(this.engineBus);
    this.blower.start();

    // --------------------------------------------------------- tire squeal
    this.squeal = ctx.createBufferSource();
    this.squeal.buffer = buf;
    this.squeal.loop = true;
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 1500;
    this.squealFilter.Q.value = 9;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squeal.connect(this.squealFilter).connect(this.squealGain).connect(this.fxBus);
    this.squeal.start();

    // Broad-band roar underneath a real burnout
    this.burn = ctx.createBufferSource();
    this.burn.buffer = buf;
    this.burn.loop = true;
    this.burnFilter = ctx.createBiquadFilter();
    this.burnFilter.type = 'lowpass';
    this.burnFilter.frequency.value = 500;
    this.burnGain = ctx.createGain();
    this.burnGain.gain.value = 0;
    this.burn.connect(this.burnFilter).connect(this.burnGain).connect(this.fxBus);
    this.burn.start();

    // ---------------------------------------------------------- clutch slip
    this.slip = ctx.createBufferSource();
    this.slip.buffer = buf;
    this.slip.loop = true;
    this.slipFilter = ctx.createBiquadFilter();
    this.slipFilter.type = 'bandpass';
    this.slipFilter.frequency.value = 2600;
    this.slipFilter.Q.value = 5;
    this.slipGain = ctx.createGain();
    this.slipGain.gain.value = 0;
    this.slip.connect(this.slipFilter).connect(this.slipGain).connect(this.fxBus);
    this.slip.start();

    // ------------------------------------------------------- wind / rolling
    this.wind = ctx.createBufferSource();
    this.wind.buffer = buf;
    this.wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.fxBus);
    this.wind.start();
  }

  /* ----------------------------------------------------------- per-frame */

  /**
   * @param {object} t telemetry from Vehicle.telemetry()
   * @param {object} spec resolved vehicle spec
   */
  update(t, spec, dt) {
    if (!this.ready || !this.ctx || !t) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const smooth = 0.035;

    const cyl = spec.engine.cylinders || 4;
    const rpm = t.engine.rpm;
    const running = t.engine.running;

    // Firing frequency of a 4-stroke: (rpm/60) * cylinders / 2
    const fire = clamp((rpm / 60) * (cyl / 2), 8, 900);
    const idleF = (spec.engine.idleRpm / 60) * (cyl / 2);

    for (const o of this.oscs) {
      o.osc.frequency.setTargetAtTime(fire, now, smooth);
    }
    this.sub.frequency.setTargetAtTime(clamp(fire * 0.5, 14, 260), now, smooth);

    const thr = t.engine.effectiveThrottle ?? t.engine.throttle;
    const load = clamp(t.engine.load ?? 0, 0, 1);
    const rev = clamp((rpm - spec.engine.idleRpm) / (spec.engine.redlineRpm - spec.engine.idleRpm), 0, 1.15);

    // Limiter chops the fuel — you should hear it, hard.
    let limiterCut = 1;
    if (t.engine.limiter) {
      limiterCut = (Math.floor(now * 26) % 2) ? 0.18 : 1;
    }
    if (!running) limiterCut = 0;

    const baseVol = running ? lerp(0.10, 0.46, Math.max(thr * 0.75, load * 0.55) + rev * 0.22) : 0;
    this.oscGain.gain.setTargetAtTime(clamp(baseVol * limiterCut, 0, 0.6), now, smooth);
    this.subGain.gain.setTargetAtTime(running ? clamp(0.30 - cyl * 0.016, 0.04, 0.3) : 0, now, smooth);

    this.raspFilter.frequency.setTargetAtTime(clamp(fire * 4.5, 300, 5200), now, smooth);
    this.raspGain.gain.setTargetAtTime(running ? clamp(0.05 + thr * 0.22 + rev * 0.12, 0, 0.4) * limiterCut : 0, now, smooth);

    this.toneFilter.frequency.setTargetAtTime(
      clamp(500 + thr * 3600 + rev * 2600 + load * 900, 300, 9000), now, smooth);

    // ---- forced induction
    const boostFrac = clamp((t.engine.boostKpa || 0) / 150, 0, 1.4);
    if (spec.engine.aspiration === 'turbo') {
      const spool = clamp(t.engine.spool ?? 0, 0, 1);
      this.turbo.frequency.setTargetAtTime(1400 + spool * 5200 + rev * 1400, now, 0.06);
      this.turboGain.gain.setTargetAtTime(clamp(spool * 0.085 * (0.3 + thr), 0, 0.12), now, 0.05);
      this.blowerGain.gain.setTargetAtTime(0, now, 0.05);
      // Blow-off when the throttle snaps shut with boost in the pipes
      if (this._prevThr > 0.55 && thr < 0.18 && boostFrac > 0.25) this.blowOff(boostFrac);
    } else if (spec.engine.aspiration === 'supercharged') {
      this.blower.frequency.setTargetAtTime(clamp(fire * 6.2, 200, 6000), now, smooth);
      this.blowerGain.gain.setTargetAtTime(clamp(0.02 + rev * 0.055 + thr * 0.03, 0, 0.11), now, smooth);
      this.turboGain.gain.setTargetAtTime(0, now, 0.05);
    } else {
      this.turboGain.gain.setTargetAtTime(0, now, 0.05);
      this.blowerGain.gain.setTargetAtTime(0, now, 0.05);
    }
    this._prevThr = thr;

    // ---- tires
    const slipMag = Math.max(
      Math.abs(t.tiresRear?.slipVelocity ?? 0),
      Math.abs(t.tiresFront?.slipVelocity ?? 0));
    const smoke = t.smoke ?? 0;
    const squealAmt = clamp(slipMag / 12, 0, 1) * clamp(1 - smoke * 0.4, 0.3, 1);
    this.squealFilter.frequency.setTargetAtTime(900 + clamp(slipMag, 0, 30) * 90, now, 0.05);
    this.squealGain.gain.setTargetAtTime(squealAmt * 0.16, now, 0.05);
    this.burnFilter.frequency.setTargetAtTime(240 + clamp(slipMag, 0, 40) * 14, now, 0.08);
    this.burnGain.gain.setTargetAtTime(clamp(smoke, 0, 1) * 0.20, now, 0.08);

    // ---- clutch
    const slipRpm = Math.abs(t.clutch?.slipRpm ?? 0);
    const transmitting = Math.abs(t.clutch?.transmitted ?? 0);
    const clutchNoise = clamp(slipRpm / 2600, 0, 1) * clamp(transmitting / 500, 0, 1);
    this.slipFilter.frequency.setTargetAtTime(1800 + clamp(slipRpm, 0, 4000) * 0.45, now, 0.05);
    this.slipGain.gain.setTargetAtTime(clutchNoise * 0.13 + (t.clutch?.smoking ? 0.05 : 0), now, 0.05);

    // ---- wind
    const spd = Math.abs(t.speed || 0);
    this.windFilter.frequency.setTargetAtTime(280 + spd * 9, now, 0.08);
    this.windGain.gain.setTargetAtTime(clamp((spd - 6) / 90, 0, 1) * 0.11, now, 0.08);

    // ---- gear change clunk
    if (t.gearbox?.inShift && !this._wasShifting) this.shiftClunk();
    this._wasShifting = !!t.gearbox?.inShift;

    // ---- damage noises
    if (t.engine.health < 55 && running && Math.random() < dt * (60 - t.engine.health) * 0.02) {
      this.knock();
    }
  }

  /** Silence the engine voice (menus, pause). */
  idleOut() {
    if (!this.ready) return;
    const n = this.ctx.currentTime;
    for (const g of [this.oscGain, this.raspGain, this.squealGain, this.burnGain,
      this.slipGain, this.windGain, this.turboGain, this.blowerGain]) {
      g.gain.setTargetAtTime(0, n, 0.08);
    }
  }

  /* -------------------------------------------------------------- one-shots */

  _burst({ type = 'noise', freq = 400, q = 1, filter = 'bandpass', dur = 0.12, vol = 0.3, sweep = null, bus = null }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    g.connect(bus || this.fxBus);

    let src;
    if (type === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.setValueAtTime(freq, now);
      f.Q.value = q;
      if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), now + dur);
      src.connect(f).connect(g);
    } else {
      src = ctx.createOscillator();
      src.type = type;
      src.frequency.setValueAtTime(freq, now);
      if (sweep) src.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), now + dur);
      src.connect(g);
    }
    src.start(now);
    src.stop(now + dur + 0.05);
  }

  shiftClunk() {
    const now = this.ctx?.currentTime ?? 0;
    if (now - this._lastShift < 0.05) return;
    this._lastShift = now;
    this._burst({ freq: 240, q: 2.2, dur: 0.07, vol: 0.20, sweep: 110 });
    this._burst({ type: 'square', freq: 150, dur: 0.05, vol: 0.09, sweep: 70 });
  }

  blowOff(strength = 1) {
    const now = this.ctx?.currentTime ?? 0;
    if (now - (this._lastBov || 0) < 0.25) return;
    this._lastBov = now;
    this._burst({ freq: 3400, q: 1.1, dur: 0.20 + strength * 0.14, vol: 0.14 * clamp(strength, 0.3, 1.4), sweep: 900 });
  }

  wastegate() { this._burst({ freq: 2200, q: 1.6, dur: 0.10, vol: 0.07, sweep: 1400 }); }

  starter(durationS = 0.9) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 420;
    o.frequency.setValueAtTime(38, now);
    // chugging
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 9;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.12;
    lfo.connect(lfoG).connect(g.gain);
    g.gain.setValueAtTime(0.16, now);
    g.gain.setTargetAtTime(0, now + durationS * 0.8, 0.08);
    o.connect(f).connect(g).connect(this.engineBus);
    o.start(now); lfo.start(now);
    o.stop(now + durationS + 0.2); lfo.stop(now + durationS + 0.2);
    this._burst({ freq: 900, q: 0.8, dur: durationS, vol: 0.05, bus: this.engineBus });
  }

  backfire() { this._burst({ freq: 1200, q: 0.7, dur: 0.16, vol: 0.26, sweep: 180 }); }
  knock() { this._burst({ type: 'square', freq: 320, dur: 0.05, vol: 0.10, sweep: 190 }); }
  bang() { this._burst({ freq: 700, q: 0.5, dur: 0.45, vol: 0.4, sweep: 90 }); }

  // Tree and UI
  bulb() { this._burst({ type: 'sine', freq: 660, dur: 0.09, vol: 0.13 }); }
  green() { this._burst({ type: 'sine', freq: 990, dur: 0.20, vol: 0.18 }); }
  foul() { this._burst({ type: 'sawtooth', freq: 180, dur: 0.55, vol: 0.20, sweep: 90 }); }
  uiClick() { this._burst({ type: 'sine', freq: 840, dur: 0.045, vol: 0.07 }); }
  uiBack() { this._burst({ type: 'sine', freq: 420, dur: 0.06, vol: 0.06 }); }
  uiError() { this._burst({ type: 'square', freq: 220, dur: 0.16, vol: 0.09, sweep: 150 }); }
  uiSuccess() {
    this._burst({ type: 'sine', freq: 660, dur: 0.09, vol: 0.08 });
    setTimeout(() => this._burst({ type: 'sine', freq: 990, dur: 0.13, vol: 0.08 }), 90);
  }

  /** Low synthesised pad for the menus. Controlled by the "music" slider. */
  startAmbience() {
    if (!this.ready || this._ambience) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.masterGain);
    const voices = [55, 82.5, 110, 164.8].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.25 / (i + 1);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.04 + i * 0.017;
      const lg = ctx.createGain();
      lg.gain.value = 0.12 / (i + 1);
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(gain);
      o.start(); lfo.start();
      return { o, lfo };
    });
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    this._ambience = { gain, voices, f };
    gain.gain.setTargetAtTime(this.volumes.music * 0.30, ctx.currentTime, 2.5);
  }

  stopAmbience() {
    if (!this._ambience) return;
    const { gain, voices } = this._ambience;
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
    setTimeout(() => {
      voices.forEach((v) => { try { v.o.stop(); v.lfo.stop(); } catch { /* */ } });
    }, 1500);
    this._ambience = null;
  }
}

/** One shared instance is plenty. */
export const audio = new AudioEngine();
