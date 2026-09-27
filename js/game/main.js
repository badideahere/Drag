// js/game/main.js
// The race page. Owns the game loop, the race modes and the hand-off to the
// backend when a run finishes.
//
// The simulation runs entirely locally at 600 Hz. Supabase is contacted twice
// per visit at most: once to load the car, once to submit the result. Nothing
// in the loop below touches the network.

import { requireAuth } from '../net/auth.js';
import * as api from '../net/api.js';
import { getCar, CAR_LIST, CLASS_NAMES } from '../data/cars.js';
import { buildVehicleSpec, specSummary, defaultTuning } from '../sim/build.js';
import { Vehicle, makeInputs } from '../sim/vehicle.js';
import { PlayerAssist, AIDriver, AI_PERSONALITIES } from './driver.js';
import { Renderer, ENVIRONMENT_LIST, PX_PER_M } from './render.js';
import { ParticleSystem } from './particles.js';
import { HUD } from './hud.js';
import { InputManager } from './input.js';
import { RaceSession, DISTANCES, slipRows } from './race.js';
import { audio } from './audio.js';
import { getSettings, setSetting, DIFFICULTY, DRIVING_MODES } from '../ui/settings.js';
import {
  el, $, clear, toast, toastError, toastSuccess, showLoading, hideLoading,
  renderHeader, updateMoneyChip, fmtMoney, guardButton, modal,
} from '../ui/common.js';
import { clamp, M_TO_FT, MPS_TO_MPH, fmtTime } from '../sim/util.js';
import { drawCarInBox } from './carart.js';
import { pageUrl } from '../config.js';

const START_POSITION = -13;   // metres: the burnout box, behind the beams

const RACE_MODES = {
  test: { id: 'test', name: 'Test Run', blurb: 'Solo pass. No opponent, no payout — just data.', pays: false, opponent: false },
  quick: { id: 'quick', name: 'Quick Race', blurb: 'One random opponent, heads-up, cash on the line.', pays: true, opponent: true },
  headsup: { id: 'headsup', name: 'Heads-Up', blurb: 'Pick your opponent. Both trees go green together.', pays: true, opponent: true },
  bracket: { id: 'bracket', name: 'Bracket', blurb: 'Dial in your ET. Run quicker than your dial and you lose.', pays: true, opponent: true },
  tournament: { id: 'tournament', name: 'Tournament', blurb: 'Four-car ladder. Win twice for the big purse.', pays: true, opponent: true },
  free: { id: 'free', name: 'Free Run', blurb: 'No tree, no timer. Burn tires and break things.', pays: false, opponent: false },
};

const state = {
  profile: null,
  garage: [],
  playerCar: null,
  spec: null,
  vehicle: null,
  assist: null,
  opponentSpec: null,
  opponentVehicle: null,
  ai: null,
  race: null,
  phase: 'setup',        // setup | burnout | staging | running | result | paused
  raceConfig: null,
  tournament: null,
  renderer: null,
  hud: null,
  particles: null,
  input: null,
  lastFrame: 0,
  accum: 0,
  wheelAngleF: 0,
  wheelAngleR: 0,
  oppWheelAngle: 0,
  runStartCondition: null,
  submitting: false,
  frameHandle: 0,
  hintTimer: 0,
};

/* ------------------------------------------------------------------- boot */

async function boot() {
  const session = await requireAuth();
  if (!session) return;

  const loader = showLoading('Loading garage…');
  try {
    const [profile, garage] = await Promise.all([api.getProfile(), api.getGarage()]);
    state.profile = profile;
    state.garage = garage;
    if (profile?.banned) {
      hideLoading();
      document.body.innerHTML = '<div class="fatal"><h1>Account suspended</h1><p>Contact an administrator.</p></div>';
      return;
    }
    renderHeader({ active: 'race', profile });

    if (!garage.length) {
      hideLoading();
      toastError('You do not have a car yet. Visit the dealership.');
      setTimeout(() => location.href = pageUrl('garage.html'), 1400);
      return;
    }

    const wanted = new URLSearchParams(location.search).get('car')
      || localStorage.getItem('staged.lastCar');
    state.playerCar = garage.find((c) => c.id === wanted) || garage[0];
  } catch (err) {
    hideLoading();
    toastError(err.message || 'Could not load your garage.');
    return;
  }
  hideLoading();

  setupCanvas();
  buildPlayer();
  renderSetup();

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.phase === 'running') pause();
  });

  // Audio can only start from a gesture.
  const unlock = async () => {
    await audio.resume();
    const s = getSettings();
    audio.setVolumes({
      master: s.volumeMaster, engine: s.volumeEngine,
      effects: s.volumeEffects, music: s.volumeMusic,
    });
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  state.lastFrame = performance.now();
  state.frameHandle = requestAnimationFrame(frame);
}

