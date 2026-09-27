// js/game/carart.js
// Side-profile car rendering.
//
// Two paths:
//   1. If a real PNG exists at car.imagePath it is used. Drop your own
//      AI-generated artwork in assets/cars/ and it appears automatically.
//      (See README -> "Adding AI-generated cars" for the exact art brief.)
//   2. Otherwise the car is drawn procedurally from its `art` block. This is
//      the shipped placeholder so the game is fully playable out of the box.
//
// Local art space used by the procedural renderer:
//   origin  = (contact patch of the car, on the ground line)
//   +x      = toward the nose (the car faces RIGHT)
//   -y      = up
//   u       = 0 at the nose, 1 at the tail (matches art.wheels.frontX/rearX)

import { clamp } from '../sim/util.js';

/* ------------------------------------------------------------------ images */

const imageCache = new Map();

/**
 * Attempts to load a real PNG for the car. Never rejects — a missing file
 * simply means the procedural renderer is used instead.
 */
export function loadCarImage(path) {
  if (!path) return Promise.resolve(null);
  if (imageCache.has(path)) return imageCache.get(path);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 4 ? img : null);
    img.onerror = () => resolve(null);
    img.src = path;
  });
  imageCache.set(path, p);
  return p;
}

/** Pre-warm every car image so the garage/dealership do not pop in. */
export function preloadCarImages(cars) {
  return Promise.all(cars.map((c) => loadCarImage(c.imagePath)));
}

export function cachedCarImage(path) {
  const p = imageCache.get(path);
  if (!p) return undefined;
  // Promises resolve asynchronously; we stash the result on the promise.
  return p.__result;
}

/** Resolve-and-remember so draw() can be synchronous. */
export function ensureCarImage(path) {
  if (!path) return null;
  if (!imageCache.has(path)) {
    const p = loadCarImage(path);
    p.then((img) => { p.__result = img || null; });
    return null;
  }
  const p = imageCache.get(path);
  return p.__result ?? null;
}

/* --------------------------------------------------------------- profiles */
// Each profile: bodyH (fraction of length) + a top outline traced from the
// bottom of the front bumper, over the car, to the bottom of the rear bumper.
// Segment forms: ['M',u,v] ['L',u,v] ['C',u1,v1,u2,v2,u,v]

