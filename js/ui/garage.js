// js/ui/garage.js
// The garage page: your workshop, the dealership, the dyno, the tuning bench,
// the upgrade shop and the leaderboards.

import { requireAuth } from '../net/auth.js';
import * as api from '../net/api.js';
import { getCar, CAR_LIST, CLASS_NAMES, CLASS_ORDER } from '../data/cars.js';
import { buildVehicleSpec, specSummary, defaultTuning } from '../sim/build.js';
import { drawCarInBox } from '../game/carart.js';
import { renderUpgradeShop } from './upgrades.js';
import { renderTuning } from './tuning.js';
import { drawDyno, dynoSummary } from './dyno.js';
import { renderLeaderboards } from './leaderboard.js';
import { getSettings, setSetting, DRIVING_MODES, DIFFICULTY, resetSettings } from './settings.js';
import { ACTIONS, keyLabel, loadBindings, saveBindings, defaultBindings } from '../game/input.js';
import {
  el, $, $$, clear, toast, toastError, toastSuccess, showLoading, hideLoading,
  renderHeader, updateMoneyChip, fmtMoney, guardButton, modal, confirmDialog,
  healthClass, etText, mphText, relativeTime,
} from './common.js';
import { pageUrl, CONFIG } from '../config.js';
import { clamp } from '../sim/util.js';

const view = {
  profile: null,
  garage: [],
  selected: null,
  tab: 'garage',
};

/* ------------------------------------------------------------------- boot */

async function boot() {
  const session = await requireAuth();
  if (!session) return;
  showLoading('Loading garage…');
  try {
    const [profile, garage] = await Promise.all([api.getProfile(), api.getGarage()]);
    view.profile = profile;
    view.garage = garage;
    if (profile?.banned) {
      hideLoading();
      document.body.innerHTML = '<div class="fatal"><h1>Account suspended</h1><p>Contact an administrator.</p></div>';
      return;
    }
    const last = localStorage.getItem('staged.lastCar');
    view.selected = garage.find((g) => g.id === last) || garage[0] || null;
  } catch (err) {
    hideLoading();
    toastError(err.message);
    return;
  }
  hideLoading();
  renderHeader({ active: 'garage', profile: view.profile });
  routeFromHash();
  window.addEventListener('hashchange', routeFromHash);
}

function routeFromHash() {
  const h = (location.hash || '').replace('#', '');
  view.tab = ['garage', 'dealership', 'leaderboard', 'settings'].includes(h) ? h : 'garage';
  render();
}

async function refresh(keepTab = true) {
  const [profile, garage] = await Promise.all([api.getProfile(), api.getGarage()]);
  view.profile = profile;
  view.garage = garage;
  view.selected = garage.find((g) => g.id === view.selected?.id) || garage[0] || null;
  updateMoneyChip(profile.money_cents);
  render();
}

/* ----------------------------------------------------------------- render */

function render() {
  const root = $('#app');
  clear(root);

  const tabs = el('div', { class: 'tabbar' },
    ...[
      ['garage', 'Garage'],
      ['dealership', 'Dealership'],
      ['leaderboard', 'Leaderboards'],
      ['settings', 'Settings'],
    ].map(([id, label]) => el('a', {
      class: `tab${view.tab === id ? ' active' : ''}`,
      href: `#${id}`,
    }, el('span', { class: 'tab-pip' }), label)));

  root.appendChild(tabs);
  const body = el('div', { class: 'tab-body' });
  root.appendChild(body);

  if (view.tab === 'garage') renderGarage(body);
  else if (view.tab === 'dealership') renderDealership(body);
  else if (view.tab === 'leaderboard') renderLeaderboards(body, { playerId: view.profile.id });
  else renderSettings(body);
}

/* ----------------------------------------------------------------- garage */

function renderGarage(host) {
  if (!view.garage.length) {
    host.appendChild(el('div', { class: 'empty big' },
      el('h2', {}, 'Your garage is empty'),
      el('p', {}, 'Head to the dealership and pick something out.'),
      el('a', { class: 'btn primary', href: '#dealership' }, 'Open dealership')));
    return;
  }

  const list = el('div', { class: 'garage-list' },
    ...view.garage.map((g) => carTile(g)));

  const detail = el('div', { class: 'garage-detail', id: 'garage-detail' });
  host.appendChild(el('div', { class: 'garage-layout' }, list, detail));
  renderDetail(detail);
}