function setupCanvas() {
  const s = getSettings();
  state.renderer = new Renderer($('#track-canvas'), {
    environment: s.environment,
    quality: s.graphicsQuality,
    reduced: s.reducedEffects,
    screenShake: s.screenShake,
  });
  state.hud = new HUD($('#hud-canvas'), { telemetry: s.showTelemetry, units: s.units });
  state.particles = new ParticleSystem({
    quality: s.particles,
    reduced: s.reducedEffects || !s.smoke,
  });
  state.input = new InputManager();
}

function onResize() {
  state.renderer?.resize();
  state.hud?.resize();
}

/* ------------------------------------------------------- vehicle assembly */

function buildPlayer() {
  const pc = state.playerCar;
  const base = getCar(pc.carId);
  state.spec = buildVehicleSpec(pc.carId, {
    upgrades: pc.upgrades,
    tuning: pc.tuning || defaultTuning(pc.carId),
    condition: pc.condition,
  });
  state.vehicle = new Vehicle(state.spec, {
    surface: 'prepped',
    ambientC: 22,
    condition: pc.condition,
  });
  state.vehicle.position = START_POSITION;
  const mode = getSettings().drivingMode;
  state.assist = new PlayerAssist(state.spec, mode);
  state.baseCar = base;
}

/**
 * Build an opponent that is a genuine car with a genuine driver. The AI has no
 * speed multiplier anywhere — it is the same Vehicle class the player drives.
 */
function buildOpponent(opts = {}) {
  const diff = DIFFICULTY[getSettings().difficulty] || DIFFICULTY.normal;
  const playerSummary = specSummary(state.spec);
  const ptw = playerSummary.powerToWeight;

  let carId = opts.carId;
  if (!carId) {
    // Pick something in the same performance ballpark so racing feels fair.
    const scored = CAR_LIST.map((c) => {
      const s = specSummary(buildVehicleSpec(c.id, {}));
      return { id: c.id, diff: Math.abs(s.powerToWeight - ptw), ptw: s.powerToWeight };
    }).sort((a, b) => a.diff - b.diff);
    const pool = scored.slice(0, 4);
    carId = pool[Math.floor(Math.random() * pool.length)].id;
  }

  // Opponents get upgrades scaled to difficulty so the ladder can climb.
  const tier = Math.round(clamp(diff.skill * 3, 0, 3));
  const upgrades = tier > 0
    ? { intake: Math.min(tier, 2), exhaust: Math.min(tier, 2), tires: Math.min(tier, 3), clutch: Math.min(tier, 2) }
    : {};

  const spec = buildVehicleSpec(carId, { upgrades: opts.upgrades || upgrades });
  const vehicle = new Vehicle(spec, { surface: 'prepped', ambientC: 22 });
  vehicle.position = START_POSITION;

  const personality = opts.personality
    || AI_PERSONALITIES[Math.floor(Math.random() * AI_PERSONALITIES.length)];
  const ai = new AIDriver(vehicle, {
    skill: clamp(diff.skill + (opts.skillBonus || 0), 0, 1),
    personality,
    seed: (Math.random() * 1e9) | 0,
    name: opts.name || randomDriverName(),
  });
  ai.mistakeChance *= diff.mistakeScale;

  state.opponentSpec = spec;
  state.opponentVehicle = vehicle;
  state.ai = ai;
  state.opponentCar = getCar(carId);
  return { spec, vehicle, ai };
}

const FIRST = ['Dale', 'Marco', 'Rhea', 'Tobias', 'Jodie', 'Kwame', 'Nadia', 'Ellis', 'Priya', 'Vic', 'Lena', 'Bo', 'Sasha', 'Emeka'];
const LAST = ['Cutler', 'Vance', 'Okafor', 'Hallberg', 'Reyes', 'Novak', 'Ferris', 'Malouf', 'Strand', 'Bexley', 'Ibarra', 'Quill'];
function randomDriverName() {
  return `${FIRST[(Math.random() * FIRST.length) | 0]} ${LAST[(Math.random() * LAST.length) | 0]}`;
}

/* ------------------------------------------------------------ setup panel */