const PROFILES = {
  hatch: {
    bodyH: 0.400, wheelArch: 1.30, glassTint: '#20303c',
    top: [
      ['M', 0.015, 0.18],
      ['C', 0.000, 0.30, 0.000, 0.44, 0.038, 0.52],
      ['L', 0.105, 0.565],
      ['C', 0.180, 0.600, 0.245, 0.618, 0.298, 0.640],
      ['C', 0.360, 0.800, 0.400, 0.930, 0.452, 1.000],
      ['L', 0.715, 1.000],
      ['C', 0.800, 0.992, 0.868, 0.860, 0.916, 0.625],
      ['C', 0.946, 0.520, 0.972, 0.420, 0.984, 0.270],
      ['L', 0.992, 0.155],
    ],
    glass: [
      // windshield
      [['M', 0.318, 0.655], ['C', 0.372, 0.808, 0.408, 0.898, 0.462, 0.960],
        ['L', 0.520, 0.960], ['L', 0.520, 0.680], ['Z']],
      // front door glass
      [['M', 0.540, 0.680], ['L', 0.540, 0.960], ['L', 0.690, 0.960],
        ['L', 0.690, 0.680], ['Z']],
      // rear quarter
      [['M', 0.710, 0.680], ['L', 0.710, 0.958], ['C', 0.790, 0.948, 0.838, 0.842, 0.872, 0.690], ['Z']],
    ],
    doorCuts: [0.530, 0.700],
    beltV: 0.655,
    handles: [[0.600, 0.610], [0.760, 0.610]],
    mirror: [0.335, 0.680],
    head: { u: 0.045, v: 0.480, w: 0.070, h: 0.090 },
    tail: { u: 0.955, v: 0.430, w: 0.055, h: 0.120 },
    exhaust: { u: 0.955, v: 0.055, r: 0.014 },
  },

  coupe: {
    bodyH: 0.352, wheelArch: 1.26, glassTint: '#1c2b36',
    top: [
      ['M', 0.012, 0.16],
      ['C', 0.000, 0.28, 0.002, 0.42, 0.040, 0.50],
      ['L', 0.130, 0.545],
      ['C', 0.220, 0.572, 0.300, 0.590, 0.352, 0.618],
      ['C', 0.412, 0.790, 0.448, 0.918, 0.500, 0.995],
      ['L', 0.690, 1.000],
      ['C', 0.780, 0.985, 0.852, 0.845, 0.902, 0.640],
      ['C', 0.938, 0.560, 0.968, 0.470, 0.982, 0.300],
      ['L', 0.990, 0.150],
    ],
    glass: [
      [['M', 0.372, 0.632], ['C', 0.424, 0.796, 0.458, 0.898, 0.508, 0.955],
        ['L', 0.562, 0.955], ['L', 0.562, 0.658], ['Z']],
      [['M', 0.582, 0.658], ['L', 0.582, 0.955], ['C', 0.700, 0.950, 0.780, 0.860, 0.836, 0.700],
        ['L', 0.760, 0.658], ['Z']],
    ],
    doorCuts: [0.572, 0.790],
    beltV: 0.632,
    handles: [[0.680, 0.585]],
    mirror: [0.392, 0.655],
    head: { u: 0.052, v: 0.455, w: 0.085, h: 0.080 },
    tail: { u: 0.950, v: 0.400, w: 0.062, h: 0.105 },
    exhaust: { u: 0.950, v: 0.050, r: 0.016 },
  },

  sedan: {
    bodyH: 0.382, wheelArch: 1.28, glassTint: '#1e2e3a',
    top: [
      ['M', 0.014, 0.17],
      ['C', 0.000, 0.29, 0.000, 0.43, 0.038, 0.51],
      ['L', 0.118, 0.552],
      ['C', 0.200, 0.582, 0.268, 0.600, 0.318, 0.626],
      ['C', 0.378, 0.796, 0.414, 0.918, 0.466, 0.992],
      ['L', 0.688, 1.000],
      ['C', 0.756, 0.994, 0.800, 0.880, 0.838, 0.712],
      ['L', 0.930, 0.660],
      ['C', 0.962, 0.640, 0.980, 0.520, 0.986, 0.320],
      ['L', 0.992, 0.152],
    ],
    glass: [
      [['M', 0.338, 0.642], ['C', 0.390, 0.802, 0.424, 0.900, 0.474, 0.954],
        ['L', 0.532, 0.954], ['L', 0.532, 0.668], ['Z']],
      [['M', 0.552, 0.668], ['L', 0.552, 0.954], ['L', 0.676, 0.954], ['L', 0.676, 0.668], ['Z']],
      [['M', 0.696, 0.668], ['L', 0.696, 0.952], ['C', 0.752, 0.946, 0.788, 0.862, 0.818, 0.722], ['Z']],
    ],
    doorCuts: [0.542, 0.686],
    beltV: 0.642,
    handles: [[0.608, 0.600], [0.752, 0.600]],
    mirror: [0.356, 0.668],
    head: { u: 0.048, v: 0.468, w: 0.078, h: 0.082 },
    tail: { u: 0.952, v: 0.430, w: 0.058, h: 0.110 },
    exhaust: { u: 0.952, v: 0.052, r: 0.015 },
  },

  muscle: {
    bodyH: 0.370, wheelArch: 1.24, glassTint: '#182531',
    top: [
      ['M', 0.010, 0.15],
      ['C', 0.000, 0.26, 0.000, 0.40, 0.032, 0.48],
      ['L', 0.140, 0.520],
      ['L', 0.352, 0.552],
      ['C', 0.404, 0.746, 0.440, 0.892, 0.492, 0.982],
      ['L', 0.702, 1.000],
      ['L', 0.812, 0.960],
      ['C', 0.860, 0.930, 0.880, 0.780, 0.898, 0.640],
      ['L', 0.962, 0.600],
      ['C', 0.982, 0.560, 0.990, 0.440, 0.992, 0.300],
      ['L', 0.996, 0.140],
    ],
    glass: [
      [['M', 0.372, 0.572], ['C', 0.420, 0.752, 0.452, 0.878, 0.500, 0.944],
        ['L', 0.556, 0.944], ['L', 0.556, 0.596], ['Z']],
      [['M', 0.576, 0.596], ['L', 0.576, 0.944], ['L', 0.712, 0.958], ['L', 0.712, 0.612], ['Z']],
      [['M', 0.732, 0.614], ['L', 0.732, 0.956], ['L', 0.806, 0.928], ['L', 0.790, 0.630], ['Z']],
    ],
    doorCuts: [0.566, 0.722],
    beltV: 0.586,
    handles: [[0.638, 0.542]],
    mirror: [0.388, 0.600],
    head: { u: 0.042, v: 0.436, w: 0.090, h: 0.078 },
    tail: { u: 0.958, v: 0.400, w: 0.048, h: 0.130 },
    exhaust: { u: 0.960, v: 0.048, r: 0.019 },
    scoop: { u: 0.230, v: 0.520, w: 0.150, h: 0.075 },
  },

  supercar: {
    bodyH: 0.300, wheelArch: 1.22, glassTint: '#16222c',
    top: [
      ['M', 0.008, 0.20],
      ['C', 0.000, 0.30, 0.004, 0.40, 0.044, 0.452],
      ['C', 0.120, 0.500, 0.180, 0.520, 0.222, 0.560],
      ['C', 0.300, 0.760, 0.352, 0.900, 0.418, 0.972],
      ['L', 0.588, 1.000],
      ['C', 0.688, 0.982, 0.760, 0.900, 0.822, 0.780],
      ['C', 0.872, 0.690, 0.912, 0.640, 0.958, 0.600],
      ['C', 0.982, 0.560, 0.992, 0.440, 0.994, 0.300],
      ['L', 0.996, 0.180],
    ],
    glass: [
      [['M', 0.244, 0.578], ['C', 0.318, 0.762, 0.366, 0.884, 0.428, 0.938],
        ['L', 0.500, 0.948], ['L', 0.480, 0.612], ['Z']],
      [['M', 0.520, 0.618], ['L', 0.540, 0.950], ['C', 0.646, 0.938, 0.716, 0.866, 0.772, 0.762],
        ['L', 0.660, 0.660], ['Z']],
    ],
    doorCuts: [0.512, 0.780],
    beltV: 0.570,
    handles: [[0.628, 0.520]],
    mirror: [0.268, 0.596],
    head: { u: 0.060, v: 0.400, w: 0.096, h: 0.062 },
    tail: { u: 0.952, v: 0.440, w: 0.052, h: 0.090 },
    exhaust: { u: 0.966, v: 0.070, r: 0.020 },
    wing: { u: 0.905, v: 0.680, w: 0.130, h: 0.030, strutV: 0.60 },
  },

  prostreet: {
    bodyH: 0.395, wheelArch: 1.16, glassTint: '#141e27',
    top: [
      ['M', 0.010, 0.10],
      ['C', 0.000, 0.22, 0.000, 0.36, 0.030, 0.44],
      ['L', 0.140, 0.470],
      ['L', 0.340, 0.520],
      ['C', 0.396, 0.720, 0.432, 0.870, 0.486, 0.962],
      ['L', 0.700, 0.992],
      ['L', 0.820, 0.962],
      ['C', 0.874, 0.930, 0.900, 0.800, 0.918, 0.660],
      ['L', 0.968, 0.620],
      ['C', 0.986, 0.580, 0.994, 0.470, 0.996, 0.350],
      ['L', 0.998, 0.210],
    ],
    glass: [
      [['M', 0.362, 0.544], ['C', 0.410, 0.728, 0.444, 0.856, 0.492, 0.926],
        ['L', 0.548, 0.930], ['L', 0.548, 0.568], ['Z']],
      [['M', 0.568, 0.570], ['L', 0.568, 0.930], ['L', 0.714, 0.948], ['L', 0.714, 0.592], ['Z']],
    ],
    doorCuts: [0.558, 0.726],
    beltV: 0.556,
    handles: [],
    mirror: null,
    head: { u: 0.038, v: 0.392, w: 0.086, h: 0.070 },
    tail: { u: 0.962, v: 0.450, w: 0.044, h: 0.120 },
    exhaust: null,
    scoop: { u: 0.215, v: 0.480, w: 0.185, h: 0.150 },
    sidePipe: true,
    wheelieBar: true,
    rake: 0.055, // rear sits this much higher (fraction of length)
  },
};