function carTile(g) {
  const base = getCar(g.carId);
  const spec = buildVehicleSpec(g.carId, { upgrades: g.upgrades, tuning: g.tuning, condition: g.condition });
  const sum = specSummary(spec);
  const canvas = el('canvas', { class: 'tile-art', width: 420, height: 130 });
  const worst = Math.min(g.condition.engineHealth, g.condition.transmissionHealth,
    g.condition.clutchHealth, g.condition.tireHealth);

  const tile = el('button', {
    class: `car-tile${view.selected?.id === g.id ? ' active' : ''}`,
    onclick: () => {
      view.selected = g;
      localStorage.setItem('staged.lastCar', g.id);
      $$('.car-tile').forEach((t) => t.classList.remove('active'));
      tile.classList.add('active');
      renderDetail($('#garage-detail'));
    },
  },
    canvas,
    el('div', { class: 'tile-info' },
      el('h3', {}, g.nickname || base.name),
      el('div', { class: 'tile-sub' }, `${CLASS_NAMES[base.class] || base.class} · ${base.drivetrain}`),
      el('div', { class: 'tile-stats' },
        el('span', {}, `${Math.round(sum.peakHp)} hp`),
        el('span', {}, `${Math.round(sum.massLb)} lb`),
        g.bestEtQuarter ? el('span', {}, `${etText(g.bestEtQuarter)} s`) : null)),
    worst < 70 ? el('span', { class: `tile-flag ${healthClass(worst)}` }, 'NEEDS WORK') : null);

  requestAnimationFrame(() => {
    const ctx = canvas.getContext('2d');
    drawCarInBox(ctx, base, 0, 0, canvas.width, canvas.height);
  });
  return tile;
}

function renderDetail(host) {
  clear(host);
  const g = view.selected;
  if (!g) return;
  const base = getCar(g.carId);
  const spec = buildVehicleSpec(g.carId, { upgrades: g.upgrades, tuning: g.tuning, condition: g.condition });
  const sum = specSummary(spec);

  const art = el('canvas', { class: 'detail-art', width: 900, height: 290 });
  requestAnimationFrame(() => {
    const ctx = art.getContext('2d');
    ctx.clearRect(0, 0, art.width, art.height);
    drawCarInBox(ctx, base, 0, 0, art.width, art.height);
  });

  const nickBtn = el('button', { class: 'link-btn', onclick: () => renameCar(g) }, 'rename');

  host.appendChild(el('div', { class: 'detail-head' },
    el('div', {},
      el('h1', {}, g.nickname || base.name),
      el('p', { class: 'muted' }, `${base.name} · ${base.year} · ${base.bodyStyle} · ${CLASS_NAMES[base.class]}`, ' ', nickBtn)),
    el('div', { class: 'detail-actions' },
      el('a', {
        class: 'btn primary large',
        href: pageUrl(`game.html?car=${g.id}`),
        onclick: () => localStorage.setItem('staged.lastCar', g.id),
      }, 'Drive'),
      el('button', { class: 'btn', onclick: () => openTune(g) }, 'Tune'),
      el('button', { class: 'btn', onclick: () => openUpgrades(g) }, 'Upgrade'),
      el('button', { class: 'btn', onclick: () => openRepair(g) }, 'Repair'),
      el('button', { class: 'btn ghost', onclick: () => openDetails(g, spec) }, 'Details'))));

  host.appendChild(art);

  host.appendChild(el('div', { class: 'detail-grid' },
    statBlock('Power', `${Math.round(sum.peakHp)}`, `hp @ ${sum.peakHpRpm} rpm`),
    statBlock('Torque', `${Math.round(sum.peakTorqueLbFt)}`, `lb-ft @ ${sum.peakTorqueRpm} rpm`),
    statBlock('Weight', `${Math.round(sum.massLb)}`, 'lb'),
    statBlock('Power/weight', sum.powerToWeight.toFixed(0), 'hp per tonne'),
    statBlock('Drivetrain', sum.drivetrain, `${sum.gearCount}-speed`),
    statBlock('Induction', sum.aspiration === 'na' ? 'Naturally aspirated' : sum.aspiration,
      sum.boostPsi > 0.2 ? `${sum.boostPsi.toFixed(1)} psi` : ''),
    statBlock('Tires', sum.tireCompound.replace('_', ' '), sum.diffType.toUpperCase() + ' diff'),
    statBlock('Best 1/4', g.bestEtQuarter ? etText(g.bestEtQuarter) : '—',
      g.bestMphQuarter ? `${mphText(g.bestMphQuarter)} mph` : 'no pass yet'),
    statBlock('Best 1/8', g.bestEtEighth ? etText(g.bestEtEighth) : '—',
      g.bestMphEighth ? `${mphText(g.bestMphEighth)} mph` : 'no pass yet')));

  host.appendChild(el('div', { class: 'condition-panel' },
    el('h3', {}, 'Condition'),
    ...[
      ['Engine', g.condition.engineHealth, 'Power falls away and it starts to knock.'],
      ['Transmission', g.condition.transmissionHealth, 'Missed shifts become likely.'],
      ['Clutch', g.condition.clutchHealth, 'Torque capacity drops; it slips under load.'],
      ['Tires', g.condition.tireHealth, 'Less grip, especially off the line.'],
    ].map(([label, v, note]) => el('div', { class: 'cond-row' },
      el('span', { class: 'cond-l' }, label),
      el('div', { class: 'cond-bar' },
        el('div', { class: `cond-fill ${healthClass(v)}`, style: { width: `${clamp(v, 0, 100)}%` } })),
      el('span', { class: 'cond-v' }, `${v.toFixed(0)}%`),
      el('span', { class: 'cond-note muted' }, v < 92 ? note : 'Healthy')))));

  const dynoCanvas = el('canvas', { class: 'dyno-canvas', height: 340 });
  host.appendChild(el('div', { class: 'dyno-panel' },
    el('h3', {}, 'Dyno'),
    dynoCanvas,
    dynoSummary(spec)));
  requestAnimationFrame(() => drawDyno(dynoCanvas, spec));
}

