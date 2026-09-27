// js/game/particles.js
// Pooled particle system. Smoke is driven by real scrub speed and tire
// temperature coming out of the tire model, so a car that is not actually
// spinning its tires cannot make smoke.

import { clamp } from '../sim/util.js';

const TAU = Math.PI * 2;

export const PARTICLE_BUDGET = { low: 220, medium: 700, high: 1800 };

export class ParticleSystem {
  constructor(opts = {}) {
    this.quality = opts.quality || 'high';
    this.reduced = !!opts.reduced;
    this.max = PARTICLE_BUDGET[this.quality] || PARTICLE_BUDGET.high;
    this.pool = [];
    this.live = [];
    for (let i = 0; i < this.max; i++) this.pool.push(blank());
    this.carry = 0;
  }

  setQuality(q, reduced) {
    this.quality = q;
    this.reduced = !!reduced;
    const target = PARTICLE_BUDGET[q] || PARTICLE_BUDGET.high;
    this.max = this.reduced ? Math.round(target * 0.35) : target;
    while (this.pool.length + this.live.length < this.max) this.pool.push(blank());
    while (this.live.length > this.max) this.recycle(this.live.pop());
  }

  clear() {
    while (this.live.length) this.pool.push(this.live.pop());
  }

  recycle(p) { this.pool.push(p); }

  spawn() {
    if (!this.pool.length) {
      // Steal the oldest rather than dropping frames.
      const oldest = this.live.shift();
      if (!oldest) return null;
      this.pool.push(oldest);
    }
    const p = this.pool.pop();
    this.live.push(p);
    return p;
  }

  /**
   * Tire smoke. `rate` is the smoke output from TireAxle (0..1-ish),
   * `scrub` is the real slip velocity in m/s.
   */
  tireSmoke(x, y, rate, scrub, dt, opts = {}) {
    if (rate <= 0.01) return;
    const density = this.reduced ? 0.25 : 1;
    const want = rate * 120 * dt * density;
    this.carry += want;
    let n = Math.floor(this.carry);
    this.carry -= n;
    n = Math.min(n, 24);
    const heat = clamp(opts.heat ?? 0.5, 0, 1);
    for (let i = 0; i < n; i++) {
      const p = this.spawn();
      if (!p) return;
      p.type = 'smoke';
      p.x = x + (Math.random() - 0.5) * 18;
      p.y = y - Math.random() * 10;
      p.vx = -scrub * 0.10 * (0.4 + Math.random() * 0.9) + (opts.carVx || 0) * 0.35;
      p.vy = -12 - Math.random() * 46 - rate * 30;
      p.life = 0;
      p.maxLife = 1.1 + Math.random() * 1.7 + rate * 0.8;
      p.size = 10 + Math.random() * 16;
      p.grow = 34 + Math.random() * 46;
      p.rot = Math.random() * TAU;
      p.spin = (Math.random() - 0.5) * 1.6;
      p.alpha = 0.34 + rate * 0.30;
      // Hot tires make browner, denser smoke.
      p.tint = 226 - heat * 40;
      p.drag = 0.86;
    }
  }

  /** Exhaust puff — bigger under load and boost. */
  exhaust(x, y, load, dt, opts = {}) {
    if (this.reduced) return;
    const want = (0.25 + load * 2.4) * 14 * dt;
    if (Math.random() > want) return;
    const p = this.spawn();
    if (!p) return;
    p.type = 'exhaust';
    p.x = x; p.y = y;
    p.vx = 40 + Math.random() * 70 + (opts.carVx || 0) * 0.5;
    p.vy = -6 - Math.random() * 20;
    p.life = 0;
    p.maxLife = 0.45 + Math.random() * 0.6;
    p.size = 4 + Math.random() * 7;
    p.grow = 22 + Math.random() * 20;
    p.rot = Math.random() * TAU;
    p.spin = (Math.random() - 0.5) * 2;
    p.alpha = 0.10 + load * 0.28;
    p.tint = 205;
    p.drag = 0.80;
  }