function renderSetup() {
  state.phase = 'setup';
  const host = $('#setup-panel');
  host.hidden = false;
  $('#result-panel').hidden = true;
  $('#pause-panel').hidden = true;
  clear(host);

  const s = getSettings();
  const summary = specSummary(state.spec);

  const carSelect = el('select', { class: 'input', onchange: (e) => switchCar(e.target.value) },
    ...state.garage.map((g) => {
      const base = getCar(g.carId);
      return el('option', { value: g.id, selected: g.id === state.playerCar.id },
        `${g.nickname || base.name} — ${CLASS_NAMES[base.class] || base.class}`);
    }));

  const modeSelect = el('select', { class: 'input', id: 'race-mode' },
    ...Object.values(RACE_MODES).map((m) => el('option', { value: m.id }, m.name)));

  const distSelect = el('select', { class: 'input', id: 'race-distance' },
    ...DISTANCES.map((d) => el('option', { value: d.feet, selected: d.feet === 1320 }, d.label)),
    el('option', { value: 'custom' }, 'Custom…'));

  const customDist = el('input', { class: 'input', type: 'number', min: 200, max: 5280, value: 1320, hidden: true, id: 'race-custom-distance' });
  distSelect.addEventListener('change', () => {
    customDist.hidden = distSelect.value !== 'custom';
  });

  const treeSelect = el('select', { class: 'input', id: 'race-tree' },
    el('option', { value: 'pro', selected: s.tree === 'pro' }, 'Pro Tree (0.400 s)'),
    el('option', { value: 'sportsman', selected: s.tree === 'sportsman' }, 'Sportsman Tree (0.500 s)'));

  const envSelect = el('select', { class: 'input', id: 'race-env' },
    ...ENVIRONMENT_LIST.map((e) => el('option', { value: e.id, selected: e.id === s.environment }, e.name)));

  const modeDriving = el('select', { class: 'input', id: 'driving-mode' },
    ...Object.values(DRIVING_MODES).map((m) => el('option', { value: m.id, selected: m.id === s.drivingMode }, m.name)));

  const diffSelect = el('select', { class: 'input', id: 'difficulty' },
    ...Object.entries(DIFFICULTY).map(([k, v]) => el('option', { value: k, selected: k === s.difficulty }, v.label)));

  const dialInput = el('input', { class: 'input', type: 'number', step: '0.01', min: '4', max: '40', value: (state.playerCar.bestEtQuarter || 12).toFixed(2), id: 'dial-in' });
  const dialField = el('label', { class: 'field', id: 'dial-field', hidden: true },
    el('span', {}, 'Your dial-in (seconds)'), dialInput);

  const autoStage = el('input', { type: 'checkbox', id: 'auto-stage' });

  modeSelect.addEventListener('change', () => {
    const m = RACE_MODES[modeSelect.value];
    $('#mode-blurb').textContent = m.blurb;
    dialField.hidden = modeSelect.value !== 'bracket';
  });

  const preview = el('canvas', { class: 'car-preview', width: 640, height: 220 });

  host.appendChild(el('div', { class: 'setup-inner' },
    el('div', { class: 'setup-col setup-car' },
      el('h1', { class: 'screen-title' }, 'Race Setup'),
      preview,
      el('div', { class: 'stat-grid' },
        stat('Power', `${Math.round(summary.peakHp)} hp @ ${summary.peakHpRpm} rpm`),
        stat('Torque', `${Math.round(summary.peakTorqueLbFt)} lb-ft @ ${summary.peakTorqueRpm} rpm`),
        stat('Weight', `${Math.round(summary.massLb)} lb`),
        stat('Power / weight', `${summary.powerToWeight.toFixed(0)} hp/tonne`),
        stat('Drivetrain', summary.drivetrain),
        stat('Tires', summary.tireCompound.replace('_', ' ')),
        stat('Clutch', summary.clutchType),
        stat('Differential', summary.diffType.toUpperCase())),
      el('div', { class: 'condition-row' },
        cond('Engine', state.playerCar.condition.engineHealth),
        cond('Trans', state.playerCar.condition.transmissionHealth),
        cond('Clutch', state.playerCar.condition.clutchHealth),
        cond('Tires', state.playerCar.condition.tireHealth))),

    el('div', { class: 'setup-col setup-options' },
      el('label', { class: 'field' }, el('span', {}, 'Vehicle'), carSelect),
      el('label', { class: 'field' }, el('span', {}, 'Race mode'), modeSelect),
      el('p', { class: 'field-note', id: 'mode-blurb' }, RACE_MODES.test.blurb),
      el('label', { class: 'field' }, el('span', {}, 'Distance'), distSelect),
      customDist,
      dialField,
      el('label', { class: 'field' }, el('span', {}, 'Tree'), treeSelect),
      el('label', { class: 'field' }, el('span', {}, 'Venue'), envSelect),
      el('div', { class: 'field-row' },
        el('label', { class: 'field' }, el('span', {}, 'Driving mode'), modeDriving),
        el('label', { class: 'field' }, el('span', {}, 'AI difficulty'), diffSelect)),
      el('p', { class: 'field-note' }, DRIVING_MODES[s.drivingMode].blurb),
      el('label', { class: 'check' }, autoStage, el('span', {}, 'Auto-stage (skip the burnout box)')),
      el('div', { class: 'setup-actions' },
        el('button', { class: 'btn primary large', id: 'go-race' }, 'Go to the line'),
        el('a', { class: 'btn ghost', href: pageUrl('garage.html') }, 'Back to garage')),
      el('div', { class: 'controls-hint' },
        el('h3', {}, 'Controls'),
        el('ul', {},
          el('li', {}, 'W / ↑ throttle · S / ↓ brake · A / ← clutch'),
          el('li', {}, 'Space shift up · Q shift down · 1–7 direct gear'),
          el('li', {}, 'B line lock (burnout) · E starter · L launch control'),
          el('li', {}, 'T telemetry · Y reset run · P or Esc pause'))))));

  const pctx = preview.getContext('2d');
  pctx.clearRect(0, 0, preview.width, preview.height);
  drawCarInBox(pctx, state.baseCar, 0, 0, preview.width, preview.height);

  $('#go-race').addEventListener('click', () => startRun());
}