function statBlock(label, value, sub) {
  return el('div', { class: 'stat-block' },
    el('span', { class: 'sb-label' }, label),
    el('b', { class: 'sb-value' }, value),
    sub ? el('span', { class: 'sb-sub' }, sub) : null);
}

/* ------------------------------------------------------------- car actions */

function renameCar(g) {
  const input = el('input', { class: 'input', maxlength: 28, value: g.nickname || '' });
  const m = modal({
    title: 'Rename vehicle',
    body: el('label', { class: 'field' }, el('span', {}, 'Nickname'), input),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save',
        kind: 'primary',
        busyLabel: 'Saving…',
        onClick: async () => {
          const res = await api.setNickname(g.id, input.value.trim());
          g.nickname = res.nickname ?? input.value.trim();
          toastSuccess('Renamed.');
          render();
          return false;
        },
      },
    ],
  });
  setTimeout(() => input.focus(), 50);
}

function openUpgrades(g) {
  const host = el('div');
  const m = modal({ title: g.nickname || getCar(g.carId).name, body: host, wide: true });
  renderUpgradeShop(host, {
    playerCar: g,
    money: view.profile.money_cents,
    onPurchased: async () => {
      await refresh();
      const fresh = view.garage.find((c) => c.id === g.id);
      renderUpgradeShop(host, {
        playerCar: fresh,
        money: view.profile.money_cents,
        onPurchased: () => { m.close(); refresh(); },
      });
    },
  });
}

function openTune(g) {
  const host = el('div');
  modal({ title: `Tuning — ${g.nickname || getCar(g.carId).name}`, body: host, wide: true });
  renderTuning(host, {
    playerCar: g,
    onSaved: (tuning) => { g.tuning = tuning; refresh(); },
  });
}

const REPAIR_PARTS = [
  { id: 'engine', label: 'Engine', key: 'engineHealth' },
  { id: 'transmission', label: 'Transmission', key: 'transmissionHealth' },
  { id: 'clutch', label: 'Clutch', key: 'clutchHealth' },
  { id: 'tires', label: 'Tires', key: 'tireHealth' },
];

