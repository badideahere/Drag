// js/game/input.js
// Keyboard (and optional gamepad) input, fully rebindable.
//
// Key bindings live in localStorage — that is a UI preference, not progression,
// so it is allowed to be client-side. Nothing in here touches money or cars.

import { clamp } from '../sim/util.js';

const STORE_KEY = 'staged.controls.v1';

export const ACTIONS = [
  { id: 'throttle', label: 'Throttle', analog: true, def: ['KeyW', 'ArrowUp'] },
  { id: 'brake', label: 'Brake', analog: true, def: ['KeyS', 'ArrowDown'] },
  { id: 'clutch', label: 'Clutch', analog: true, def: ['KeyA', 'ArrowLeft'] },
  { id: 'shiftUp', label: 'Shift Up', def: ['Space'] },
  { id: 'shiftDown', label: 'Shift Down', def: ['KeyQ'] },
  { id: 'reverse', label: 'Select Reverse', def: ['KeyR'] },
  { id: 'neutral', label: 'Select Neutral', def: ['KeyN'] },
  { id: 'burnout', label: 'Line Lock (Burnout)', def: ['KeyB'] },
  { id: 'starter', label: 'Starter', def: ['KeyE'] },
  { id: 'launchControl', label: 'Launch Control', def: ['KeyL'] },
  { id: 'stage', label: 'Stage / Confirm', def: ['Enter'] },
  { id: 'telemetry', label: 'Toggle Telemetry', def: ['KeyT'] },
  { id: 'reset', label: 'Reset Run', def: ['KeyY'] },
  { id: 'pause', label: 'Pause', def: ['KeyP', 'Escape'] },
  { id: 'gear1', label: 'Gear 1', def: ['Digit1'] },
  { id: 'gear2', label: 'Gear 2', def: ['Digit2'] },
  { id: 'gear3', label: 'Gear 3', def: ['Digit3'] },
  { id: 'gear4', label: 'Gear 4', def: ['Digit4'] },
  { id: 'gear5', label: 'Gear 5', def: ['Digit5'] },
  { id: 'gear6', label: 'Gear 6', def: ['Digit6'] },
  { id: 'gear7', label: 'Gear 7', def: ['Digit7'] },
];

export function defaultBindings() {
  const b = {};
  for (const a of ACTIONS) b[a.id] = a.def.slice();
  return b;
}

export function loadBindings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultBindings();
    const saved = JSON.parse(raw);
    const b = defaultBindings();
    for (const k of Object.keys(b)) {
      if (Array.isArray(saved[k]) && saved[k].length) b[k] = saved[k].slice(0, 2);
    }
    return b;
  } catch {
    return defaultBindings();
  }
}

export function saveBindings(b) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(b)); } catch { /* ignore */ }
}

/** Human-readable key name for the settings screen. */
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const map = {
    Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
    Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
  };
  return map[code] || code;
}

export class InputManager {
  constructor(opts = {}) {
    this.bindings = loadBindings();
    this.down = new Set();
    this.pressed = new Set();   // edge-triggered, cleared each frame
    this.enabled = true;
    this.rampUp = opts.rampUp ?? 7.5;    // pedal travel per second
    this.rampDown = opts.rampDown ?? 11;
    this.axes = { throttle: 0, brake: 0, clutch: 0 };
    this.useGamepad = opts.gamepad !== false;
    this.capture = null;                 // set by the rebind UI

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (isTyping(e.target)) return;
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(e.code);
        return;
      }
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (this._consumes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => {
      this.down.delete(e.code);
      if (this._consumes(e.code)) e.preventDefault();
    };
    this._onBlur = () => { this.down.clear(); };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }

  _consumes(code) {
    for (const keys of Object.values(this.bindings)) {
      if (keys.includes(code)) return true;
    }
    return false;
  }

  /** Ask the next keypress to be bound to `action` slot `slot`. */
  beginCapture(action, slot, done) {
    this.capture = (code) => {
      // A key can only drive one action.
      for (const [a, keys] of Object.entries(this.bindings)) {
        this.bindings[a] = keys.filter((k) => k !== code || a === action);
      }
      const arr = this.bindings[action].slice();
      arr[slot] = code;
      this.bindings[action] = arr.filter(Boolean);
      saveBindings(this.bindings);
      done?.(code);
    };
  }

  cancelCapture() { this.capture = null; }

  resetBindings() {
    this.bindings = defaultBindings();
    saveBindings(this.bindings);
  }

  isDown(action) {
    const keys = this.bindings[action] || [];
    for (const k of keys) if (this.down.has(k)) return true;
    return false;
  }

  wasPressed(action) {
    const keys = this.bindings[action] || [];
    for (const k of keys) if (this.pressed.has(k)) return true;
    return false;
  }

  _gamepad() {
    if (!this.useGamepad || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /**
   * Produce the input struct the Vehicle consumes.
   * Digital keys are ramped so a keyboard behaves like a pedal rather than a
   * switch — the simulation still sees a continuous 0..1 value.
   */
  sample(dt, opts = {}) {
    const pad = this._gamepad();
    const target = {
      throttle: this.isDown('throttle') ? 1 : 0,
      brake: this.isDown('brake') ? 1 : 0,
      clutch: this.isDown('clutch') ? 1 : 0,
    };

    if (pad) {
      // Right trigger = throttle, left trigger = brake, left stick Y = clutch.
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.02) target.throttle = Math.max(target.throttle, rt);
      if (lt > 0.02) target.brake = Math.max(target.brake, lt);
      const ls = Math.max(0, pad.axes[1] ?? 0);
      if (ls > 0.08) target.clutch = Math.max(target.clutch, ls);
    }

    for (const k of ['throttle', 'brake', 'clutch']) {
      const cur = this.axes[k];
      const t = target[k];
      const rate = t > cur ? this.rampUp : this.rampDown;
      this.axes[k] = clamp(cur + Math.sign(t - cur) * rate * dt, Math.min(cur, t), Math.max(cur, t));
    }

    let selectGear = null;
    for (let g = 1; g <= 7; g++) {
      if (this.wasPressed('gear' + g)) selectGear = g;
    }
    if (this.wasPressed('reverse')) selectGear = -1;
    if (this.wasPressed('neutral')) selectGear = 0;

    let shiftUp = this.wasPressed('shiftUp');
    let shiftDown = this.wasPressed('shiftDown');
    if (pad) {
      if (pad.buttons[5]?.pressed && !this._padUp) shiftUp = true;
      if (pad.buttons[4]?.pressed && !this._padDown) shiftDown = true;
      this._padUp = pad.buttons[5]?.pressed;
      this._padDown = pad.buttons[4]?.pressed;
    }

    return {
      throttle: this.axes.throttle,
      brake: this.axes.brake,
      clutch: this.axes.clutch,
      shiftUp,
      shiftDown,
      selectGear,
      lineLock: this.isDown('burnout'),
      starter: this.isDown('starter'),
      launchControl: this.isDown('launchControl'),
    };
  }

  /** Call at the very end of each frame. */
  endFrame() { this.pressed.clear(); }
}

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