export function profileFor(art) {
  return PROFILES[art?.silhouette] || PROFILES.coupe;
}

/* ----------------------------------------------------------- path plumbing */

function tracePath(ctx, segs, L, H, sill) {
  const X = (u) => (1 - u) * L;
  const Y = (v) => -(sill + v * H);
  for (const s of segs) {
    switch (s[0]) {
      case 'M': ctx.moveTo(X(s[1]), Y(s[2])); break;
      case 'L': ctx.lineTo(X(s[1]), Y(s[2])); break;
      case 'C': ctx.bezierCurveTo(X(s[1]), Y(s[2]), X(s[3]), Y(s[4]), X(s[5]), Y(s[6])); break;
      case 'Z': ctx.closePath(); break;
      default: break;
    }
  }
}

/** Closed body outline: the top profile plus sills and wheel arches. */
function bodyPath(ctx, p, art, L, H, sill, wheels) {
  const X = (u) => (1 - u) * L;
  const Y = (v) => -(sill + v * H);
  ctx.beginPath();
  tracePath(ctx, p.top, L, H, sill);

  // Bottom edge runs tail -> nose, which on screen is left -> right.
  const last = p.top[p.top.length - 1];
  const tailV = last[last.length - 1];
  ctx.lineTo(X(0.998), Y(tailV));
  const sy = -sill;
  ctx.lineTo(X(0.985), sy);

  const order = [wheels.rear, wheels.front]; // left to right on screen
  for (const w of order) {
    const r = w.r * p.wheelArch;
    const cx = X(w.u);
    const cy = -(w.cy);
    ctx.lineTo(cx + r, sy);
    ctx.arc(cx, Math.min(cy, sy - 2), r, 0, Math.PI, true);
    ctx.lineTo(cx - r, sy);
  }
  ctx.lineTo(X(0.02), sy);
  ctx.closePath();
}

