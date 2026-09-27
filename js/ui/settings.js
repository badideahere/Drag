// js/ui/settings.js
// Local preferences only: graphics, effects, audio, units, driving mode.
// Nothing here is authoritative for progression — money, cars and upgrades
// live in the database and are never read from localStorage.

const KEY = 'staged.settings.v1';

export const DEFAULTS = {
  graphicsQuality: 'high',      // low | medium | high
  particles: 'high',            // low | medium | high
  reducedEffects: false,
  screenShake: true,
  smoke: true,
  motionEffects: true,
  volumeMaster: 0.8,
  volumeEngine: 0.9,
  volumeEffects: 0.85,
  volumeMusic: 0.3,
  drivingMode: 'arcade',        // arcade | manual | realistic
  difficulty: 'normal',         // easy | normal | hard | pro
  units: 'imperial',            // imperial | metric
  environment: 'industrial',
  tree: 'pro',                  // pro | sportsman
  showTelemetry: false,
};

let cache = null;

export function getSettings() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function setSetting(key, value) {
  const s = getSettings();
  s[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('staged:settings', { detail: { key, value, settings: s } }));
  return s;
}

export function setSettings(patch) {
  const s = getSettings();
  Object.assign(s, patch);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('staged:settings', { detail: { settings: s } }));
  return s;
}

export function resetSettings() {
  cache = { ...DEFAULTS };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('staged:settings', { detail: { settings: cache } }));
  return cache;
}

/** AI skill and mistake scaling for the four difficulty levels. */
export const DIFFICULTY = {
  easy: { skill: 0.34, mistakeScale: 1.7, label: 'Easy' },
  normal: { skill: 0.58, mistakeScale: 1.0, label: 'Normal' },
  hard: { skill: 0.78, mistakeScale: 0.7, label: 'Hard' },
  pro: { skill: 0.94, mistakeScale: 0.35, label: 'Pro' },
};

export const DRIVING_MODES = {
  arcade: {
    id: 'arcade',
    name: 'Arcade',
    blurb: 'Automatic clutch and gears with traction management. Real vehicle physics, no hidden power multiplier.',
  },
  manual: {
    id: 'manual',
    name: 'Manual',
    blurb: 'You shift, the clutch is handled for you. Missed shifts and over-revs are on you.',
  },
  realistic: {
    id: 'realistic',
    name: 'Realistic',
    blurb: 'Throttle, brake, clutch and gears. You can stall it, bog it, smoke the clutch and money-shift it into scrap.',
  },
};
