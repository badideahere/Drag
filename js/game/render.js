// js/game/render.js
// The track renderer: parallax environment, the strip itself, the Christmas
// tree, distance markers, scoreboards and both cars.
//
// World space: x = metres from the starting line, y = metres above the ground
// (positive up). Screen space is produced by the camera in `draw()`.

import { clamp, lerp, M_TO_FT, FT_TO_M } from '../sim/util.js';
import { drawCar } from './carart.js';

const PX_PER_M = 26;          // at zoom 1
const LANE_SEPARATION = 0.34; // how far up the screen the far lane sits

/* ------------------------------------------------------------ environments */

export const ENVIRONMENTS = {
  industrial: {
    id: 'industrial',
    name: 'Ironside Raceway',
    subtitle: 'Industrial Strip — Day',
    night: false,
    sky: ['#9fb4c8', '#c3cfd8', '#dfe2e0'],
    haze: 'rgba(214,220,226,0.55)',
    ground: '#6a6a63',
    groundFar: '#7b7a71',
    asphalt: '#3a3d42',
    asphaltDark: '#303338',
    prepped: '#1d1f23',
    wall: '#b9bcbe',
    wallTrim: '#2f3a4a',
    far: 'factories',
    mid: 'warehouses',
    trees: 0.15,
    lightPoles: false,
  },
  rural: {
    id: 'rural',
    name: 'Cedar Flats Dragway',
    subtitle: 'Rural Eighth & Quarter — Afternoon',
    night: false,
    sky: ['#4f8ecb', '#8cb9de', '#d6e2e8'],
    haze: 'rgba(206,222,232,0.40)',
    ground: '#6f7a45',
    groundFar: '#7f8a52',
    asphalt: '#43464a',
    asphaltDark: '#383b3f',
    prepped: '#222428',
    wall: '#c8c6bd',
    wallTrim: '#21501f',
    far: 'hills',
    mid: 'treeline',
    trees: 0.9,
    lightPoles: false,
  },
  night: {
    id: 'night',
    name: 'Midnight Industrial',
    subtitle: 'Night Strip — Lights On',
    night: true,
    sky: ['#070b14', '#101828', '#1b2434'],
    haze: 'rgba(28,38,54,0.55)',
    ground: '#1c1f22',
    groundFar: '#23262a',
    asphalt: '#26282c',
    asphaltDark: '#1e2024',
    prepped: '#141518',
    wall: '#4a4d51',
    wallTrim: '#1a2230',
    far: 'cityglow',
    mid: 'warehouses',
    trees: 0.1,
    lightPoles: true,
  },
  desert: {
    id: 'desert',
    name: 'Dry Lake Proving Ground',
    subtitle: 'Desert Test Facility — Midday',
    night: false,
    sky: ['#3f7fc4', '#8fc0e0', '#efe4cd'],
    haze: 'rgba(238,224,198,0.55)',
    ground: '#b09565',
    groundFar: '#c2a778',
    asphalt: '#4d4e4d',
    asphaltDark: '#424341',
    prepped: '#2b2c2b',
    wall: '#d8cdb4',
    wallTrim: '#8a5f36',
    far: 'mesas',
    mid: 'scrub',
    trees: 0.05,
    lightPoles: false,
    shimmer: true,
  },
};

export const ENVIRONMENT_LIST = Object.values(ENVIRONMENTS);

/* --------------------------------------------------------- static bakeries */