/* ----------------------------------------------------------------- wheels */

function drawWheel(ctx, cx, cy, r, angle, opts) {
  const { brake = 0, rimColor = '#c6ccd4', spokes = 5, spin = 0 } = opts;
  ctx.save();
  ctx.translate(cx, cy);

  // Tire carcass
  const tg = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  tg.addColorStop(0, '#2b2f34');
  tg.addColorStop(0.62, '#17191d');
  tg.addColorStop(1, '#0a0b0d');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = tg;
  ctx.fill();

  // Sidewall lettering ring (rotates with the wheel, sells the motion)
  const rimR = r * 0.665;
  ctx.save();
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.845, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(190,190,190,0.14)';
  ctx.lineWidth = Math.max(1, r * 0.035);
  ctx.stroke();
  ctx.restore();

  // Brake disc behind the rim
  ctx.beginPath();
  ctx.arc(0, 0, rimR * 0.84, 0, Math.PI * 2);
  ctx.fillStyle = brake > 0.05
    ? `rgb(${Math.round(60 + brake * 160)},${Math.round(56 + brake * 40)},58)`
    : '#3a3f46';
  ctx.fill();
  if (brake > 0.35) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bg = ctx.createRadialGradient(0, 0, rimR * 0.2, 0, 0, rimR * 1.5);
    bg.addColorStop(0, `rgba(255,90,40,${(brake - 0.35) * 0.55})`);
    bg.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(0, 0, rimR * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Rim
  ctx.save();
  ctx.rotate(angle);
  const rg = ctx.createLinearGradient(-rimR, -rimR, rimR, rimR);
  rg.addColorStop(0, '#f2f5f8');
  rg.addColorStop(0.35, rimColor);
  rg.addColorStop(0.72, '#6f7780');
  rg.addColorStop(1, '#3b4249');
  ctx.beginPath();
  ctx.arc(0, 0, rimR, 0, Math.PI * 2);
  ctx.fillStyle = rg;
  ctx.fill();

  // Spokes cut out as dark pockets
  ctx.fillStyle = 'rgba(12,14,17,0.88)';
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(rimR * 0.20, -rimR * 0.13);
    ctx.quadraticCurveTo(rimR * 0.62, -rimR * 0.30, rimR * 0.88, -rimR * 0.10);
    ctx.lineTo(rimR * 0.88, rimR * 0.10);
    ctx.quadraticCurveTo(rimR * 0.62, rimR * 0.30, rimR * 0.20, rimR * 0.13);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Hub + lugs
  ctx.beginPath();
  ctx.arc(0, 0, rimR * 0.26, 0, Math.PI * 2);
  ctx.fillStyle = '#9aa3ac';
  ctx.fill();
  ctx.fillStyle = '#5c646d';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * rimR * 0.17, Math.sin(a) * rimR * 0.17, rimR * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Motion blur ring when the wheel is really moving
  if (spin > 0.02) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.5, spin);
    ctx.beginPath();
    ctx.arc(0, 0, rimR * 0.92, 0, Math.PI * 2);
    ctx.strokeStyle = '#8b939c';
    ctx.lineWidth = rimR * 0.5;
    ctx.stroke();
    ctx.restore();
  }

  // Outer tire edge shading
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.985, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ paint */

