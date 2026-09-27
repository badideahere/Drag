// js/ui/dyno.js
// The dyno. It calls dynoSweep() from js/sim/build.js, which instantiates the
// same Engine class the race uses — so the graph physically cannot disagree
// with what the car does on the track.

import { dynoSweep, specSummary } from '../sim/build.js';
import { el } from './common.js';

const COL = {
  hp: '#ffb000',
  tq: '#43cfd6',
  boost: '#e5342a',
  grid: 'rgba(141,148,158,0.16)',
  axis: 'rgba(141,148,158,0.5)',
  text: '#8d949e',
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} spec resolved vehicle spec
 * @param {object} compareSpec optional second spec drawn as a ghost curve
 */
export function drawDyno(canvas, spec, compareSpec = null) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, rect.width * dpr);
  canvas.height = Math.max(200, rect.height * dpr);
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const s = H / 360;

  const pts = dynoSweep(spec, 100);
  const ghost = compareSpec ? dynoSweep(compareSpec, 100) : null;
  if (!pts.length) return;

  const padL = 52 * s, padR = 52 * s, padT = 22 * s, padB = 34 * s;
  const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;

  const rpmMin = pts[0].rpm, rpmMax = pts[pts.length - 1].rpm;
  const all = ghost ? pts.concat(ghost) : pts;
  const maxHp = Math.max(...all.map((p) => p.hp)) * 1.12;
  const maxTq = Math.max(...all.map((p) => p.torqueLbFt)) * 1.12;
  const maxBoost = Math.max(0.1, ...all.map((p) => p.boostPsi)) * 1.25;

  const X = (rpm) => x0 + ((rpm - rpmMin) / (rpmMax - rpmMin)) * (x1 - x0);
  const Yhp = (v) => y1 - (v / maxHp) * (y1 - y0);
  const Ytq = (v) => y1 - (v / maxTq) * (y1 - y0);
  const Yb = (v) => y1 - (v / maxBoost) * (y1 - y0);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(16,18,22,0.6)';
  ctx.fillRect(0, 0, W, H);

  // grid
  ctx.strokeStyle = COL.grid;
  ctx.lineWidth = 1;
  ctx.font = `500 ${10 * s}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.fillStyle = COL.text;
  ctx.textAlign = 'center';
  for (let r = Math.ceil(rpmMin / 1000) * 1000; r <= rpmMax; r += 1000) {
    const x = X(r);
    ctx.beginPath();
    ctx.moveTo(x, y0); ctx.lineTo(x, y1);
    ctx.stroke();
    ctx.fillText(String(r / 1000) + 'k', x, y1 + 16 * s);
  }
  for (let i = 0; i <= 4; i++) {
    const y = y0 + (i / 4) * (y1 - y0);
    ctx.beginPath();
    ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillStyle = COL.hp;
    ctx.fillText(Math.round(maxHp * (1 - i / 4)), x0 - 8 * s, y + 4 * s);
    ctx.textAlign = 'left';
    ctx.fillStyle = COL.tq;
    ctx.fillText(Math.round(maxTq * (1 - i / 4)), x1 + 8 * s, y + 4 * s);
    ctx.fillStyle = COL.text;
  }

  // redline
  const rl = spec.engine.redlineRpm;
  if (rl <= rpmMax) {
    ctx.strokeStyle = 'rgba(229,52,42,0.5)';
    ctx.setLineDash([4 * s, 4 * s]);
    ctx.beginPath(); ctx.moveTo(X(rl), y0); ctx.lineTo(X(rl), y1); ctx.stroke();
    ctx.setLineDash([]);
  }

  const line = (data, yFn, key, color, width, dash) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width * s;
    ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash(dash.map((d) => d * s));
    ctx.beginPath();
    data.forEach((p, i) => {
      const x = X(p.rpm), y = yFn(p[key]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  };

  if (ghost) {
    line(ghost, Yhp, 'hp', 'rgba(255,176,0,0.28)', 2);
    line(ghost, Ytq, 'torqueLbFt', 'rgba(67,207,214,0.28)', 2);
  }
  if (maxBoost > 0.5) line(pts, Yb, 'boostPsi', COL.boost, 1.6, [5, 4]);
  line(pts, Ytq, 'torqueLbFt', COL.tq, 2.6);
  line(pts, Yhp, 'hp', COL.hp, 2.6);

  // peak markers
  const peakHp = pts.reduce((a, b) => (b.hp > a.hp ? b : a));
  const peakTq = pts.reduce((a, b) => (b.torqueLbFt > a.torqueLbFt ? b : a));
  const marker = (p, y, color, label) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(X(p.rpm), y, 3.4 * s, 0, Math.PI * 2); ctx.fill();
    ctx.font = `600 ${10 * s}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, X(p.rpm), y - 10 * s);
  };
  marker(peakHp, Yhp(peakHp.hp), COL.hp, `${Math.round(peakHp.hp)} hp`);
  marker(peakTq, Ytq(peakTq.torqueLbFt), COL.tq, `${Math.round(peakTq.torqueLbFt)} lb-ft`);

  // axis labels
  ctx.fillStyle = COL.text;
  ctx.font = `500 ${10 * s}px "Barlow Condensed", system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('HP', x0 - 44 * s, y0 - 6 * s);
  ctx.textAlign = 'right';
  ctx.fillText('LB-FT', x1 + 44 * s, y0 - 6 * s);
  ctx.textAlign = 'center';
  ctx.fillText('ENGINE RPM', (x0 + x1) / 2, H - 6 * s);
}

/** Legend + headline numbers to sit under the chart. */
export function dynoSummary(spec) {
  const s = specSummary(spec);
  return el('div', { class: 'dyno-summary' },
    el('div', { class: 'dyno-stat' }, el('b', {}, Math.round(s.peakHp)), el('span', {}, `HP @ ${s.peakHpRpm}`)),
    el('div', { class: 'dyno-stat' }, el('b', {}, Math.round(s.peakTorqueLbFt)), el('span', {}, `LB-FT @ ${s.peakTorqueRpm}`)),
    el('div', { class: 'dyno-stat' }, el('b', {}, Math.round(s.massLb)), el('span', {}, 'LB')),
    el('div', { class: 'dyno-stat' }, el('b', {}, s.powerToWeight.toFixed(0)), el('span', {}, 'HP / TONNE')),
    s.boostPsi > 0.2
      ? el('div', { class: 'dyno-stat' }, el('b', {}, s.boostPsi.toFixed(1)), el('span', {}, 'PSI BOOST'))
      : null);
}