function stat(label, value) {
  return el('div', { class: 'stat' }, el('span', { class: 'stat-l' }, label), el('span', { class: 'stat-v' }, value));
}

function cond(label, v) {
  const cls = v >= 85 ? 'good' : v >= 60 ? 'fair' : v >= 35 ? 'poor' : 'bad';
  return el('div', { class: 'cond' },
    el('span', { class: 'cond-l' }, label),
    el('div', { class: 'cond-bar' }, el('div', { class: `cond-fill ${cls}`, style: { width: `${clamp(v, 0, 100)}%` } })),
    el('span', { class: 'cond-v' }, `${Math.round(v)}%`));
}

function switchCar(playerCarId) {
  const found = state.garage.find((g) => g.id === playerCarId);
  if (!found) return;
  state.playerCar = found;
  localStorage.setItem('staged.lastCar', playerCarId);
  buildPlayer();
  renderSetup();
}

/* ------------------------------------------------------------- run control */

function startRun(cfgOverride = null) {
  const s = getSettings();
  let cfg;
  if (cfgOverride) {
    cfg = cfgOverride;
  } else {
    const modeId = $('#race-mode').value;
    const distSel = $('#race-distance').value;
    const distanceFt = distSel === 'custom'
      ? clamp(parseInt($('#race-custom-distance').value, 10) || 1320, 200, 5280)
      : parseInt(distSel, 10);
    const drivingMode = $('#driving-mode').value;
    const difficulty = $('#difficulty').value;
    const env = $('#race-env').value;
    const tree = $('#race-tree').value;
    setSetting('drivingMode', drivingMode);
    setSetting('difficulty', difficulty);
    setSetting('environment', env);
    setSetting('tree', tree);
    cfg = {
      mode: modeId,
      distanceFt,
      tree,
      autoStage: $('#auto-stage').checked,
      playerDial: modeId === 'bracket' ? parseFloat($('#dial-in').value) : null,
    };
  }

  state.raceConfig = cfg;
  state.renderer.setEnvironment(getSettings().environment);
  state.assist.setMode(getSettings().drivingMode);

  // Fresh vehicle state, but the car keeps the damage it arrived with.
  state.vehicle.reset({ coolTires: true });
  state.vehicle.position = START_POSITION;
  state.runStartCondition = { ...state.playerCar.condition };
  state.particles.clear();

  const modeInfo = RACE_MODES[cfg.mode];
  if (modeInfo.opponent) {
    buildOpponent(cfg.opponent || {});
    state.opponentVehicle.reset({ coolTires: true });
    state.opponentVehicle.position = START_POSITION;
    state.ai.reset();
    if (cfg.mode === 'bracket') {
      // The opponent dials in honestly, from what its car can actually do.
      cfg.opponentDial = cfg.opponentDial ?? estimateDial(state.opponentSpec, cfg.distanceFt);
    }
  } else {
    state.opponentVehicle = null;
    state.ai = null;
    state.opponentCar = null;
  }

  state.race = new RaceSession({
    distanceFt: cfg.distanceFt,
    tree: cfg.tree,
    mode: cfg.mode,
    playerDial: cfg.playerDial,
    opponentDial: cfg.opponentDial,
  });

  if (cfg.autoStage) {
    state.vehicle.position = -0.12;
    if (state.opponentVehicle) state.opponentVehicle.position = -0.12;
  }

  state.aiStaged = false;
  state.aiBurnoutUntil = cfg.autoStage ? 0 : 1.6 + Math.random() * 2.4;
  state.phase = cfg.mode === 'free' ? 'free' : 'burnout';
  $('#setup-panel').hidden = true;
  $('#result-panel').hidden = true;
  $('#pause-panel').hidden = true;
  $('#hud-canvas').hidden = false;
  showHint(cfg.mode === 'free'
    ? 'Free run — no tree, no timer. Hold B with brake and throttle for a burnout.'
    : 'Hold B + brake + throttle for a burnout, then roll forward to stage.', 6000);
}