function bakeSkyline(env, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const rnd = mulberry(env.id.length * 7919 + 13);

  if (env.far === 'hills' || env.far === 'mesas') {
    const base = env.far === 'hills' ? '#5d7a5a' : '#9c7852';
    for (let layer = 0; layer < 3; layer++) {
      g.beginPath();
      g.moveTo(0, h);
      let y = h * (0.62 + layer * 0.10);
      for (let x = 0; x <= w; x += 28) {
        const n = Math.sin(x * 0.0037 + layer * 2.4) * 0.5 + Math.sin(x * 0.011 + layer) * 0.5;
        const yy = y - n * h * (env.far === 'mesas' ? 0.10 : 0.16);
        if (env.far === 'mesas' && ((x / 160) | 0) % 3 === 0) {
          g.lineTo(x, yy - h * 0.10);
          g.lineTo(x + 90, yy - h * 0.10);
          g.lineTo(x + 90, yy);
        } else {
          g.lineTo(x, yy);
        }
      }
      g.lineTo(w, h);
      g.closePath();
      g.fillStyle = mix(base, '#c9d6de', 0.55 - layer * 0.22);
      g.fill();
    }
    return c;
  }

  // Factory / warehouse / city silhouettes
  let x = 0;
  while (x < w) {
    const bw = 40 + rnd() * 130;
    const bh = h * (0.22 + rnd() * 0.5);
    const y = h - bh;
    g.fillStyle = env.night
      ? `rgb(${(16 + rnd() * 10) | 0},${(22 + rnd() * 10) | 0},${(34 + rnd() * 12) | 0})`
      : mix('#7d8590', '#c6cdd4', 0.35 + rnd() * 0.3);
    g.fillRect(x, y, bw, bh);
    // roof furniture
    if (rnd() > 0.55) g.fillRect(x + bw * 0.2, y - 8 - rnd() * 14, bw * 0.16, 14);
    // chimney
    if (env.far === 'factories' && rnd() > 0.7) {
      const cw = 9 + rnd() * 6;
      g.fillRect(x + bw * 0.6, y - h * 0.34, cw, h * 0.34);
    }
    // windows
    const lit = env.night;
    for (let wy = y + 10; wy < h - 10; wy += 16) {
      for (let wx = x + 7; wx < x + bw - 10; wx += 14) {
        if (rnd() > (lit ? 0.55 : 0.4)) continue;
        g.fillStyle = lit
          ? `rgba(255,${190 + rnd() * 50 | 0},${120 + rnd() * 70 | 0},${0.45 + rnd() * 0.5})`
          : 'rgba(40,48,58,0.45)';
        g.fillRect(wx, wy, 7, 9);
      }
    }
    x += bw + 6 + rnd() * 26;
  }
  return c;
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a, b, t) {
  const pa = hex(a), pb = hex(b);
  return `rgb(${lerp(pa[0], pb[0], t) | 0},${lerp(pa[1], pb[1], t) | 0},${lerp(pa[2], pb[2], t) | 0})`;
}
function hex(h) {
  if (h.startsWith('rgb')) {
    const m = h.match(/\d+/g).map(Number);
    return [m[0], m[1], m[2]];
  }
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ------------------------------------------------------------- the renderer */

export class Renderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.env = ENVIRONMENTS[opts.environment] || ENVIRONMENTS.industrial;
    this.quality = opts.quality || 'high';
    this.reduced = !!opts.reduced;
    this.shake = 0;
    this.shakeEnabled = opts.screenShake !== false;
    this.camX = 0;
    this.camZoom = 1;
    this.skyline = null;
    this.dpr = 1;
    this.resize();
  }

  setEnvironment(id) {
    this.env = ENVIRONMENTS[id] || this.env;
    this.skyline = null;
  }

  setQuality(q, reduced) { this.quality = q; this.reduced = !!reduced; }

  resize() {
    const c = this.canvas;
    const rect = c.getBoundingClientRect();
    const maxDpr = this.quality === 'low' ? 1 : this.quality === 'medium' ? 1.5 : 2;
    this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = Math.max(320, Math.round(rect.width * this.dpr));
    const h = Math.max(200, Math.round(rect.height * this.dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.w = c.width;
    this.h = c.height;
    this.skyline = null;
  }

  addShake(amount) {
    if (!this.shakeEnabled || this.reduced) return;
    this.shake = Math.min(1, this.shake + amount);
  }

  /**
   * @param {object} s {
   *   dt, time,
   *   player: { car, vehicle, telemetry },
   *   opponent: { car, vehicle, telemetry } | null,
   *   race: RaceSession | null,
   *   particles: ParticleSystem,
   *   distanceM: total race length in metres
   * }
   */
  draw(s) {
    const ctx = this.ctx;
    const env = this.env;
    const W = this.w, H = this.h;
    const dt = s.dt || 0.016;

    this.shake = Math.max(0, this.shake - dt * 2.6);

    // ---------------- camera
    const focus = s.player?.vehicle?.position ?? 0;
    const speed = s.player?.vehicle?.speed ?? 0;
    const lead = clamp(speed * 0.55, 0, 26);
    const targetZoom = clamp(1.05 - speed / 190, 0.58, 1.05);
    this.camZoom += (targetZoom - this.camZoom) * clamp(dt * 1.6, 0, 1);
    const targetCam = focus + lead;
    this.camX += (targetCam - this.camX) * clamp(dt * 7, 0, 1);

    const scale = PX_PER_M * this.camZoom * (H / 720);
    const horizon = H * 0.46;
    const groundY = H * 0.795;      // near-lane ground line
    const farGroundY = groundY - H * 0.17 * LANE_SEPARATION * 2;

    const wx = (m) => W * 0.30 + (m - this.camX) * scale;

    ctx.save();
    if (this.shake > 0.002) {
      const k = this.shake * this.shake * 9 * this.dpr;
      ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }

    // ---------------- sky
    const sky = ctx.createLinearGradient(0, 0, 0, horizon + H * 0.1);
    sky.addColorStop(0, env.sky[0]);
    sky.addColorStop(0.62, env.sky[1]);
    sky.addColorStop(1, env.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon + H * 0.12);

    if (env.night) this.drawStars(ctx, W, horizon);
    else this.drawClouds(ctx, W, horizon, s.time || 0);

    // ---------------- far parallax: skyline / hills
    if (!this.skyline) this.skyline = bakeSkyline(env, Math.max(1400, W), Math.round(H * 0.26));
    const sl = this.skyline;
    const farScroll = -(this.camX * scale * 0.045) % sl.width;
    ctx.save();
    ctx.globalAlpha = env.night ? 0.95 : 0.8;
    for (let i = -1; i < Math.ceil(W / sl.width) + 1; i++) {
      ctx.drawImage(sl, farScroll + i * sl.width, horizon - sl.height + H * 0.03);
    }
    ctx.restore();

    // haze band at the horizon
    const hz = ctx.createLinearGradient(0, horizon - H * 0.10, 0, horizon + H * 0.06);
    hz.addColorStop(0, 'rgba(0,0,0,0)');
    hz.addColorStop(1, env.haze);
    ctx.fillStyle = hz;
    ctx.fillRect(0, horizon - H * 0.10, W, H * 0.16);

    // ---------------- ground plane behind the strip
    const gg = ctx.createLinearGradient(0, horizon, 0, H);
    gg.addColorStop(0, env.groundFar);
    gg.addColorStop(1, env.ground);
    ctx.fillStyle = gg;
    ctx.fillRect(0, horizon, W, H - horizon);

    // ---------------- mid parallax
    this.drawMidLayer(ctx, W, H, horizon, scale);

    // ---------------- grandstands + far wall
    this.drawGrandstands(ctx, W, H, horizon, wx, scale);

    // ---------------- the strip
    this.drawStrip(ctx, W, H, groundY, farGroundY, wx, scale, s);

    // ---------------- far lane car
    if (s.opponent) {
      this.drawCarOnTrack(ctx, s.opponent, wx, farGroundY, scale * 0.86, true, s);
    }

    // ---------------- particles are spawned in world px around the near lane
    if (s.particles) {
      ctx.save();
      ctx.translate(wx(0), groundY);
      ctx.scale(scale / PX_PER_M, scale / PX_PER_M);
      s.particles.draw(ctx);
      ctx.restore();
    }

    // ---------------- near lane car
    if (s.player) {
      this.drawCarOnTrack(ctx, s.player, wx, groundY, scale, false, s);
    }

    // ---------------- the Christmas tree (near the startline, foreground)
    if (s.race) this.drawTree(ctx, s.race, wx, groundY, scale, H);

    // ---------------- finish line gear
    this.drawFinish(ctx, s, wx, groundY, farGroundY, scale, H);

    // ---------------- foreground guard rail blur
    this.drawForeground(ctx, W, H, groundY, scale);

    if (env.shimmer && !this.reduced) this.drawShimmer(ctx, W, H, horizon, s.time || 0);
    if (env.night) this.drawNightVignette(ctx, W, H);

    ctx.restore();
  }

  /* ------------------------------------------------------------- pieces */

  drawStars(ctx, W, horizon) {
    if (!this._stars) {
      const r = mulberry(4242);
      this._stars = Array.from({ length: 150 }, () => ({
        x: r(), y: r(), s: r() * 1.5 + 0.3, a: 0.3 + r() * 0.7,
      }));
    }
    ctx.fillStyle = '#fff';
    for (const st of this._stars) {
      ctx.globalAlpha = st.a * 0.7;
      ctx.fillRect(st.x * W, st.y * horizon * 0.86, st.s, st.s);
    }
    ctx.globalAlpha = 1;
  }

  drawClouds(ctx, W, horizon, t) {
    if (!this._clouds) {
      const r = mulberry(99);
      this._clouds = Array.from({ length: 9 }, () => ({
        x: r(), y: 0.1 + r() * 0.5, s: 0.5 + r() * 1.2, sp: 0.2 + r() * 0.5,
      }));
    }
    ctx.save();
    ctx.globalAlpha = 0.55;
    for (const c of this._clouds) {
      const x = ((c.x + t * 0.0015 * c.sp) % 1.3 - 0.15) * W;
      const y = c.y * horizon * 0.7;
      const rr = 26 * c.s * (this.h / 720);
      const g = ctx.createRadialGradient(x, y, 1, x, y, rr * 3);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rr * 3, rr, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawMidLayer(ctx, W, H, horizon, scale) {
    const env = this.env;
    const px = -(this.camX * scale * 0.19);
    const step = 220;
    const y = horizon + H * 0.035;
    ctx.save();
    for (let i = -2; i < W / step + 3; i++) {
      const x = ((px % step) + i * step);
      if (env.mid === 'treeline' || env.trees > 0.4) {
        this.tree(ctx, x, y, H * 0.085, '#2f4a2c');
        this.tree(ctx, x + 70, y + 4, H * 0.065, '#38562f');
      } else if (env.mid === 'scrub') {
        ctx.fillStyle = '#8a7a52';
        ctx.fillRect(x, y - 5, 16, 5);
        ctx.fillRect(x + 90, y - 4, 11, 4);
      } else {
        ctx.fillStyle = env.night ? '#1b212c' : '#8e949b';
        const hh = H * (0.05 + ((i * 37) % 11) / 90);
        ctx.fillRect(x, y - hh, 120, hh);
        ctx.fillStyle = env.night ? 'rgba(255,200,120,0.25)' : 'rgba(60,70,80,0.3)';
        for (let k = 0; k < 4; k++) ctx.fillRect(x + 12 + k * 26, y - hh * 0.6, 12, 10);
      }
      if (env.lightPoles && i % 2 === 0) this.lightPole(ctx, x + 40, y, H);
    }
    ctx.restore();
  }

  tree(ctx, x, groundY, h, color) {
    ctx.fillStyle = '#3a2d22';
    ctx.fillRect(x - 2, groundY - h * 0.3, 4, h * 0.3);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, groundY - h);
    ctx.lineTo(x - h * 0.34, groundY - h * 0.22);
    ctx.lineTo(x + h * 0.34, groundY - h * 0.22);
    ctx.closePath();
    ctx.fill();
  }

  lightPole(ctx, x, groundY, H) {
    const h = H * 0.26;
    ctx.strokeStyle = '#2a2f36';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.lineTo(x, groundY - h);
    ctx.stroke();
    ctx.fillStyle = '#39414b';
    ctx.fillRect(x - 16, groundY - h - 8, 32, 9);
    const g = ctx.createRadialGradient(x, groundY - h, 2, x, groundY - h, 110);
    g.addColorStop(0, 'rgba(255,230,170,0.35)');
    g.addColorStop(1, 'rgba(255,230,170,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, groundY - h, 110, 0, Math.PI * 2);
    ctx.fill();
  }

  drawGrandstands(ctx, W, H, horizon, wx, scale) {
    const env = this.env;
    const y = horizon + H * 0.055;
    const h = H * 0.105;
    const x0 = wx(-40), x1 = wx(210);
    if (x1 < 0 || x0 > W) return;
    ctx.save();
    // structure
    ctx.fillStyle = env.night ? '#20252d' : '#9aa0a6';
    ctx.fillRect(x0, y - h, x1 - x0, h);
    // seating rows
    for (let i = 0; i < 7; i++) {
      const ry = y - h + (i / 7) * h;
      ctx.fillStyle = env.night ? 'rgba(12,16,22,0.6)' : 'rgba(70,78,88,0.35)';
      ctx.fillRect(x0, ry, x1 - x0, h / 14);
      // crowd speckle
      if (!this.reduced) {
        const r = mulberry(i * 31 + 7);
        ctx.fillStyle = env.night ? 'rgba(90,100,120,0.5)' : 'rgba(40,46,58,0.5)';
        for (let x = x0; x < x1; x += 7) {
          if (r() > 0.45) ctx.fillRect(x, ry - 3, 3, 4);
        }
      }
    }
    // roof
    ctx.fillStyle = env.night ? '#161b22' : '#7d848b';
    ctx.fillRect(x0 - 6, y - h - H * 0.018, (x1 - x0) + 12, H * 0.018);
    ctx.restore();
  }

  drawStrip(ctx, W, H, groundY, farGroundY, wx, scale, s) {
    const env = this.env;
    const laneH = H * 0.085;
    const totalM = s.distanceM || 402.336;

    // --- far lane surface
    this.laneSurface(ctx, W, wx, farGroundY, laneH * 0.82, scale, env, 0.86);
    // centre divider / guard wall between the lanes
    ctx.fillStyle = env.wall;
    ctx.fillRect(0, farGroundY + laneH * 0.82, W, H * 0.012);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, farGroundY + laneH * 0.82 + H * 0.012, W, H * 0.006);

    // --- near lane surface
    this.laneSurface(ctx, W, wx, groundY, laneH, scale, env, 1);

    // --- markings on the near lane
    ctx.save();
    ctx.lineWidth = Math.max(1.5, scale * 0.09);
    // guide line down the middle of the groove
    ctx.strokeStyle = 'rgba(232,234,236,0.28)';
    ctx.setLineDash([scale * 1.6, scale * 2.4]);
    ctx.beginPath();
    ctx.moveTo(0, groundY - laneH * 0.55);
    ctx.lineTo(W, groundY - laneH * 0.55);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // --- start line + staging beams
    this.stripLine(ctx, wx(0), groundY, laneH, '#e8eaed', scale, 0.32);
    this.stripLine(ctx, wx(-0.55), groundY, laneH, 'rgba(232,234,236,0.55)', scale, 0.16);

    // --- distance markers
    const marks = [
      { ft: 60, label: '60' },
      { ft: 330, label: '330' },
      { ft: 660, label: '1/8' },
      { ft: 1000, label: '1000' },
      { ft: 1320, label: '1/4' },
    ];
    for (const m of marks) {
      const mm = m.ft * FT_TO_M;
      if (mm > totalM + 1) continue;
      const x = wx(mm);
      if (x < -60 || x > W + 60) continue;
      this.stripLine(ctx, x, groundY, laneH, 'rgba(232,234,236,0.65)', scale, 0.12);
      // cone + sign on the wall side
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath();
      ctx.moveTo(x, groundY - laneH * 1.02);
      ctx.lineTo(x - scale * 0.22, groundY - laneH * 0.86);
      ctx.lineTo(x + scale * 0.22, groundY - laneH * 0.86);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(232,234,236,0.75)';
      ctx.font = `600 ${Math.max(9, scale * 0.42)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(m.label, x, groundY - laneH * 1.12);
    }

    // --- outside wall with sponsor banners
    const wallTop = groundY - laneH * 1.55;
    ctx.fillStyle = env.wall;
    ctx.fillRect(0, wallTop, W, laneH * 0.42);
    ctx.fillStyle = env.wallTrim;
    ctx.fillRect(0, wallTop, W, laneH * 0.10);
    const banners = ['STAGED', 'TRACTION CO.', 'NITRO FUELS', 'APEX TIRE', 'IRONSIDE', 'DIAL-IN'];
    ctx.save();
    ctx.font = `700 ${Math.max(8, scale * 0.36)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const spacing = 22;
    const first = Math.floor((this.camX - 40) / spacing);
    for (let i = first; i < first + Math.ceil(W / (spacing * scale)) + 4; i++) {
      const x = wx(i * spacing);
      if (x < -140 || x > W + 140) continue;
      const b = banners[((i % banners.length) + banners.length) % banners.length];
      ctx.fillStyle = i % 2 ? 'rgba(20,24,30,0.85)' : 'rgba(46,54,66,0.85)';
      ctx.fillRect(x - scale * 4.5, wallTop + laneH * 0.11, scale * 9, laneH * 0.29);
      ctx.fillStyle = 'rgba(232,234,236,0.82)';
      ctx.fillText(b, x, wallTop + laneH * 0.255);
    }
    ctx.restore();
  }

  laneSurface(ctx, W, wx, gy, laneH, scale, env, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(0, gy - laneH * 1.6, 0, gy + laneH * 0.3);
    g.addColorStop(0, env.asphaltDark);
    g.addColorStop(0.5, env.asphalt);
    g.addColorStop(1, env.asphaltDark);
    ctx.fillStyle = g;
    ctx.fillRect(0, gy - laneH * 1.6, W, laneH * 1.9);

    // The prepped groove: darker, glossier VHT down the racing line.
    const grooveTop = gy - laneH * 1.05;
    const gr = ctx.createLinearGradient(0, grooveTop, 0, gy + laneH * 0.18);
    gr.addColorStop(0, env.prepped);
    gr.addColorStop(0.6, mix(env.prepped, env.asphalt, 0.25));
    gr.addColorStop(1, env.prepped);
    ctx.fillStyle = gr;
    ctx.fillRect(0, grooveTop, W, laneH * 1.23);

    // Longitudinal texture streaks so speed reads on screen.
    const stepPx = 3.2 * scale;
    const offPx = (((wx(0) % stepPx) + stepPx) % stepPx);
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    for (let x = offPx - stepPx; x < W + stepPx; x += stepPx) {
      ctx.beginPath();
      ctx.moveTo(x, grooveTop + laneH * 0.1);
      ctx.lineTo(x - scale * 0.9, gy + laneH * 0.1);
      ctx.stroke();
    }
    // Rubber build-up along the launch area
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(wx(-6), grooveTop + laneH * 0.2, Math.max(0, wx(58) - wx(-6)), laneH * 0.9);
    ctx.restore();
  }

  stripLine(ctx, x, gy, laneH, color, scale, wFrac) {
    if (x < -20 || x > this.w + 20) return;
    ctx.fillStyle = color;
    ctx.fillRect(x - scale * wFrac * 0.5, gy - laneH * 1.05, Math.max(1.5, scale * wFrac), laneH * 1.23);
  }

  drawCarOnTrack(ctx, entry, wx, gy, scale, far, s) {
    const v = entry.vehicle;
    const car = entry.car;
    const art = car.art || {};
    const lengthM = (art.lengthPx || 420) / 90; // ~4.6 m for a 420px car
    const L = lengthM * scale;
    const x = wx(v.position);
    if (x < -L * 2 || x > this.w + L * 2) return;

    const tel = entry.telemetry || v.telemetry?.();
    const wheelAngle = entry.wheelAngle ?? 0;
    const rearOmega = tel?.tiresRear?.omega ?? 0;
    const frontOmega = tel?.tiresFront?.omega ?? 0;
    const drive = car.drivetrain;
    const rearSpin = clamp((Math.abs(rearOmega) * (art.wheels?.rearRadius ?? 0.15) * 3 - Math.abs(v.speed)) / 22, 0, 1);

    ctx.save();
    ctx.translate(x, gy);
    if (far) ctx.globalAlpha = 0.97;
    drawCar(ctx, car, {
      length: L,
      wheelAngle: entry.frontWheelAngle ?? wheelAngle,
      rearWheelAngle: entry.rearWheelAngle ?? wheelAngle,
      suspensionF: v.suspensionF,
      suspensionR: v.suspensionR,
      pitch: (v.pitch || 0) + (v.wheelieHeight || 0) * 1.1,
      brake: entry.brake ?? 0,
      lights: true,
      nightLights: this.env.night,
      rearSpin: drive === 'FWD' ? 0 : rearSpin,
      frontSpin: drive === 'RWD' ? 0 : rearSpin,
      shadow: true,
    });
    ctx.restore();
  }

  /** The Christmas tree, standing between the lanes at the startline. */
  drawTree(ctx, race, wx, gy, scale, H) {
    const x = wx(-2.6);
    if (x < -200 || x > this.w + 200) return;
    const poleH = H * 0.30;
    const top = gy - H * 0.10 - poleH;
    const bulbR = Math.max(4, scale * 0.30);
    const colW = bulbR * 3.0;

    ctx.save();
    // post
    ctx.fillStyle = '#2b3138';
    ctx.fillRect(x - colW * 0.12, gy - H * 0.10, colW * 0.24, H * 0.10);
    // housing
    ctx.fillStyle = '#15181d';
    ctx.strokeStyle = '#3a424c';
    ctx.lineWidth = 2;
    const hx = x - colW * 0.5, hy = top, hw = colW, hh = poleH;
    ctx.fillRect(hx, hy, hw, hh);
    ctx.strokeRect(hx, hy, hw, hh);

    const lights = race.treeLights || {};
    const cx = x;
    let y = hy + bulbR * 2.0;

    const bulb = (yy, on, colorOn, colorOff, r = bulbR) => {
      ctx.beginPath();
      ctx.arc(cx, yy, r, 0, Math.PI * 2);
      ctx.fillStyle = on ? colorOn : colorOff;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (on) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(cx, yy, 1, cx, yy, r * 4.5);
        g.addColorStop(0, colorOn.replace('rgb', 'rgba').replace(')', ',0.55)'));
        g.addColorStop(1, colorOn.replace('rgb', 'rgba').replace(')', ',0)'));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, yy, r * 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    // pre-stage / stage (small blue-white)
    bulb(y, lights.preStage, 'rgb(255,250,215)', '#3a3a2e', bulbR * 0.72); y += bulbR * 2.1;
    bulb(y, lights.stage, 'rgb(255,250,215)', '#3a3a2e', bulbR * 0.72); y += bulbR * 2.8;
    // three ambers
    bulb(y, lights.amber1, 'rgb(255,176,0)', '#3a2f12'); y += bulbR * 2.6;
    bulb(y, lights.amber2, 'rgb(255,176,0)', '#3a2f12'); y += bulbR * 2.6;
    bulb(y, lights.amber3, 'rgb(255,176,0)', '#3a2f12'); y += bulbR * 2.6;
    // green
    bulb(y, lights.green, 'rgb(47,211,95)', '#123521'); y += bulbR * 2.6;
    // red
    bulb(y, lights.red, 'rgb(229,52,42)', '#3a1513');

    ctx.restore();
  }

  drawFinish(ctx, s, wx, gy, farGy, scale, H) {
    const total = s.distanceM || 402.336;
    const x = wx(total);
    if (x < -250 || x > this.w + 250) return;
    const laneH = H * 0.085;

    // finish stripe
    ctx.save();
    const stripeW = Math.max(3, scale * 0.5);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 ? '#0d0f12' : '#e8eaed';
      ctx.fillRect(x - stripeW / 2, gy - laneH * 1.05 + (i / 10) * laneH * 1.23,
        stripeW, laneH * 0.123);
    }
    // gantry
    const gTop = gy - H * 0.34;
    ctx.fillStyle = '#242a31';
    ctx.fillRect(x - scale * 0.35, gTop, scale * 0.7, H * 0.34);
    ctx.fillRect(x - scale * 7, gTop - H * 0.03, scale * 14, H * 0.03);
    // win light boards
    ctx.fillStyle = '#12151a';
    ctx.fillRect(x - scale * 6.4, gTop - H * 0.022, scale * 5.2, H * 0.022);
    ctx.fillRect(x + scale * 1.2, gTop - H * 0.022, scale * 5.2, H * 0.022);
    const winner = s.race?.winner;
    ctx.fillStyle = winner === 'player' ? '#2fd35f' : '#1c2a20';
    ctx.fillRect(x + scale * 1.4, gTop - H * 0.019, scale * 4.8, H * 0.016);
    ctx.fillStyle = winner === 'opponent' ? '#2fd35f' : '#1c2a20';
    ctx.fillRect(x - scale * 6.2, gTop - H * 0.019, scale * 4.8, H * 0.016);
    ctx.restore();
  }

  drawForeground(ctx, W, H, gy, scale) {
    const y = H * 0.935;
    ctx.save();
    ctx.fillStyle = this.env.night ? 'rgba(8,10,14,0.92)' : 'rgba(40,44,50,0.55)';
    ctx.fillRect(0, y, W, H - y);
    // blurred rail posts flying past
    const step = 9 * scale;                      // post spacing in px
    const off = (((-this.camX * 1.28 * scale) % step) + step) % step;
    ctx.fillStyle = this.env.night ? 'rgba(20,24,30,0.9)' : 'rgba(120,126,134,0.5)';
    for (let x = -step + off; x < W + step; x += step) {
      ctx.fillRect(x, y - H * 0.03, Math.max(2, scale * 0.6), H * 0.03);
    }
    const g = ctx.createLinearGradient(0, y - H * 0.06, 0, y + 4);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, this.env.night ? 'rgba(6,8,12,0.9)' : 'rgba(30,34,40,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - H * 0.06, W, H * 0.06 + 4);
    ctx.restore();
  }

  drawShimmer(ctx, W, H, horizon, t) {
    ctx.save();
    ctx.globalAlpha = 0.10;
    for (let i = 0; i < 6; i++) {
      const y = horizon + i * 5 + Math.sin(t * 2 + i) * 2;
      ctx.fillStyle = '#fff6e0';
      ctx.fillRect(0, y, W, 2);
    }
    ctx.restore();
  }

  drawNightVignette(ctx, W, H) {
    const g = ctx.createRadialGradient(W * 0.5, H * 0.55, H * 0.25, W * 0.5, H * 0.55, H * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /** Convert a world position to the particle-space origin used in draw(). */
  worldToParticle(posM, groundOffset = 0) {
    return { x: posM * PX_PER_M, y: -groundOffset * PX_PER_M };
  }
}

export { PX_PER_M };