function paintBody(ctx, art, p, L, H, sill) {
  const top = -(sill + H);
  const g = ctx.createLinearGradient(0, top, 0, -sill);
  const light = shade(art.paint, 0.42);
  g.addColorStop(0.00, shade(art.paint, 0.16));
  g.addColorStop(0.16, light);
  g.addColorStop(0.42, art.paint);
  g.addColorStop(0.72, art.paintDark);
  g.addColorStop(1.00, shade(art.paintDark, -0.45));
  ctx.fillStyle = g;
  ctx.fill();
}

function shade(hex, amt) {
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt; gg += (255 - gg) * amt; b += (255 - b) * amt;
  } else {
    r *= (1 + amt); gg *= (1 + amt); b *= (1 + amt);
  }
  return `rgb(${r | 0},${gg | 0},${b | 0})`;
}

/* ------------------------------------------------------------------- main */

/**
 * Draw a car. Origin must already be translated to the car's ground contact
 * point; the car is drawn facing right.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} car  entry from js/data/cars.js (or a resolved spec)
 * @param {object} o {
 *   length:   drawn length in px (defaults to art.lengthPx)
 *   wheelAngle, rearWheelAngle: radians
 *   suspensionF, suspensionR:   metres of travel (positive = extended)
 *   pitch:    radians (nose up positive)
 *   brake:    0..1   headlights/brake light intensity
 *   lights:   bool   headlights on
 *   wheelSpin: 0..1  blur amount
 *   shadow:   bool
 *   tireCompound: string (changes sidewall look)
 * }
 */