/** A rough but honest dial-in from a car's own capability. */
function estimateDial(spec, distanceFt) {
  const s = specSummary(spec);
  // Empirical from this simulator's own benchmark runs.
  const quarter = 5.9 * Math.pow(s.massKg / Math.max(s.peakHp, 1), 0.38) + 2.6;
  const scale = distanceFt >= 1320 ? 1 : distanceFt >= 1000 ? 0.86 : 0.655;
  return Math.round(quarter * scale * 100) / 100;
}

function resetRun() {
  if (!state.raceConfig) return;
  startRun(state.raceConfig);
}

function pause() {
  if (state.phase === 'setup' || state.phase === 'result') return;
  state.prevPhase = state.phase;
  state.phase = 'paused';
  audio.idleOut();
  renderPause();
}

function unpause() {
  $('#pause-panel').hidden = true;
  state.phase = state.prevPhase || 'running';
  state.lastFrame = performance.now();
}

function renderPause() {
  const host = $('#pause-panel');
  host.hidden = false;
  clear(host);
  const s = getSettings();
  host.appendChild(el('div', { class: 'pause-box' },
    el('h2', {}, 'Paused'),
    el('div', { class: 'pause-settings' },
      sliderRow('Master volume', s.volumeMaster, (v) => { setSetting('volumeMaster', v); applyAudio(); }),
      sliderRow('Engine volume', s.volumeEngine, (v) => { setSetting('volumeEngine', v); applyAudio(); }),
      sliderRow('Effects volume', s.volumeEffects, (v) => { setSetting('volumeEffects', v); applyAudio(); }),
      toggleRow('Reduced effects', s.reducedEffects, (v) => {
        setSetting('reducedEffects', v);
        state.particles.setQuality(getSettings().particles, v);
        state.renderer.reduced = v;
      }),
      toggleRow('Screen shake', s.screenShake, (v) => {
        setSetting('screenShake', v);
        state.renderer.shakeEnabled = v;
      }),
      toggleRow('Advanced telemetry', s.showTelemetry, (v) => {
        setSetting('showTelemetry', v);
        state.hud.showTelemetry = v;
      })),
    el('div', { class: 'pause-actions' },
      el('button', { class: 'btn primary', onclick: unpause }, 'Resume'),
      el('button', { class: 'btn', onclick: () => { $('#pause-panel').hidden = true; resetRun(); } }, 'Restart run'),
      el('button', { class: 'btn', onclick: () => { $('#pause-panel').hidden = true; renderSetup(); } }, 'Race setup'),
      el('a', { class: 'btn ghost', href: pageUrl('garage.html') }, 'Back to garage'))));
}

function sliderRow(label, value, onInput) {
  return el('label', { class: 'slider-row' },
    el('span', {}, label),
    el('input', {
      type: 'range', min: 0, max: 1, step: 0.01, value,
      oninput: (e) => onInput(parseFloat(e.target.value)),
    }));
}

function toggleRow(label, value, onChange) {
  return el('label', { class: 'check' },
    el('input', { type: 'checkbox', checked: value, onchange: (e) => onChange(e.target.checked) }),
    el('span', {}, label));
}

function applyAudio() {
  const s = getSettings();
  audio.setVolumes({
    master: s.volumeMaster, engine: s.volumeEngine,
    effects: s.volumeEffects, music: s.volumeMusic,
  });
}

/* --------------------------------------------------------------- the loop */

function frame(now) {
  state.frameHandle = requestAnimationFrame(frame);
  let dt = (now - state.lastFrame) / 1000;
  state.lastFrame = now;
  if (!isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, 0.05);       // never let a stall become a physics explosion

  if (state.phase === 'setup') return;

  if (state.phase === 'paused') {
    drawWorld(0);
    state.input.endFrame();
    return;
  }

  step(dt);
  drawWorld(dt);
  state.input.endFrame();
}

