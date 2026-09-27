// js/ui/tuning.js
// The tuning bench. Every control here maps directly onto a value the physics
// engine reads, and every value is clamped by sanitizeTuning() — the same
// function the server runs again before it will store anything.

import { TUNING_LIMITS, defaultTuning, sanitizeTuning, buildVehicleSpec, specSummary } from '../sim/build.js';
import { getCar } from '../data/cars.js';
import { el, guardButton, toastSuccess, toastError } from './common.js';
import { clamp, radToRpm, MPS_TO_MPH } from '../sim/util.js';
import * as api from '../net/api.js';

/**
 * @param {HTMLElement} container
 * @param {object} ctx { playerCar, onSaved(tuning) }
 */
export function renderTuning(container, ctx) {
  container.replaceChildren();
  const pc = ctx.playerCar;
  const base = getCar(pc.carId);
  let tuning = sanitizeTuning(pc.carId, pc.tuning || defaultTuning(pc.carId));

  const spec = buildVehicleSpec(pc.carId, { upgrades: pc.upgrades, tuning });
  const gearCount = spec.gearbox.ratios.length;
  const aspirated = spec.engine.aspiration !== 'na';

  const speedChart = el('canvas', { class: 'gear-chart', height: 260 });
  const readout = el('div', { class: 'tune-readout' });

  function rebuild() {
    tuning = sanitizeTuning(pc.carId, tuning);
    const s = buildVehicleSpec(pc.carId, { upgrades: pc.upgrades, tuning });
    drawGearChart(speedChart, s);
    renderReadout(readout, s, tuning);
  }

  const rows = [];

  rows.push(sliderRow({
    label: 'Final drive',
    value: tuning.finalDrive,
    min: TUNING_LIMITS.finalDrive.min,
    max: TUNING_LIMITS.finalDrive.max,
    step: 0.01,
    fmt: (v) => v.toFixed(2),
    note: 'Numerically higher accelerates harder and tops out sooner.',
    onInput: (v) => { tuning.finalDrive = v; rebuild(); },
  }));

  for (let i = 0; i < gearCount; i++) {
    rows.push(sliderRow({
      label: `Gear ${i + 1}`,
      value: tuning.gearRatios[i],
      min: TUNING_LIMITS.gearRatio.min,
      max: Math.min(TUNING_LIMITS.gearRatio.max, i === 0 ? 5.0 : tuning.gearRatios[i - 1]),
      step: 0.01,
      fmt: (v) => v.toFixed(2),
      onInput: (v) => { tuning.gearRatios[i] = v; rebuild(); },
    }));
  }

  rows.push(sliderRow({
    label: 'Rear tire pressure',
    value: tuning.rearPsi,
    min: TUNING_LIMITS.pressurePsi.min,
    max: TUNING_LIMITS.pressurePsi.max,
    step: 0.5,
    fmt: (v) => `${v.toFixed(1)} psi`,
    note: 'Lower pressure puts more rubber down but heats and wears faster.',
    onInput: (v) => { tuning.rearPsi = v; rebuild(); },
  }));
  rows.push(sliderRow({
    label: 'Front tire pressure',
    value: tuning.frontPsi,
    min: TUNING_LIMITS.pressurePsi.min,
    max: TUNING_LIMITS.pressurePsi.max,
    step: 0.5,
    fmt: (v) => `${v.toFixed(1)} psi`,
    onInput: (v) => { tuning.frontPsi = v; rebuild(); },
  }));

  rows.push(sliderRow({
    label: 'Launch rpm',
    value: tuning.launchRpm,
    min: spec.engine.idleRpm,
    max: spec.engine.limiterRpm,
    step: 50,
    fmt: (v) => `${Math.round(v)} rpm`,
    note: 'Where the auto-clutch and the AI aim to leave from.',
    onInput: (v) => { tuning.launchRpm = v; rebuild(); },
  }));
  rows.push(sliderRow({
    label: 'Shift rpm',
    value: tuning.shiftRpm,
    min: 2000,
    max: spec.engine.floatRpm,
    step: 50,
    fmt: (v) => `${Math.round(v)} rpm`,
    note: 'Auto-shift point. Above the limiter simply means "bounce it".',
    onInput: (v) => { tuning.shiftRpm = v; rebuild(); },
  }));

  if (aspirated) {
    const maxBoost = spec.engine.turbo?.maxBoostKpa
      ?? spec.engine.supercharger?.maxBoostKpa ?? 200;
    rows.push(sliderRow({
      label: 'Boost target',
      value: tuning.boostTargetKpa,
      min: 0,
      max: Math.min(TUNING_LIMITS.boostTargetKpa.max, maxBoost),
      step: 1,
      fmt: (v) => `${(v * 0.145038).toFixed(1)} psi`,
      note: 'More boost is more power and more heat. The block has limits.',
      onInput: (v) => { tuning.boostTargetKpa = v; rebuild(); },
    }));
  }

  rows.push(sliderRow({
    label: 'Clutch engagement speed',
    value: tuning.clutchEngageSpeed,
    min: TUNING_LIMITS.clutchEngageSpeed.min,
    max: TUNING_LIMITS.clutchEngageSpeed.max,
    step: 0.1,
    fmt: (v) => v.toFixed(1),
    note: 'How sharply the pedal bites. Sharper hooks harder and shocks the driveline.',
    onInput: (v) => { tuning.clutchEngageSpeed = v; rebuild(); },
  }));

  const mapSelect = el('select', { class: 'input' },
    ...TUNING_LIMITS.throttleMap.map((m) => el('option', { value: m, selected: m === tuning.throttleMap },
      m.charAt(0).toUpperCase() + m.slice(1))));
  mapSelect.addEventListener('change', () => { tuning.throttleMap = mapSelect.value; rebuild(); });

  const saveBtn = el('button', { class: 'btn primary' }, 'Save tune');
  guardButton(saveBtn, async () => {
    const clean = sanitizeTuning(pc.carId, tuning);
    const res = await api.saveTuning(pc.id, clean);
    // The server sanitises again and returns what it actually stored.
    tuning = res.tuning || clean;
    toastSuccess('Tune saved.');
    ctx.onSaved?.(tuning);
  }, 'Saving…');

  const resetBtn = el('button', { class: 'btn ghost' }, 'Reset to stock');
  resetBtn.addEventListener('click', () => {
    tuning = defaultTuning(pc.carId);
    renderTuning(container, { ...ctx, playerCar: { ...pc, tuning } });
  });

  container.appendChild(el('div', { class: 'tune-layout' },
    el('div', { class: 'tune-controls' },
      el('h2', {}, 'Tuning'),
      ...rows,
      el('label', { class: 'field' }, el('span', {}, 'Throttle map'), mapSelect),
      el('div', { class: 'tune-actions' }, saveBtn, resetBtn)),
    el('div', { class: 'tune-visual' },
      el('h3', {}, 'Gearing'),
      speedChart,
      readout)));

  rebuild();
}