  /** Sparks — chassis strike, driveline shock, clutch letting go. */
  sparks(x, y, n, opts = {}) {
    if (this.reduced) n = Math.ceil(n * 0.4);
    for (let i = 0; i < n; i++) {
      const p = this.spawn();
      if (!p) return;
      p.type = 'spark';
      p.x = x + (Math.random() - 0.5) * 12;
      p.y = y;
      const a = -Math.PI * (0.05 + Math.random() * 0.55);
      const sp = 110 + Math.random() * 300;
      p.vx = Math.cos(a) * sp * (opts.dir ?? -1);
      p.vy = Math.sin(a) * sp;
      p.life = 0;
      p.maxLife = 0.25 + Math.random() * 0.5;
      p.size = 1.1 + Math.random() * 1.8;
      p.grow = -0.6;
      p.alpha = 1;
      p.drag = 0.94;
      p.gravity = 820;
    }
  }

  /** Small stones and rubber kicked up by a spinning tire. */
  debris(x, y, rate, dt, opts = {}) {
    if (this.reduced) return;
    if (Math.random() > rate * 26 * dt) return;
    const p = this.spawn();
    if (!p) return;
    p.type = 'debris';
    p.x = x; p.y = y;
    p.vx = -(80 + Math.random() * 260) * (opts.dir ?? 1);
    p.vy = -(40 + Math.random() * 190);
    p.life = 0;
    p.maxLife = 0.7 + Math.random() * 0.6;
    p.size = 1.4 + Math.random() * 2.6;
    p.grow = 0;
    p.alpha = 0.9;
    p.gravity = 900;
    p.drag = 0.99;
  }

  /** Light haze left hanging over the startline after a burnout. */
  lingering(x, y, amount) {
    const n = this.reduced ? 2 : Math.round(amount * 8);
    for (let i = 0; i < n; i++) {
      const p = this.spawn();
      if (!p) return;
      p.type = 'smoke';
      p.x = x + (Math.random() - 0.5) * 240;
      p.y = y - Math.random() * 70;
      p.vx = (Math.random() - 0.5) * 12;
      p.vy = -4 - Math.random() * 12;
      p.life = 0;
      p.maxLife = 3.5 + Math.random() * 4;
      p.size = 40 + Math.random() * 60;
      p.grow = 16;
      p.rot = Math.random() * TAU;
      p.spin = (Math.random() - 0.5) * 0.4;
      p.alpha = 0.16;
      p.tint = 222;
      p.drag = 0.95;
    }
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.live.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      if (p.gravity) p.vy += p.gravity * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += p.grow * dt;
      p.rot += p.spin * dt;
      if (p.type === 'debris' && p.y > 0) { p.y = 0; p.vy *= -0.32; p.vx *= 0.7; }
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx already translated so that (0,0) is
   *        the world origin used when the particles were spawned.
   */
  draw(ctx) {
    ctx.save();
    // Smoke first (behind), then hot stuff on top.
    for (const p of this.live) {
      if (p.type !== 'smoke' && p.type !== 'exhaust') continue;
      const t = p.life / p.maxLife;
      const fade = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      const a = clamp(fade, 0, 1) * p.alpha;
      if (a <= 0.004) continue;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      const c = p.tint | 0;
      g.addColorStop(0, `rgba(${c},${c},${c - 6},${a})`);
      g.addColorStop(0.55, `rgba(${c - 14},${c - 14},${c - 20},${a * 0.6})`);
      g.addColorStop(1, `rgba(${c - 30},${c - 30},${c - 34},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.live) {
      if (p.type !== 'spark') continue;
      const t = 1 - p.life / p.maxLife;
      ctx.strokeStyle = `rgba(255,${170 + 70 * t | 0},${70 * t | 0},${t})`;
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.014, p.y - p.vy * 0.014);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const p of this.live) {
      if (p.type !== 'debris') continue;
      const t = 1 - p.life / p.maxLife;
      ctx.fillStyle = `rgba(48,44,40,${t * p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  get count() { return this.live.length; }
}

function blank() {
  return {
    type: 'smoke', x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
    size: 1, grow: 0, rot: 0, spin: 0, alpha: 1, tint: 220, drag: 0.9, gravity: 0,
  };
}