function step(dt) {
  const v = state.vehicle;
  if (!v) return;

  const raw = state.input.sample(dt);

  if (state.input.wasPressed('pause')) { pause(); return; }
  if (state.input.wasPressed('telemetry')) {
    const nv = !state.hud.showTelemetry;
    state.hud.showTelemetry = nv;
    setSetting('showTelemetry', nv);
  }
  if (state.input.wasPressed('reset') && state.phase !== 'result') { resetRun(); return; }

  // Driver assists translate raw keys into what the car actually receives.
  const inputs = state.assist.apply(dt, v, { ...makeInputs(), ...raw });
  state.lastInputs = inputs;

  const wasRunning = v.engine.running;
  v.update(dt, inputs);
  if (!wasRunning && v.engine.running) audio.starter(0.5);
  if (wasRunning && !v.engine.running) audio.backfire();

  // ---- opponent
  if (state.opponentVehicle && state.ai) {
    const raceT = state.race ? state.race.time : 0;
    let aiInputs;
    if (state.phase === 'burnout' && raceT < state.aiBurnoutUntil) {
      aiInputs = state.ai.burnout(dt, 0.9);
    } else {
      if (!state.aiStaged) {
        // Crew stages the car once the burnout is done.
        state.opponentVehicle.position = -0.12;
        state.opponentVehicle.speed = 0;
        state.aiStaged = true;
      }
      aiInputs = state.ai.update(dt, raceT);
    }
    state.opponentVehicle.update(dt, aiInputs);
  }

  // ---- race logic
  if (state.race && state.phase !== 'free') {
    const prevState = state.race.state;
    state.race.update(dt, {
      player: v,
      opponent: state.opponentVehicle,
    });
    handleRaceEvents(state.race.drainEvents());
    if (state.race.state === 'countdown' && prevState === 'staging') state.phase = 'staging';
    if (state.race.state === 'running') state.phase = 'running';
    if (state.race.state === 'finished' && state.phase !== 'result') {
      state.phase = 'result';
      onRunFinished();
    }
  }

  // ---- wheels, particles, audio
  const tel = v.telemetry();
  state.telemetry = tel;
  state.wheelAngleF += tel.tiresFront.omega * dt;
  state.wheelAngleR += tel.tiresRear.omega * dt;
  if (state.opponentVehicle) {
    state.oppWheelAngle += (state.opponentVehicle.axleR.omega || 0) * dt;
  }

  spawnParticles(dt, tel);
  state.particles.update(dt);

  audio.update(tel, state.spec, dt);

  // Shock through the chassis when the clutch bites hard or a tire hooks up.
  if (tel.accelG > 0.9) state.renderer.addShake(clamp((tel.accelG - 0.9) * 0.08, 0, 0.3) * dt * 60);
  if (tel.warnings.includes('ENGINE FAILURE')) { audio.bang(); state.renderer.addShake(0.8); }
}

function spawnParticles(dt, tel) {
  const s = getSettings();
  if (!s.smoke && s.reducedEffects) return;
  const v = state.vehicle;
  const art = state.baseCar.art;
  const lengthM = (art.lengthPx || 420) / 90;
  // Particle space is metres * PX_PER_M with the origin at the start line.
  const toPx = PX_PER_M;
  const rearX = (v.position - lengthM * ((art.wheels.rearX ?? 0.8) - 0.5)) * toPx;
  const frontX = (v.position - lengthM * ((art.wheels.frontX ?? 0.2) - 0.5)) * toPx;
  const wheelR = (art.wheels.radius ?? 0.15) * (art.lengthPx || 420);

  const driven = state.spec.drivetrain;
  const rear = tel.tiresRear, front = tel.tiresFront;

  if (driven !== 'FWD' && rear.smoke > 0.01) {
    state.particles.tireSmoke(rearX, 0, rear.smoke, Math.abs(rear.slipVelocity), dt, {
      heat: clamp(rear.tempC / 140, 0, 1), carVx: -v.speed * toPx * 0.02,
    });
    state.particles.debris(rearX, 0, rear.smoke * 0.5, dt, { dir: 1 });
  }
  if (driven !== 'RWD' && front.smoke > 0.01) {
    state.particles.tireSmoke(frontX, 0, front.smoke, Math.abs(front.slipVelocity), dt, {
      heat: clamp(front.tempC / 140, 0, 1), carVx: -v.speed * toPx * 0.02,
    });
  }
  // exhaust
  const exX = (v.position - lengthM * 0.47) * toPx;
  state.particles.exhaust(exX, -wheelR * 0.30, tel.engine.load * tel.engine.throttle, dt, {
    carVx: -v.speed * toPx * 0.05,
  });

  // Opponent smoke, in the far lane
  if (state.opponentVehicle) {
    const ot = state.opponentVehicle.axleR;
    if (ot.smoke > 0.02 && state.opponentSpec.drivetrain !== 'FWD') {
      // Far-lane particles are drawn in the same space, lifted up the screen.
      state.particles.tireSmoke(state.opponentVehicle.position * toPx, -145, ot.smoke * 0.8,
        Math.abs(ot.slipVelocity), dt, { heat: 0.5 });
    }
  }
}

function handleRaceEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case 'bulb': audio.bulb(); break;
      case 'amber': audio.bulb(); break;
      case 'green':
        if (e.lane === 'player') {
          audio.green();
          state.renderer.addShake(0.12);
        } else if (e.lane === 'opponent' && state.ai) {
          // Without this the AI sits on the line forever waiting for a light
          // it was never shown. In a bracket race its tree is offset from the
          // player's by the dial-in difference, so it gets its own green time.
          state.ai.onGreen(state.race.greenTimeOpp ?? state.race.greenTime);
        }
        break;
      case 'foul': if (e.lane === 'player') audio.foul(); break;
      case 'finished': break;
      default: break;
    }
  }
}