function sliderRow({ label, value, min, max, step, fmt, note, onInput }) {
  const out = el('b', { class: 'slider-value' }, fmt(value));
  const input = el('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => {
      const v = parseFloat(e.target.value);
      out.textContent = fmt(v);
      onInput(v);
    },
  });
  return el('div', { class: 'tune-row' },
    el('div', { class: 'tune-row-head' }, el('span', {}, label), out),
    input,
    note ? el('p', { class: 'field-note' }, note) : null);
}

/** Speed-in-gear chart: where each gear runs out and how big the rpm drops are. */
function drawGearChart(canvas, spec) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, rect.width * dpr);
  canvas.height = 260 * dpr;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const s = H / 260;

  const radius = spec.tires.radius;
  const ratios = spec.gearbox.ratios;
  const fd = spec.gearbox.finalDrive;
  const redline = spec.engine.redlineRpm;

  const speedAt = (gear, rpm) =>
    ((rpm * Math.PI / 30) / (ratios[gear] * fd)) * radius * MPS_TO_MPH;

  const maxSpeed = speedAt(ratios.length - 1, redline) * 1.05;
  const padL = 40 * s, padB = 28 * s, padT = 16 * s, padR = 12 * s;
  const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(16,18,22,0.6)';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(141,148,158,0.16)';
  ctx.font = `500 ${9 * s}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.fillStyle = '#8d949e';
  ctx.textAlign = 'right';
  for (let r = 0; r <= redline; r += 2000) {
    const y = y1 - (r / redline) * (y1 - y0);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.fillText(String(r / 1000) + 'k', x0 - 6 * s, y + 3 * s);
  }
  ctx.textAlign = 'center';
  for (let mph = 0; mph <= maxSpeed; mph += 40) {
    const x = x0 + (mph / maxSpeed) * (x1 - x0);
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    ctx.fillText(String(mph), x, y1 + 14 * s);
  }

  const colors = ['#ffb000', '#43cfd6', '#2fd35f', '#e5342a', '#a58cff', '#ff7a1a', '#7fd1ff'];
  ratios.forEach((ratio, i) => {
    const vMax = speedAt(i, redline);
    ctx.strokeStyle = colors[i % colors.length];
    ctx.lineWidth = 2.2 * s;
    ctx.beginPath();
    ctx.moveTo(x0, y1);
    ctx.lineTo(x0 + (vMax / maxSpeed) * (x1 - x0), y0);
    ctx.stroke();
    ctx.fillStyle = colors[i % colors.length];
    ctx.font = `600 ${10 * s}px "Barlow Condensed", system-ui, sans-serif`;
    ctx.fillText(String(i + 1), x0 + (vMax / maxSpeed) * (x1 - x0) - 6 * s, y0 + 12 * s);
  });

  ctx.fillStyle = '#8d949e';
  ctx.font = `500 ${9 * s}px "Barlow Condensed", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('MPH', (x0 + x1) / 2, H - 4 * s);
}

function renderReadout(node, spec, tuning) {
  node.replaceChildren();
  const ratios = spec.gearbox.ratios;
  const fd = spec.gearbox.finalDrive;
  const radius = spec.tires.radius;
  const shiftRpm = Math.min(tuning.shiftRpm, spec.engine.redlineRpm);

  const rows = ratios.map((r, i) => {
    const vShift = ((shiftRpm * Math.PI / 30) / (r * fd)) * radius * MPS_TO_MPH;
    const nextRpm = i < ratios.length - 1
      ? shiftRpm * (ratios[i + 1] / r)
      : null;
    return el('div', { class: 'ts-row' },
      el('span', {}, `${i + 1} → ${i + 2 <= ratios.length ? i + 2 : '—'}`),
      el('b', {}, nextRpm
        ? `${Math.round(vShift)} mph · drops to ${Math.round(nextRpm)} rpm`
        : `${Math.round(vShift)} mph`));
  });

  const topSpeed = ((spec.engine.redlineRpm * Math.PI / 30) / (ratios[ratios.length - 1] * fd)) * radius * MPS_TO_MPH;

  node.appendChild(el('div', {},
    ...rows,
    el('div', { class: 'ts-row total' },
      el('span', {}, 'Theoretical top speed'),
      el('b', {}, `${Math.round(topSpeed)} mph`))));
}