function openRepair(g) {
  const chosen = new Set();
  const total = el('b', {}, fmtMoney(0));
  const rows = REPAIR_PARTS.map((p) => {
    const health = g.condition[p.key];
    const damage = 100 - health;
    const cost = estimateRepairCents(g, p.id, damage);
    const cb = el('input', {
      type: 'checkbox',
      disabled: damage < 0.5,
      onchange: (e) => {
        if (e.target.checked) chosen.add(p.id); else chosen.delete(p.id);
        total.textContent = fmtMoney(REPAIR_PARTS
          .filter((x) => chosen.has(x.id))
          .reduce((s, x) => s + estimateRepairCents(g, x.id, 100 - g.condition[x.key]), 0));
      },
    });
    return el('label', { class: `repair-row${damage < 0.5 ? ' disabled' : ''}` },
      cb,
      el('span', { class: 'rr-name' }, p.label),
      el('div', { class: 'cond-bar small' },
        el('div', { class: `cond-fill ${healthClass(health)}`, style: { width: `${health}%` } })),
      el('span', { class: 'rr-health' }, `${health.toFixed(0)}%`),
      el('span', { class: 'rr-cost' }, damage < 0.5 ? 'OK' : fmtMoney(cost)));
  });

  modal({
    title: 'Repair shop',
    body: el('div', {},
      el('p', { class: 'muted' }, 'Repair costs scale with how badly the part is damaged. The final price is calculated on the server.'),
      ...rows,
      el('div', { class: 'repair-total' }, el('span', {}, 'Estimated total'), total)),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Repair',
        kind: 'primary',
        busyLabel: 'Repairing…',
        onClick: async () => {
          if (!chosen.size) { toastError('Select at least one part.'); return true; }
          const res = await api.repairCar(g.id, Array.from(chosen));
          toastSuccess(`Repaired for ${fmtMoney(res.costCents)}.`);
          await refresh();
          return false;
        },
      },
    ],
  });
}

/** Client-side estimate only — the server recomputes the real number. */
function estimateRepairCents(g, part, damage) {
  const base = getCar(g.carId);
  const value = base.priceCents;
  const rate = { engine: 0.00042, transmission: 0.00030, clutch: 0.00022, tires: 0.00016 }[part] || 0.0002;
  return Math.round(value * rate * Math.max(0, damage) + 2000);
}

function openDetails(g, spec) {
  const upgradeRows = Object.entries(g.upgrades || {}).length
    ? Object.entries(g.upgrades).map(([slot, lvl]) => el('div', { class: 'ts-row' },
      el('span', {}, slot), el('b', {}, `Level ${lvl}`)))
    : [el('div', { class: 'muted' }, 'No upgrades fitted.')];

  modal({
    title: 'Vehicle details',
    wide: true,
    body: el('div', { class: 'details-grid' },
      el('div', {},
        el('h3', {}, 'Engine'),
        row('Type', spec.engine.name),
        row('Displacement', `${spec.engine.displacementL} L`),
        row('Cylinders', spec.engine.cylinders),
        row('Aspiration', spec.engine.aspiration),
        row('Idle', `${spec.engine.idleRpm} rpm`),
        row('Redline', `${spec.engine.redlineRpm} rpm`),
        row('Rev limiter', `${spec.engine.limiterRpm} rpm`),
        row('Max safe rpm', `${spec.engine.maxSafeRpm} rpm`),
        row('Valve float', `${spec.engine.floatRpm} rpm`)),
      el('div', {},
        el('h3', {}, 'Driveline'),
        row('Drivetrain', spec.drivetrain),
        row('Gears', spec.gearbox.ratios.map((r) => r.toFixed(2)).join(' / ')),
        row('Final drive', spec.gearbox.finalDrive.toFixed(2)),
        row('Shift time', `${spec.gearbox.shiftTime.toFixed(2)} s`),
        row('Clutch', `${spec.clutch.type} · ${Math.round(spec.clutch.capacityNm)} Nm`),
        row('Differential', spec.differential.type),
        row('Tires', `${spec.tires.compound} · ${spec.tires.widthMm} mm · ${spec.tires.pressurePsi} psi`)),
      el('div', {},
        el('h3', {}, 'Fitted upgrades'),
        ...upgradeRows,
        el('h3', {}, 'Odometer'),
        row('Distance covered', `${(g.odometerM / 1609.34).toFixed(1)} miles`),
        row('Acquired', relativeTime(g.acquiredAt)))),
  });
}

function row(l, v) {
  return el('div', { class: 'ts-row' }, el('span', {}, l), el('b', {}, String(v)));
}

/* ------------------------------------------------------------- dealership */