export function drawCar(ctx, car, o = {}) {
  const art = car.art || {};
  const L = o.length || art.lengthPx || 420;
  const p = profileFor(art);
  const img = ensureCarImage(car.imagePath);

  const wr = (art.wheels?.radius ?? 0.15) * L;
  const wrr = (art.wheels?.rearRadius ?? art.wheels?.radius ?? 0.15) * L;
  const frontU = art.wheels?.frontX ?? 0.21;
  const rearU = art.wheels?.rearX ?? 0.80;
  const sill = (art.rideHeight ?? 0.3) * wr;
  const rake = (p.rake || 0) * L;

  const susF = clamp((o.suspensionF ?? 0) * 260, -0.09 * L, 0.06 * L);
  const susR = clamp((o.suspensionR ?? 0) * 260, -0.09 * L, 0.06 * L);
  const pitch = clamp(o.pitch ?? 0, -0.25, 0.35);

  ctx.save();

  // -------- ground shadow (drawn before the pitch transform so it stays flat)
  if (o.shadow !== false) {
    const sw = L * 0.94, sh = wr * 0.42;
    const sg = ctx.createRadialGradient((0.5 - 0.5) * L, 0, 2, 0, 0, sw * 0.5);
    sg.addColorStop(0, 'rgba(0,0,0,0.55)');
    sg.addColorStop(0.7, 'rgba(0,0,0,0.22)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(-L * 0.5, wr * 0.06);
    ctx.scale(1, sh / (sw * 0.5));
    ctx.beginPath();
    ctx.arc(0, 0, sw * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.restore();
  }

  // -------- wheels sit on the ground and do not pitch with the body
  const fx = (1 - frontU) * L;
  const rx = (1 - rearU) * L;
  const wheelOpts = {
    brake: o.brake ?? 0,
    rimColor: art.rimColor || '#c6ccd4',
    spokes: art.spokes || 5,
  };
  drawWheel(ctx, rx, -wrr, wrr, o.rearWheelAngle ?? o.wheelAngle ?? 0,
    { ...wheelOpts, spin: o.rearSpin ?? o.wheelSpin ?? 0 });
  drawWheel(ctx, fx, -wr, wr, o.wheelAngle ?? 0,
    { ...wheelOpts, spin: o.frontSpin ?? 0, brake: (o.brake ?? 0) * 0.8 });

  // -------- body, pitched about a point near the middle of the wheelbase
  ctx.save();
  const pivotX = (fx + rx) * 0.5;
  ctx.translate(pivotX, -wr * 0.9);
  ctx.rotate(-pitch * 0.55);
  ctx.translate(-pivotX, wr * 0.9);
  // Suspension bob: front and rear ends move independently.
  ctx.translate(0, -(susF + susR) * 0.5);

  const wheelsMeta = {
    front: { u: frontU, r: wr, cy: wr },
    rear: { u: rearU, r: wrr, cy: wrr },
  };
  const Hb = p.bodyH * L * (art.heightScale ?? 1);
  const sillEff = sill + rake * 0; // rake handled per-end below

  const X = (u) => (1 - u) * L;
  const Y = (v) => -(sillEff + v * Hb);

  // Body fill
  bodyPath(ctx, p, art, L, Hb, sillEff, wheelsMeta);
  paintBody(ctx, art, p, L, Hb, sillEff);

  // Clip everything that follows to the body so nothing bleeds out
  ctx.save();
  ctx.clip();

  // Specular sweep along the shoulder
  const sp = ctx.createLinearGradient(0, Y(p.beltV + 0.34), 0, Y(p.beltV - 0.12));
  sp.addColorStop(0, 'rgba(255,255,255,0.00)');
  sp.addColorStop(0.5, 'rgba(255,255,255,0.20)');
  sp.addColorStop(1, 'rgba(255,255,255,0.00)');
  ctx.fillStyle = sp;
  ctx.fillRect(0, Y(p.beltV + 0.40), L, Hb * 0.55);

  // Ground bounce along the sill
  const gb = ctx.createLinearGradient(0, -sillEff, 0, Y(0.30));
  gb.addColorStop(0, 'rgba(255,255,255,0.13)');
  gb.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gb;
  ctx.fillRect(0, Y(0.30), L, Hb * 0.34);

  // Sky reflection on the upper panels
  const sk = ctx.createLinearGradient(0, Y(1.0), 0, Y(0.62));
  sk.addColorStop(0, 'rgba(180,205,235,0.20)');
  sk.addColorStop(1, 'rgba(180,205,235,0)');
  ctx.fillStyle = sk;
  ctx.fillRect(0, Y(1.02), L, Hb * 0.42);

  // Glass
  for (const gpath of p.glass) {
    ctx.beginPath();
    tracePath(ctx, gpath, L, Hb, sillEff);
    const gg = ctx.createLinearGradient(0, Y(1.0), 0, Y(p.beltV));
    gg.addColorStop(0, shade(p.glassTint, 0.34));
    gg.addColorStop(0.55, p.glassTint);
    gg.addColorStop(1, shade(p.glassTint, -0.35));
    ctx.fillStyle = gg;
    ctx.fill();
    // reflection streak
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#dff0ff';
    ctx.lineWidth = Hb * 0.075;
    ctx.beginPath();
    ctx.moveTo(X(0.05), Y(1.4));
    ctx.lineTo(X(0.75), Y(0.2));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(X(0.20), Y(1.4));
    ctx.lineTo(X(0.90), Y(0.2));
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1, L * 0.004);
    ctx.stroke();
  }

  // Door shut lines
  ctx.strokeStyle = 'rgba(0,0,0,0.42)';
  ctx.lineWidth = Math.max(1, L * 0.0035);
  for (const u of p.doorCuts) {
    ctx.beginPath();
    ctx.moveTo(X(u), Y(p.beltV + 0.30));
    ctx.lineTo(X(u), Y(0.06));
    ctx.stroke();
  }

  // Character line
  ctx.beginPath();
  ctx.moveTo(X(0.10), Y(p.beltV - 0.16));
  ctx.lineTo(X(0.92), Y(p.beltV - 0.10));
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.lineWidth = Math.max(1, L * 0.005);
  ctx.stroke();

  // Rocker / skirt shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(X(0.92), Y(0.13), X(0.08) - X(0.92), Hb * 0.13);

  // Hood scoop
  if (p.scoop) {
    ctx.beginPath();
    ctx.moveTo(X(p.scoop.u), Y(p.scoop.v));
    ctx.lineTo(X(p.scoop.u - p.scoop.w * 0.15), Y(p.scoop.v + p.scoop.h));
    ctx.lineTo(X(p.scoop.u + p.scoop.w * 0.85), Y(p.scoop.v + p.scoop.h * 0.9));
    ctx.lineTo(X(p.scoop.u + p.scoop.w), Y(p.scoop.v));
    ctx.closePath();
    ctx.fillStyle = shade(art.paintDark, -0.1);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(X(p.scoop.u + p.scoop.w * 0.72), Y(p.scoop.v + p.scoop.h * 0.9),
      Math.abs(X(0) - X(p.scoop.w * 0.30)), Hb * p.scoop.h * 0.55);
  }

  ctx.restore(); // end clip

  // Body outline
  bodyPath(ctx, p, art, L, Hb, sillEff, wheelsMeta);
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.lineWidth = Math.max(1, L * 0.005);
  ctx.stroke();

  // -------- lamps
  const hl = p.head;
  ctx.beginPath();
  ctx.ellipse(X(hl.u), Y(hl.v), L * hl.w * 0.5, Hb * hl.h, 0, 0, Math.PI * 2);
  const lampOn = o.lights !== false;
  const lg = ctx.createLinearGradient(X(hl.u) - L * hl.w * 0.5, 0, X(hl.u) + L * hl.w * 0.5, 0);
  lg.addColorStop(0, lampOn ? '#fff8e0' : '#c3c9d0');
  lg.addColorStop(1, lampOn ? '#ffd98a' : '#7d858d');
  ctx.fillStyle = lg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = Math.max(1, L * 0.003);
  ctx.stroke();

  const tl = p.tail;
  ctx.beginPath();
  ctx.rect(X(tl.u) - L * tl.w * 0.5, Y(tl.v) - Hb * tl.h * 0.5, L * tl.w, Hb * tl.h);
  const brake = o.brake ?? 0;
  ctx.fillStyle = brake > 0.05 ? `rgb(255,${40 + (1 - brake) * 60 | 0},40)` : '#8e1b1b';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();
  if (brake > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bgl = ctx.createRadialGradient(X(tl.u), Y(tl.v), 1, X(tl.u), Y(tl.v), L * 0.10);
    bgl.addColorStop(0, `rgba(255,40,30,${0.55 * brake})`);
    bgl.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = bgl;
    ctx.beginPath();
    ctx.arc(X(tl.u), Y(tl.v), L * 0.10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Headlight cone at night
  if (o.lights && o.nightLights) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const cone = ctx.createLinearGradient(X(hl.u), Y(hl.v), X(hl.u) - L * 0.9, Y(hl.v));
    cone.addColorStop(0, 'rgba(255,240,200,0.30)');
    cone.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(X(hl.u), Y(hl.v));
    ctx.lineTo(X(hl.u) - L * 0.9, Y(hl.v + 0.55));
    ctx.lineTo(X(hl.u) - L * 0.9, Y(hl.v - 0.75));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Mirror
  if (p.mirror) {
    ctx.beginPath();
    ctx.moveTo(X(p.mirror[0]), Y(p.mirror[1]));
    ctx.lineTo(X(p.mirror[0] + 0.030), Y(p.mirror[1] + 0.055));
    ctx.lineTo(X(p.mirror[0] + 0.005), Y(p.mirror[1] + 0.060));
    ctx.closePath();
    ctx.fillStyle = art.trim || '#1a1d22';
    ctx.fill();
  }

  // Door handles
  ctx.fillStyle = shade(art.paint, 0.45);
  for (const h of p.handles) {
    ctx.fillRect(X(h[0]), Y(h[1]), Math.abs(X(0) - X(0.038)), Hb * 0.028);
  }

  // Wing
  if (p.wing) {
    ctx.fillStyle = art.trim || '#15181c';
    ctx.fillRect(X(p.wing.u + p.wing.w * 0.5), Y(p.wing.v), Math.abs(X(0) - X(p.wing.w)), Hb * p.wing.h);
    ctx.fillRect(X(p.wing.u + p.wing.w * 0.32), Y(p.wing.v), Math.abs(X(0) - X(0.012)), Hb * (p.wing.v - p.wing.strutV));
    ctx.fillRect(X(p.wing.u - p.wing.w * 0.30), Y(p.wing.v), Math.abs(X(0) - X(0.012)), Hb * (p.wing.v - p.wing.strutV));
  }

  // Exhaust
  if (p.exhaust) {
    ctx.beginPath();
    ctx.ellipse(X(p.exhaust.u), Y(p.exhaust.v), L * p.exhaust.r * 0.55, L * p.exhaust.r, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2e34';
    ctx.fill();
    ctx.strokeStyle = '#767d86';
    ctx.lineWidth = Math.max(1, L * 0.004);
    ctx.stroke();
  }
  if (p.sidePipe) {
    ctx.fillStyle = '#9aa2ab';
    ctx.fillRect(X(0.74), -sillEff - Hb * 0.02, Math.abs(X(0) - X(0.30)), Hb * 0.055);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(X(0.74), -sillEff - Hb * 0.02, Math.abs(X(0) - X(0.30)), Hb * 0.018);
  }
  if (p.wheelieBar) {
    ctx.strokeStyle = '#3d444c';
    ctx.lineWidth = Math.max(1.5, L * 0.008);
    ctx.beginPath();
    ctx.moveTo(X(0.95), -sillEff);
    ctx.lineTo(X(1.14), -wrr * 0.36);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(X(1.15), -wrr * 0.30, wrr * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1c20';
    ctx.fill();
  }

  ctx.restore(); // body transform

  // -------- if a real PNG exists, it replaces everything above
  if (img) {
    ctx.save();
    const scale = (art.imageScale || 1);
    const w = L * scale;
    const h = (img.naturalHeight / img.naturalWidth) * w;
    ctx.translate(pivotX, -wr * 0.9);
    ctx.rotate(-pitch * 0.55);
    ctx.translate(-pivotX, wr * 0.9);
    // Clear the procedural body first so they do not double up.
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(img, -(w - L) * 0.5, -h + (art.imageBaseline ?? 0) * L, w, h);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Convenience: draw a car centred in a box, used by the garage, dealership
 * and result screens. Returns the length that was used.
 */
export function drawCarInBox(ctx, car, x, y, w, h, opts = {}) {
  const art = car.art || {};
  const p = profileFor(art);
  const wr = art.wheels?.radius ?? 0.15;
  const totalH = (p.bodyH * (art.heightScale ?? 1)) + wr * (art.rideHeight ?? 0.3) + wr * 2 * 0.06 + wr;
  const byW = w * 0.92;
  const byH = (h * 0.86) / totalH;
  const L = Math.min(byW, byH);
  ctx.save();
  ctx.translate(x + w * 0.5 - L * 0.5, y + h * 0.5 + (totalH * L) * 0.5 - L * (wr * 0.1));
  drawCar(ctx, car, { length: L, ...opts });
  ctx.restore();
  return L;
}