/* -------------------------------------------------------------- rendering */

function drawWorld(dt) {
  const v = state.vehicle;
  if (!v) return;
  const tel = state.telemetry || v.telemetry();

  state.renderer.draw({
    dt,
    time: performance.now() / 1000,
    distanceM: (state.raceConfig?.distanceFt || 1320) * 0.3048,
    particles: state.particles,
    race: state.race,
    player: {
      car: state.baseCar,
      vehicle: v,
      telemetry: tel,
      frontWheelAngle: state.wheelAngleF,
      rearWheelAngle: state.wheelAngleR,
      brake: state.lastInputs?.brake ?? 0,
    },
    opponent: state.opponentVehicle ? {
      car: state.opponentCar,
      vehicle: state.opponentVehicle,
      telemetry: state.opponentVehicle.telemetry(),
      wheelAngle: state.oppWheelAngle,
      brake: 0,
    } : null,
  });

  if (!$('#hud-canvas').hidden) {
    state.hud.draw({
      dt,
      elapsed: performance.now() / 1000,
      telemetry: tel,
      spec: state.spec,
      race: state.race,
      inputs: state.lastInputs,
      distanceFt: state.raceConfig?.distanceFt || 1320,
      countdownMessage: state.phase === 'paused' ? 'PAUSED' : null,
    });
  }
}

let hintTimeout = 0;
function showHint(text, ms = 4000) {
  const bar = $('#hint-bar');
  bar.textContent = text;
  bar.hidden = false;
  clearTimeout(hintTimeout);
  hintTimeout = setTimeout(() => { bar.hidden = true; }, ms);
}

/* ------------------------------------------------------------ run finished */

async function onRunFinished() {
  const slip = state.race.timeslip();
  const condition = state.vehicle.condition();
  audio.idleOut();

  // Show the slip immediately; the server call happens behind it.
  renderResult(slip, null, 'submitting');

  const modeInfo = RACE_MODES[state.raceConfig.mode];
  if (!modeInfo.pays && state.raceConfig.mode !== 'test') {
    renderResult(slip, null, 'done');
    return;
  }

  try {
    const payload = {
      playerCarId: state.playerCar.id,
      mode: state.raceConfig.mode,
      distanceFt: state.raceConfig.distanceFt,
      drivingMode: getSettings().drivingMode,
      difficulty: getSettings().difficulty,
      tree: state.raceConfig.tree,
      result: slip.winner === 'player' ? 'win' : slip.winner === 'opponent' ? 'loss' : 'none',
      timeslip: {
        reaction: slip.player.reaction,
        foul: slip.player.foul,
        sixty: slip.player.sixty,
        threeThirty: slip.player.threeThirty,
        eighthEt: slip.player.eighthEt,
        eighthMph: slip.player.eighthMph,
        thousandEt: slip.player.thousandEt,
        quarterEt: slip.player.quarterEt,
        quarterMph: slip.player.quarterMph,
        et: slip.player.et,
        trapMph: slip.player.trapMph,
      },
      opponent: slip.opponent ? {
        name: state.ai?.name || 'Opponent',
        carId: state.opponentCar?.id,
        et: slip.opponent.et,
        trapMph: slip.opponent.trapMph,
        reaction: slip.opponent.reaction,
      } : null,
      condition,
      dial: slip.playerDial,
    };
    const res = await api.submitRace(payload);

    // Trust the server's numbers, not ours.
    state.profile.money_cents = res.moneyCents;
    updateMoneyChip(res.moneyCents);
    Object.assign(state.playerCar.condition, res.condition || condition);
    if (res.bests) {
      state.playerCar.bestEtQuarter = res.bests.best_et_quarter;
      state.playerCar.bestMphQuarter = res.bests.best_mph_quarter;
      state.playerCar.bestEtEighth = res.bests.best_et_eighth;
      state.playerCar.bestMphEighth = res.bests.best_mph_eighth;
    }
    renderResult(slip, res, 'done');
  } catch (err) {
    renderResult(slip, null, 'error', err.message);
  }
}