function renderDealership(host) {
  const owned = new Set(view.garage.map((g) => g.carId));
  const money = view.profile.money_cents;

  host.appendChild(el('div', { class: 'shop-head' },
    el('h2', {}, 'Dealership'),
    el('div', { class: 'muted' }, 'All vehicles are original designs. Prices are verified on the server at purchase time.')));

  for (const cls of CLASS_ORDER) {
    const cars = CAR_LIST.filter((c) => c.class === cls);
    if (!cars.length) continue;
    const grid = el('div', { class: 'dealer-grid' });
    for (const car of cars) grid.appendChild(dealerCard(car, owned, money));
    host.appendChild(el('section', { class: 'shop-section' },
      el('h3', { class: 'section-title' }, `Class ${cls} — ${CLASS_NAMES[cls]}`), grid));
  }
}

function dealerCard(car, owned, money) {
  const spec = buildVehicleSpec(car.id, {});
  const sum = specSummary(spec);
  const canvas = el('canvas', { class: 'dealer-art', width: 520, height: 170 });
  requestAnimationFrame(() => drawCarInBox(canvas.getContext('2d'), car, 0, 0, canvas.width, canvas.height));

  const isOwned = owned.has(car.id);
  const affordable = money >= car.priceCents;

  const btn = el('button', {
    class: `btn ${isOwned ? '' : affordable ? 'primary' : ''}`,
    disabled: isOwned || !affordable,
  }, isOwned ? 'Owned' : affordable ? `Buy — ${fmtMoney(car.priceCents)}` : fmtMoney(car.priceCents));

  if (!isOwned && affordable) {
    guardButton(btn, async () => {
      const ok = await confirmDialog({
        title: `Buy the ${car.name}?`,
        message: `${fmtMoney(car.priceCents)} will be deducted from your balance.`,
        confirmLabel: 'Buy vehicle',
      });
      if (!ok) return;
      const res = await api.buyCar(car.id);
      toastSuccess(`${car.name} added to your garage.`);
      await refresh();
    }, 'Processing purchase…');
  }

  // Estimated performance comes from the same spec the game will drive.
  const estQuarter = 5.9 * Math.pow(sum.massKg / Math.max(sum.peakHp, 1), 0.38) + 2.6;

  return el('div', { class: `dealer-card${isOwned ? ' owned' : ''}` },
    canvas,
    el('div', { class: 'dc-body' },
      el('h3', {}, car.name),
      el('p', { class: 'muted' }, car.description),
      el('div', { class: 'dc-stats' },
        el('div', {}, el('b', {}, Math.round(sum.peakHp)), el('span', {}, 'HP')),
        el('div', {}, el('b', {}, Math.round(sum.peakTorqueLbFt)), el('span', {}, 'LB-FT')),
        el('div', {}, el('b', {}, Math.round(sum.massLb)), el('span', {}, 'LB')),
        el('div', {}, el('b', {}, sum.drivetrain), el('span', {}, 'LAYOUT')),
        el('div', {}, el('b', {}, spec.gearbox.ratios.length), el('span', {}, 'GEARS')),
        el('div', {}, el('b', {}, sum.tireCompound.replace('_', ' ')), el('span', {}, 'TIRES'))),
      el('div', { class: 'dc-engine muted' }, `${spec.engine.name} · ${sum.aspiration === 'na' ? 'naturally aspirated' : sum.aspiration}`),
      el('div', { class: 'dc-est muted' }, `Estimated 1/4 mile ≈ ${estQuarter.toFixed(1)} s (stock, good air, clean launch)`),
      el('div', { class: 'dc-foot' }, btn)));
}

/* -------------------------------------------------------------- settings */

