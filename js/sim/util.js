// js/sim/util.js — small shared maths helpers for the simulation.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
export const approach = (cur, target, rate, dt) => {
  const d = target - cur;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return cur + Math.sign(d) * step;
};

export const rpmToRad = (rpm) => (rpm * Math.PI) / 30;
export const radToRpm = (rad) => (rad * 30) / Math.PI;

export const MPS_TO_MPH = 2.2369362920544;
export const MPS_TO_KMH = 3.6;
export const M_TO_FT = 3.280839895;
export const FT_TO_M = 0.3048;
export const LB_TO_KG = 0.45359237;
export const KG_TO_LB = 2.2046226218;
export const NM_TO_LBFT = 0.737562149;
export const LBFT_TO_NM = 1.3558179483;

export function fmtTime(s, places = 3) {
  if (!isFinite(s)) return '--.---';
  return s.toFixed(places);
}

export function fmtMoney(cents) {
  const n = Math.round(Number(cents || 0)) / 100;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** Deterministic PRNG so AI opponents can be reproduced from a seed. */
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Gaussian-ish sample in [-1,1] from a uniform rng. */
export function gauss(rng) {
  return (rng() + rng() + rng() - 1.5) / 1.5;
}
