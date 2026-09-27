// js/game/hud.js
// The heads-up display, drawn on its own canvas above the track.
//
// Every number on screen is read straight from Vehicle.telemetry(). There are
// no display-only values anywhere in this file.

import { clamp, lerp, fmtTime, M_TO_FT } from '../sim/util.js';

const C = {
  panel: 'rgba(20,23,28,0.82)',
  panelEdge: 'rgba(120,132,148,0.22)',
  text: '#e8eaed',
  dim: '#8d949e',
  amber: '#ffb000',
  green: '#2fd35f',
  red: '#e5342a',
  blue: '#5aa7e8',
  cyan: '#43cfd6',
};

const HEAD = '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

export class HUD {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.showTelemetry = opts.telemetry ?? false;
    this.units = opts.units || 'imperial';
    this.needleRpm = 0;
    this.flash = 0;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.round(rect.width * dpr));
    const h = Math.max(200, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.w = this.canvas.width;
    this.h = this.canvas.height;
    this.s = this.h / 720;     // scale factor
  }

  /**
   * @param {object} st {
   *   telemetry, spec, race, mode, dt, elapsed, distanceFt, opponentTelemetry,
   *   paused, countdownMessage
   * }
   */
  draw(st) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const t = st.telemetry;
    if (!t) return;
    const s = this.s;
    const dt = st.dt || 0.016;

    // Needle lag makes the tacho feel mechanical instead of digital.
    const k = clamp(dt * 16, 0, 1);
    this.needleRpm += (t.engine.rpm - this.needleRpm) * k;
    this.flash = Math.max(0, this.flash - dt * 3);

    this.drawTacho(ctx, st, s);
    this.drawPedals(ctx, st, s);
    this.drawTiming(ctx, st, s);
    this.drawConditions(ctx, st, s);
    if (st.spec.engine.aspiration !== 'na') this.drawBoost(ctx, st, s);
    this.drawWarnings(ctx, st, s);
    if (this.showTelemetry) this.drawTelemetry(ctx, st, s);
    this.drawBanner(ctx, st, s);
  }

  /* ------------------------------------------------------------- tachometer */

  drawTacho(ctx, st, s) {
    const t = st.telemetry;
    const spec = st.spec;
    const R = 132 * s;
    const cx = R + 46 * s;
    const cy = this.h - R - 34 * s;
    const start = Math.PI * 0.78;
    const sweep = Math.PI * 1.44;

    const maxRpm = Math.ceil((spec.engine.floatRpm || spec.engine.redlineRpm * 1.1) / 1000) * 1000;
    const a = (rpm) => start + (clamp(rpm, 0, maxRpm) / maxRpm) * sweep;

    ctx.save();

    // dial face
    const face = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R);
    face.addColorStop(0, 'rgba(34,39,47,0.95)');
    face.addColorStop(1, 'rgba(14,16,20,0.95)');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = face;
    ctx.fill();
    ctx.strokeStyle = C.panelEdge;
    ctx.lineWidth = 2 * s;
    ctx.stroke();

    // redline band
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.90, a(spec.engine.redlineRpm), a(maxRpm));
    ctx.strokeStyle = 'rgba(229,52,42,0.75)';
    ctx.lineWidth = 9 * s;
    ctx.stroke();
    // over-rev danger band
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.90, a(spec.engine.maxSafeRpm), a(maxRpm));
    ctx.strokeStyle = 'rgba(229,52,42,0.95)';
    ctx.lineWidth = 9 * s;
    ctx.stroke();
    // shift-point marker
    const shiftRpm = spec.tuning?.shiftRpm;
    if (shiftRpm) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.90, a(shiftRpm) - 0.012, a(shiftRpm) + 0.012);
      ctx.strokeStyle = C.green;
      ctx.lineWidth = 11 * s;
      ctx.stroke();
    }

    // ticks
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 0; r <= maxRpm; r += 500) {
      const major = r % 1000 === 0;
      const ang = a(r);
      const r1 = R * (major ? 0.74 : 0.80);
      const r2 = R * 0.86;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      ctx.strokeStyle = r >= spec.engine.redlineRpm ? 'rgba(229,52,42,0.9)' : 'rgba(210,216,224,0.6)';
      ctx.lineWidth = (major ? 2.6 : 1.4) * s;
      ctx.stroke();
      if (major) {
        ctx.fillStyle = r >= spec.engine.redlineRpm ? '#f08a84' : C.dim;
        ctx.font = `600 ${15 * s}px ${HEAD}`;
        ctx.fillText(String(r / 1000), cx + Math.cos(ang) * R * 0.62, cy + Math.sin(ang) * R * 0.62);
      }
    }

    // needle
    const ang = a(this.needleRpm);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(-R * 0.13, -2.6 * s);
    ctx.lineTo(R * 0.86, -1.1 * s);
    ctx.lineTo(R * 0.86, 1.1 * s);
    ctx.lineTo(-R * 0.13, 2.6 * s);
    ctx.closePath();
    ctx.fillStyle = t.engine.limiter && (Math.floor(st.elapsed * 20) % 2) ? '#fff' : C.red;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = '#2a3038';
    ctx.fill();
    ctx.strokeStyle = C.panelEdge;
    ctx.stroke();

    // gear
    const gear = t.gearbox.gear;
    const gearTxt = gear === 0 ? 'N' : gear < 0 ? 'R' : String(gear);
    ctx.font = `700 ${62 * s}px ${HEAD}`;
    ctx.fillStyle = t.gearbox.inShift ? C.amber : C.text;
    ctx.fillText(gearTxt, cx, cy + R * 0.40);
    ctx.font = `600 ${12 * s}px ${HEAD}`;
    ctx.fillStyle = C.dim;
    ctx.fillText('GEAR', cx, cy + R * 0.63);

    // digital rpm
    ctx.font = `500 ${17 * s}px ${MONO}`;
    ctx.fillStyle = t.engine.rpm > spec.engine.maxSafeRpm ? C.red : C.dim;
    ctx.fillText(`${Math.round(t.engine.rpm)} RPM`, cx, cy - R * 0.44);

    // speed, to the right of the dial
    const sx = cx + R + 22 * s;
    const sy = cy + R * 0.12;
    const imperial = this.units !== 'metric';
    ctx.textAlign = 'left';
    ctx.font = `700 ${72 * s}px ${HEAD}`;
    ctx.fillStyle = C.text;
    ctx.fillText(String(Math.round(imperial ? t.speedMph : t.speedKmh)), sx, sy);
    ctx.font = `600 ${16 * s}px ${HEAD}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(imperial ? 'MPH' : 'KM/H', sx + 2 * s, sy + 26 * s);

    // shift light bar across the top of the dial
    const rev = clamp((t.engine.rpm - spec.engine.redlineRpm * 0.72)
      / (spec.engine.redlineRpm * 0.28), 0, 1);
    const bw = R * 1.5, bh = 9 * s;
    const bx = cx - bw / 2, by = cy - R - 20 * s;
    for (let i = 0; i < 12; i++) {
      const on = rev > i / 12;
      const col = i < 7 ? C.green : i < 10 ? C.amber : C.red;
      ctx.fillStyle = on ? col : 'rgba(255,255,255,0.07)';
      ctx.fillRect(bx + i * (bw / 12) + 1.5 * s, by, bw / 12 - 3 * s, bh);
    }
    ctx.restore();
  }

  /* ----------------------------------------------------------------- pedals */

  drawPedals(ctx, st, s) {
    const t = st.telemetry;
    const w = 15 * s, h = 96 * s, gap = 9 * s;
    const x0 = this.w - (w * 3 + gap * 2) - 30 * s;
    const y0 = this.h - h - 34 * s;
    const items = [
      { v: t.engine.throttle, c: C.green, l: 'T' },
      { v: st.inputs?.brake ?? 0, c: C.red, l: 'B' },
      { v: t.clutch.engagement != null ? 1 - t.clutch.engagement : 0, c: C.blue, l: 'C' },
    ];
    ctx.save();
    ctx.textAlign = 'center';
    items.forEach((it, i) => {
      const x = x0 + i * (w + gap);
      ctx.fillStyle = 'rgba(20,23,28,0.75)';
      ctx.fillRect(x, y0, w, h);
      ctx.strokeStyle = C.panelEdge;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y0 + 0.5, w - 1, h - 1);
      const fh = clamp(it.v, 0, 1) * (h - 4 * s);
      ctx.fillStyle = it.c;
      ctx.fillRect(x + 2 * s, y0 + h - 2 * s - fh, w - 4 * s, fh);
      ctx.fillStyle = C.dim;
      ctx.font = `600 ${11 * s}px ${MONO}`;
      ctx.fillText(it.l, x + w / 2, y0 + h + 14 * s);
    });
    ctx.restore();
  }

  /* ----------------------------------------------------------------- timing */

  drawTiming(ctx, st, s) {
    const race = st.race;
    const t = st.telemetry;
    const w = 214 * s, h = 96 * s;
    const x = this.w / 2 - w / 2, y = 18 * s;
    panel(ctx, x, y, w, h, s);

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const et = race?.player?.launchTime != null
      ? (race.player.finished ? race.player.et : race.time - race.player.launchTime)
      : 0;
    const distFt = Math.max(0, t.distanceFt ?? t.position * M_TO_FT);
    const total = st.distanceFt || 1320;

    ctx.font = `500 ${11 * s}px ${HEAD}`;
    ctx.fillStyle = C.dim;
    ctx.fillText('ELAPSED', x + 14 * s, y + 22 * s);
    ctx.fillText('DISTANCE', x + 118 * s, y + 22 * s);

    ctx.font = `600 ${30 * s}px ${MONO}`;
    ctx.fillStyle = C.text;
    ctx.fillText(fmtTime(et, 3), x + 14 * s, y + 50 * s);
    ctx.font = `600 ${22 * s}px ${MONO}`;
    ctx.fillText(`${Math.round(distFt)}`, x + 118 * s, y + 48 * s);
    ctx.font = `500 ${11 * s}px ${HEAD}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(`/ ${total} FT`, x + 118 * s, y + 62 * s);

    // progress
    const pw = w - 28 * s;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + 14 * s, y + h - 20 * s, pw, 5 * s);
    ctx.fillStyle = C.cyan;
    ctx.fillRect(x + 14 * s, y + h - 20 * s, pw * clamp(distFt / total, 0, 1), 5 * s);

    // reaction time once we have it
    if (race?.player?.reaction != null) {
      ctx.font = `500 ${11 * s}px ${HEAD}`;
      ctx.fillStyle = race.player.foul ? C.red : C.dim;
      ctx.textAlign = 'right';
      ctx.fillText(`RT ${race.player.reaction >= 0 ? '' : '-'}${fmtTime(Math.abs(race.player.reaction), 3)}`,
        x + w - 14 * s, y + 22 * s);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------- conditions */

  drawConditions(ctx, st, s) {
    const t = st.telemetry;
    const w = 190 * s, rowH = 17 * s;
    const rows = [
      { l: 'ENGINE', v: t.engine.coolantC, max: st.spec.engine.thermalLimitC, unit: '°C', warn: 0.92 },
      { l: 'CLUTCH', v: t.clutch.tempC, max: 400, unit: '°C', warn: 0.6 },
      { l: 'TIRE', v: (t.tiresRear.tempC + t.tiresFront.tempC) / 2, max: 160, unit: '°C', warn: 0.85, band: true },
    ];
    const h = rows.length * rowH + 26 * s;
    const x = this.w - w - 22 * s, y = 18 * s;
    panel(ctx, x, y, w, h, s);
    ctx.save();
    ctx.font = `500 ${10 * s}px ${HEAD}`;
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'left';
    ctx.fillText('TEMPERATURES', x + 12 * s, y + 16 * s);

    rows.forEach((r, i) => {
      const ry = y + 26 * s + i * rowH;
      const frac = clamp(r.v / r.max, 0, 1);
      ctx.font = `500 ${10 * s}px ${HEAD}`;
      ctx.fillStyle = C.dim;
      ctx.fillText(r.l, x + 12 * s, ry + 9 * s);
      const bx = x + 62 * s, bw = 82 * s;
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(bx, ry + 2 * s, bw, 8 * s);
      // Tires have a *window*: cold is bad and hot is bad.
      let col = C.green;
      if (r.band) {
        col = frac < 0.35 ? C.blue : frac > r.warn ? C.red : C.green;
      } else {
        col = frac > r.warn ? C.red : frac > r.warn * 0.8 ? C.amber : C.green;
      }
      ctx.fillStyle = col;
      ctx.fillRect(bx, ry + 2 * s, bw * frac, 8 * s);
      ctx.font = `500 ${10 * s}px ${MONO}`;
      ctx.fillStyle = C.text;
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(r.v)}${r.unit}`, x + w - 12 * s, ry + 10 * s);
      ctx.textAlign = 'left';
    });
    ctx.restore();
  }

  drawBoost(ctx, st, s) {
    const t = st.telemetry;
    const R = 40 * s;
    const cx = this.w - 60 * s, cy = this.h - 190 * s;
    const maxPsi = Math.max(10, (st.spec.engine.turbo?.targetBoostKpa
      || st.spec.engine.supercharger?.maxBoostKpa || 100) * 0.145038 * 1.35);
    const start = Math.PI * 0.75, sweep = Math.PI * 1.5;
    const psi = t.engine.boostPsi;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(18,21,26,0.85)';
    ctx.fill();
    ctx.strokeStyle = C.panelEdge;
    ctx.lineWidth = 1.5 * s;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.78, start, start + sweep);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 6 * s;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.78, start, start + sweep * clamp(psi / maxPsi, 0, 1));
    ctx.strokeStyle = psi / maxPsi > 0.92 ? C.red : C.cyan;
    ctx.lineWidth = 6 * s;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = `600 ${20 * s}px ${MONO}`;
    ctx.fillStyle = C.text;
    ctx.fillText(psi.toFixed(1), cx, cy + 4 * s);
    ctx.font = `500 ${9 * s}px ${HEAD}`;
    ctx.fillStyle = C.dim;
    ctx.fillText('PSI BOOST', cx, cy + 18 * s);
    if (st.spec.engine.aspiration === 'turbo') {
      ctx.fillText(`SPOOL ${Math.round((t.engine.spool || 0) * 100)}%`, cx, cy + 30 * s);
    }
    ctx.restore();
  }

  /* --------------------------------------------------------------- warnings */

  drawWarnings(ctx, st, s) {
    const list = st.telemetry.warnings || [];
    if (!list.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `700 ${18 * s}px ${HEAD}`;
    const blink = Math.floor(st.elapsed * 6) % 2 === 0;
    list.slice(0, 4).forEach((wmsg, i) => {
      const y = this.h * 0.30 + i * 26 * s;
      const critical = /FAILED|FAILURE|DAMAGE|OVER-REV|OVERHEAT/.test(wmsg);
      if (critical && !blink) return;
      const tw = ctx.measureText(wmsg).width + 26 * s;
      ctx.fillStyle = critical ? 'rgba(122,20,16,0.85)' : 'rgba(80,58,10,0.8)';
      ctx.fillRect(this.w / 2 - tw / 2, y - 16 * s, tw, 24 * s);
      ctx.strokeStyle = critical ? C.red : C.amber;
      ctx.lineWidth = 1.5 * s;
      ctx.strokeRect(this.w / 2 - tw / 2, y - 16 * s, tw, 24 * s);
      ctx.fillStyle = critical ? '#ffd9d6' : '#ffe6b0';
      ctx.fillText(wmsg, this.w / 2, y);
    });
    ctx.restore();
  }

  /* -------------------------------------------------------- advanced panel */

  drawTelemetry(ctx, st, s) {
    const t = st.telemetry;
    const w = 236 * s;
    const rows = [
      ['ENGINE RPM', Math.round(t.engine.rpm)],
      ['WHEEL RPM', Math.round(t.wheelRpm)],
      ['THROTTLE', `${Math.round(t.engine.throttle * 100)}%`],
      ['CLUTCH', `${Math.round((1 - t.clutch.engagement) * 100)}%`],
      ['BRAKE', `${Math.round((st.inputs?.brake ?? 0) * 100)}%`],
      ['BOOST', `${t.engine.boostPsi.toFixed(1)} psi`],
      ['ENG TORQUE', `${Math.round(t.engine.torque)} Nm`],
      ['WHEEL TORQUE', `${Math.round(t.wheelTorque)} Nm`],
      ['GEAR RATIO', t.gearbox.gearRatio.toFixed(2)],
      ['FINAL DRIVE', t.gearbox.finalDrive.toFixed(2)],
      ['CLUTCH SLIP', `${Math.round(t.clutch.slipRpm)} rpm`],
      ['WHEEL SLIP', `${(t.slip * 100).toFixed(1)}%`],
      ['TIRE TEMP R', `${Math.round(t.tiresRear.tempC)} °C`],
      ['TIRE GRIP', `${Math.round(t.tiresRear.gripFraction * 100)}%`],
      ['TIRE HEALTH', `${Math.round(t.tiresRear.health)}%`],
      ['ENGINE TEMP', `${Math.round(t.engine.coolantC)} °C`],
      ['OIL TEMP', `${Math.round(t.engine.oilC)} °C`],
      ['CLUTCH TEMP', `${Math.round(t.clutch.tempC)} °C`],
      ['CLUTCH CAP', `${Math.round(t.clutch.capacityNm)} Nm`],
      ['ENG HEALTH', `${t.engine.health.toFixed(1)}%`],
      ['TRANS HEALTH', `${t.gearbox.health.toFixed(1)}%`],
      ['ACCEL', `${t.accelG.toFixed(2)} g`],
      ['DOWN FORCE F/R', `${Math.round(t.loadF)}/${Math.round(t.loadR)} N`],
    ];
    const rowH = 13.4 * s;
    const h = rows.length * rowH + 24 * s;
    const x = 22 * s, y = 18 * s;
    panel(ctx, x, y, w, h, s);
    ctx.save();
    ctx.font = `500 ${10 * s}px ${HEAD}`;
    ctx.fillStyle = C.dim;
    ctx.fillText('TELEMETRY', x + 12 * s, y + 15 * s);
    ctx.font = `400 ${10 * s}px ${MONO}`;
    rows.forEach((r, i) => {
      const ry = y + 26 * s + i * rowH + 8 * s;
      ctx.fillStyle = C.dim;
      ctx.textAlign = 'left';
      ctx.fillText(r[0], x + 12 * s, ry);
      ctx.fillStyle = C.text;
      ctx.textAlign = 'right';
      ctx.fillText(String(r[1]), x + w - 12 * s, ry);
    });
    ctx.restore();
  }

  /* ----------------------------------------------------------------- banner */

  drawBanner(ctx, st, s) {
    const msg = st.countdownMessage || st.race?.message;
    if (!msg) return;
    if (st.race && st.race.state === 'running' && !st.race.player.foul) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `700 ${34 * s}px ${HEAD}`;
    const y = this.h * 0.19;
    const tw = ctx.measureText(msg).width + 46 * s;
    ctx.fillStyle = 'rgba(12,14,18,0.78)';
    ctx.fillRect(this.w / 2 - tw / 2, y - 30 * s, tw, 44 * s);
    ctx.strokeStyle = C.panelEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(this.w / 2 - tw / 2, y - 30 * s, tw, 44 * s);
    ctx.fillStyle = /WIN/.test(msg) ? C.green : /RED|LOSS|FOUL/.test(msg) ? C.red : C.text;
    ctx.fillText(msg, this.w / 2, y);
    ctx.restore();
  }
}

function panel(ctx, x, y, w, h, s) {
  ctx.save();
  ctx.fillStyle = C.panel;
  ctx.strokeStyle = C.panelEdge;
  ctx.lineWidth = 1;
  const r = 4 * s;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