function renderSettings(host) {
  const s = getSettings();
  const bindings = loadBindings();

  const section = (title, ...children) =>
    el('section', { class: 'settings-section' }, el('h3', {}, title), ...children);

  const select = (label, value, options, onChange) =>
    el('label', { class: 'field' }, el('span', {}, label),
      el('select', { class: 'input', onchange: (e) => onChange(e.target.value) },
        ...options.map(([v, l]) => el('option', { value: v, selected: v === value }, l))));

  const slider = (label, value, onChange) =>
    el('label', { class: 'slider-row' }, el('span', {}, label),
      el('input', {
        type: 'range', min: 0, max: 1, step: 0.01, value,
        oninput: (e) => onChange(parseFloat(e.target.value)),
      }));

  const toggle = (label, value, onChange) =>
    el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: value, onchange: (e) => onChange(e.target.checked) }),
      el('span', {}, label));

  const bindRows = ACTIONS.map((a) => {
    const slots = [0, 1].map((i) => {
      const b = el('button', { class: 'key-btn' }, keyLabel(bindings[a.id]?.[i]));
      b.addEventListener('click', () => {
        b.textContent = 'Press a key…';
        b.classList.add('capturing');
        const handler = (e) => {
          e.preventDefault();
          window.removeEventListener('keydown', handler, true);
          const code = e.code;
          for (const key of Object.keys(bindings)) {
            if (key !== a.id) bindings[key] = bindings[key].filter((k) => k !== code);
          }
          const arr = (bindings[a.id] || []).slice();
          arr[i] = code;
          bindings[a.id] = arr.filter(Boolean);
          saveBindings(bindings);
          b.classList.remove('capturing');
          b.textContent = keyLabel(code);
          toast(`${a.label} bound to ${keyLabel(code)}`);
        };
        window.addEventListener('keydown', handler, true);
      });
      return b;
    });
    return el('div', { class: 'bind-row' }, el('span', {}, a.label), ...slots);
  });

  host.appendChild(el('div', { class: 'settings-grid' },
    section('Graphics',
      select('Quality', s.graphicsQuality, [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']],
        (v) => setSetting('graphicsQuality', v)),
      select('Particles', s.particles, [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']],
        (v) => setSetting('particles', v)),
      select('Default venue', s.environment,
        [['industrial', 'Ironside Raceway'], ['rural', 'Cedar Flats Dragway'],
          ['night', 'Midnight Industrial'], ['desert', 'Dry Lake Proving Ground']],
        (v) => setSetting('environment', v))),

    section('Effects',
      toggle('Screen shake', s.screenShake, (v) => setSetting('screenShake', v)),
      toggle('Tire smoke', s.smoke, (v) => setSetting('smoke', v)),
      toggle('Motion effects', s.motionEffects, (v) => setSetting('motionEffects', v)),
      toggle('Reduced effects (keeps the track readable)', s.reducedEffects,
        (v) => setSetting('reducedEffects', v))),

    section('Audio',
      slider('Master', s.volumeMaster, (v) => setSetting('volumeMaster', v)),
      slider('Engine', s.volumeEngine, (v) => setSetting('volumeEngine', v)),
      slider('Effects', s.volumeEffects, (v) => setSetting('volumeEffects', v)),
      slider('Menu ambience', s.volumeMusic, (v) => setSetting('volumeMusic', v))),

    section('Gameplay',
      select('Driving mode', s.drivingMode,
        Object.values(DRIVING_MODES).map((m) => [m.id, m.name]),
        (v) => { setSetting('drivingMode', v); render(); }),
      el('p', { class: 'field-note' }, DRIVING_MODES[s.drivingMode].blurb),
      select('AI difficulty', s.difficulty,
        Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]),
        (v) => setSetting('difficulty', v)),
      select('Tree', s.tree, [['pro', 'Pro Tree'], ['sportsman', 'Sportsman Tree']],
        (v) => setSetting('tree', v)),
      select('Units', s.units, [['imperial', 'Imperial (mph, ft)'], ['metric', 'Metric (km/h, m)']],
        (v) => setSetting('units', v)),
      toggle('Show advanced telemetry', s.showTelemetry, (v) => setSetting('showTelemetry', v))),

    section('Controls',
      el('p', { class: 'field-note' }, 'Click a key to rebind it. Each key can only drive one action.'),
      ...bindRows,
      el('button', {
        class: 'btn ghost small',
        onclick: () => { saveBindings(defaultBindings()); render(); toast('Controls reset.'); },
      }, 'Reset controls')),

    section('Reset',
      el('button', {
        class: 'btn ghost small',
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Reset settings?',
            message: 'Graphics, audio and gameplay preferences return to defaults. Your cars, money and progress are not affected.',
            confirmLabel: 'Reset settings',
          });
          if (ok) { resetSettings(); render(); toast('Settings reset.'); }
        },
      }, 'Reset all settings'))));
}

boot().catch((err) => {
  hideLoading();
  console.error(err);
  toastError(err.message || 'The garage failed to load.');
});