function renderResult(slip, serverRes, status, errorMessage) {
  const host = $('#result-panel');
  host.hidden = false;
  clear(host);

  const dist = slip.distanceFt;
  const rows = slipRows(slip.player, dist);
  const oppRows = slip.opponent ? slipRows(slip.opponent, dist) : null;

  const won = slip.winner === 'player';
  const head = el('div', { class: `result-head ${won ? 'win' : slip.winner === 'opponent' ? 'loss' : ''}` },
    el('h1', {}, slip.winner == null ? (slip.player.foul ? 'Foul' : 'Run complete')
      : won ? 'Win' : 'Loss'),
    el('p', {}, slip.message));

  const slipCard = el('div', { class: 'timeslip' },
    el('div', { class: 'timeslip-head' },
      el('span', {}, 'OFFICIAL TIMESLIP'),
      el('span', {}, `${dist} FT`)),
    el('div', { class: 'timeslip-cols' },
      el('div', { class: 'timeslip-col' },
        el('h3', {}, state.playerCar.nickname || state.baseCar.name),
        slip.playerDial ? el('div', { class: 'dial' }, `DIAL ${slip.playerDial.toFixed(2)}`) : null,
        ...rows.map(([l, v]) => el('div', { class: 'ts-row' }, el('span', {}, l), el('b', {}, v)))),
      oppRows ? el('div', { class: 'timeslip-col' },
        el('h3', {}, state.ai?.name || 'Opponent'),
        slip.opponentDial ? el('div', { class: 'dial' }, `DIAL ${slip.opponentDial.toFixed(2)}`) : null,
        ...oppRows.map(([l, v]) => el('div', { class: 'ts-row' }, el('span', {}, l), el('b', {}, v)))) : null));

  const payoutBox = el('div', { class: 'payout' });
  if (status === 'submitting') {
    payoutBox.appendChild(el('div', { class: 'muted' }, 'Submitting race…'));
  } else if (status === 'error') {
    payoutBox.appendChild(el('div', { class: 'error-text' }, errorMessage || 'Race result rejected.'));
    payoutBox.appendChild(el('div', { class: 'muted' }, 'Your progress for this run was not saved.'));
  } else if (serverRes) {
    const payout = serverRes.payoutCents || 0;
    payoutBox.appendChild(el('div', { class: `payout-amount ${payout >= 0 ? 'plus' : 'minus'}` },
      `${payout >= 0 ? '+' : '−'}${fmtMoney(Math.abs(payout))}`));
    payoutBox.appendChild(el('div', { class: 'muted' }, serverRes.payoutReason || 'Race reward'));
    payoutBox.appendChild(el('div', { class: 'muted' }, `Balance ${fmtMoney(serverRes.moneyCents)}`));
    if (serverRes.personalBest) payoutBox.appendChild(el('div', { class: 'pb' }, 'PERSONAL BEST'));
    if (serverRes.warnings?.length) {
      payoutBox.appendChild(el('div', { class: 'muted' }, serverRes.warnings.join(' · ')));
    }
  }

  // Damage summary — the player should always know what the run cost them.
  const before = state.runStartCondition;
  const after = state.vehicle.condition();
  const deltas = [
    ['Engine', before.engineHealth - after.engineHealth],
    ['Transmission', before.transmissionHealth - after.transmissionHealth],
    ['Clutch', before.clutchHealth - after.clutchHealth],
    ['Tires', before.tireHealth - after.tireHealth],
  ].filter(([, d]) => d > 0.05);
  const damageBox = deltas.length
    ? el('div', { class: 'damage-box' },
      el('h3', {}, 'Wear this run'),
      ...deltas.map(([l, d]) => el('div', { class: 'ts-row' },
        el('span', {}, l), el('b', { class: d > 4 ? 'bad' : '' }, `−${d.toFixed(1)}%`))))
    : null;

  const tournamentNext = state.tournament && state.tournament.active;

  host.appendChild(el('div', { class: 'result-inner' },
    head,
    slipCard,
    el('div', { class: 'result-side' }, payoutBox, damageBox),
    el('div', { class: 'result-actions' },
      el('button', { class: 'btn primary large', onclick: () => resetRun() }, 'Run it again'),
      tournamentNext
        ? el('button', { class: 'btn', onclick: () => advanceTournament(slip) }, 'Next round')
        : null,
      el('button', { class: 'btn', onclick: () => renderSetup() }, 'Race setup'),
      el('a', { class: 'btn ghost', href: pageUrl('garage.html') }, 'Garage'))));

  if (state.raceConfig.mode === 'tournament' && !state.tournament) {
    state.tournament = { round: 1, active: slip.winner === 'player' };
  }
}

function advanceTournament(slip) {
  if (slip.winner !== 'player') { state.tournament = null; renderSetup(); return; }
  state.tournament.round += 1;
  state.tournament.active = state.tournament.round < 3;
  startRun({
    ...state.raceConfig,
    opponent: { skillBonus: 0.12 * state.tournament.round },
  });
  toast(`Round ${state.tournament.round}`, 'info');
}

/* -------------------------------------------------------------------- go */

boot().catch((err) => {
  hideLoading();
  console.error(err);
  toastError(err.message || 'The game failed to start.');
});
