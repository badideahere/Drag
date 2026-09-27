// js/admin/admin.js
// The admin panel.
//
// IMPORTANT: nothing in this file grants any permission. Every button here
// calls an Edge Function that re-reads the caller's role from the database
// before it does anything. Hiding a button is not security — the buttons are
// hidden because showing tools that will be refused is bad UI, not because
// hiding them protects anything.

import { requireAuth, logout } from '../net/auth.js';
import * as api from '../net/api.js';
import { getCar, CAR_LIST, CLASS_NAMES } from '../data/cars.js';
import {
  el, $, $$, clear, toast, toastError, toastSuccess, showLoading, hideLoading,
  fmtMoney, guardButton, modal, confirmDialog, relativeTime, healthClass, etText, mphText,
} from '../ui/common.js';
import { pageUrl, CONFIG } from '../config.js';

const PERMISSIONS = {
  MODERATOR: { viewPlayers: true, viewRaces: true, viewAudit: true, moderate: true },
  ADMIN: {
    viewPlayers: true, viewRaces: true, viewAudit: true, moderate: true,
    money: true, vehicles: true, viewEconomy: true,
  },
  OWNER: {
    viewPlayers: true, viewRaces: true, viewAudit: true, moderate: true,
    money: true, vehicles: true, viewEconomy: true, roles: true, unlimited: true,
  },
};

const admin = {
  profile: null,
  perms: {},
  section: 'dashboard',
  selectedPlayer: null,
};

/* ------------------------------------------------------------------- boot */

async function boot() {
  const session = await requireAuth();
  if (!session) return;
  showLoading('Checking permissions…');
  try {
    admin.profile = await api.getProfile();
  } catch (err) {
    hideLoading();
    fatal(err.message);
    return;
  }
  hideLoading();

  const role = admin.profile?.role || 'PLAYER';
  if (!PERMISSIONS[role]) {
    fatal('You do not have permission to use the admin panel.');
    return;
  }
  admin.perms = PERMISSIONS[role];

  renderShell();
  show('dashboard');
}

function fatal(message) {
  document.body.innerHTML = '';
  document.body.appendChild(el('div', { class: 'fatal' },
    el('h1', {}, 'Admin permission denied'),
    el('p', {}, message),
    el('a', { class: 'btn', href: pageUrl('garage.html') }, 'Back to the game')));
}

/* ------------------------------------------------------------------ shell */

function renderShell() {
  const sections = [
    { id: 'dashboard', label: 'Dashboard', show: true },
    { id: 'players', label: 'Players', show: admin.perms.viewPlayers },
    { id: 'economy', label: 'Economy', show: admin.perms.viewEconomy },
    { id: 'vehicles', label: 'Vehicles', show: admin.perms.vehicles },
    { id: 'races', label: 'Race Results', show: admin.perms.viewRaces },
    { id: 'audit', label: 'Audit Log', show: admin.perms.viewAudit },
  ].filter((s) => s.show);

  const root = $('#admin-root');
  clear(root);
  root.appendChild(el('aside', { class: 'admin-side' },
    el('div', { class: 'admin-brand' },
      el('b', {}, CONFIG.GAME_NAME),
      el('span', {}, 'ADMIN')),
    el('nav', {},
      ...sections.map((s) => el('button', {
        class: 'admin-nav',
        dataset: { section: s.id },
        onclick: () => show(s.id),
      }, s.label))),
    el('div', { class: 'admin-user' },
      el('div', {}, admin.profile.username || 'Admin'),
      el('div', { class: 'role-badge' }, admin.profile.role),
      el('a', { class: 'btn ghost small', href: pageUrl('garage.html') }, 'Back to game'),
      el('button', {
        class: 'btn ghost small',
        onclick: async () => { await logout(); location.href = pageUrl('index.html'); },
      }, 'Log out'))));
  root.appendChild(el('main', { class: 'admin-main', id: 'admin-main' }));
}

function show(section) {
  admin.section = section;
  $$('.admin-nav').forEach((b) => b.classList.toggle('active', b.dataset.section === section));
  const main = $('#admin-main');
  clear(main);
  ({
    dashboard: renderDashboard,
    players: renderPlayers,
    economy: renderEconomy,
    vehicles: renderVehicles,
    races: renderRaces,
    audit: renderAudit,
  }[section] || renderDashboard)(main);
}

/* -------------------------------------------------------------- dashboard */

async function renderDashboard(host) {
  host.appendChild(el('h1', {}, 'Dashboard'));
  const cards = el('div', { class: 'admin-cards' }, el('div', { class: 'muted' }, 'Loading…'));
  const recent = el('div', { class: 'admin-panel' });
  host.appendChild(cards);
  host.appendChild(recent);

  try {
    const res = await api.admin.dashboard();
    clear(cards);
    const d = res.data;
    cards.appendChild(el('div', { class: 'admin-card' }, el('b', {}, d.totalPlayers), el('span', {}, 'Total players')));
    cards.appendChild(el('div', { class: 'admin-card' }, el('b', {}, d.activePlayers), el('span', {}, 'Active (7 days)')));
    cards.appendChild(el('div', { class: 'admin-card' }, el('b', {}, d.totalRaces), el('span', {}, 'Races run')));
    cards.appendChild(el('div', { class: 'admin-card' }, el('b', {}, fmtMoney(d.totalMoneyCents)), el('span', {}, 'Money in circulation')));
    cards.appendChild(el('div', { class: 'admin-card' }, el('b', {}, d.totalCars), el('span', {}, 'Vehicles owned')));
    cards.appendChild(el('div', { class: 'admin-card' }, el('b', {}, d.bannedPlayers), el('span', {}, 'Suspended accounts')));

    clear(recent);
    recent.appendChild(el('h2', {}, 'Recent admin actions'));
    if (!d.recentActions?.length) {
      recent.appendChild(el('div', { class: 'muted' }, 'No admin actions recorded yet.'));
    } else {
      recent.appendChild(auditTable(d.recentActions));
    }
  } catch (err) {
    clear(cards);
    cards.appendChild(el('div', { class: 'error-text' }, err.message));
  }
}

/* ---------------------------------------------------------------- players */

function renderPlayers(host) {
  host.appendChild(el('h1', {}, 'Players'));
  const input = el('input', {
    class: 'input', placeholder: 'Search by driver name, email or user ID…', autocomplete: 'off',
  });
  const results = el('div', { class: 'admin-panel' },
    el('div', { class: 'muted' }, 'Type at least 2 characters to search.'));
  const detail = el('div', { class: 'admin-panel', id: 'player-detail', hidden: true });

  host.appendChild(el('div', { class: 'search-bar' }, input,
    el('button', { class: 'btn primary', onclick: () => doSearch() }, 'Search')));
  host.appendChild(results);
  host.appendChild(detail);

  let timer = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(doSearch, 320);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  async function doSearch() {
    const q = input.value.trim();
    clear(results);
    if (q.length < 2) {
      results.appendChild(el('div', { class: 'muted' }, 'Type at least 2 characters to search.'));
      return;
    }
    results.appendChild(el('div', { class: 'muted' }, 'Searching…'));
    try {
      // The search runs in the database, not by downloading every user.
      const res = await api.admin.searchPlayers(q, { limit: 25 });
      clear(results);
      if (!res.data.length) {
        results.appendChild(el('div', { class: 'muted' }, 'No players matched that search.'));
        return;
      }
      const table = el('div', { class: 'admin-table' },
        el('div', { class: 'at-row at-head' },
          el('span', {}, 'Driver'), el('span', {}, 'Email'), el('span', {}, 'Role'),
          el('span', {}, 'Balance'), el('span', {}, 'Cars'), el('span', {}, 'Last seen'), el('span', {}, '')));
      for (const p of res.data) {
        table.appendChild(el('div', { class: `at-row${p.banned ? ' banned' : ''}` },
          el('span', {}, p.username || '—'),
          el('span', { class: 'muted mono' }, p.email || '—'),
          el('span', { class: 'role-badge small' }, p.role),
          el('span', {}, fmtMoney(p.money_cents)),
          el('span', {}, String(p.car_count ?? '—')),
          el('span', { class: 'muted' }, relativeTime(p.last_seen || p.created_at)),
          el('button', { class: 'btn small', onclick: () => openPlayer(p.id) }, 'Manage')));
      }
      results.appendChild(table);
    } catch (err) {
      clear(results);
      results.appendChild(el('div', { class: 'error-text' }, err.message));
    }
  }
}

async function openPlayer(playerId) {
  const detail = $('#player-detail') || $('#admin-main');
  detail.hidden = false;
  clear(detail);
  detail.appendChild(el('div', { class: 'muted' }, 'Loading player…'));
  let data;
  try {
    const res = await api.admin.getPlayer(playerId);
    data = res.data;
  } catch (err) {
    clear(detail);
    detail.appendChild(el('div', { class: 'error-text' }, err.message));
    return;
  }
  admin.selectedPlayer = data;
  clear(detail);

  const p = data.profile;
  detail.appendChild(el('div', { class: 'player-head' },
    el('div', {},
      el('h2', {}, p.username || 'Driver'),
      el('div', { class: 'muted mono' }, p.id),
      el('div', { class: 'muted' }, p.email || ''),
      el('div', { class: 'player-badges' },
        el('span', { class: 'role-badge' }, p.role),
        p.banned ? el('span', { class: 'ban-badge' }, 'SUSPENDED') : null)),
    el('div', { class: 'player-balance' },
      el('span', { class: 'muted' }, 'Balance'),
      el('b', {}, fmtMoney(p.money_cents)))));

  // ---- stats
  const s = data.statistics || {};
  detail.appendChild(el('div', { class: 'admin-cards small' },
    el('div', { class: 'admin-card' }, el('b', {}, s.races || 0), el('span', {}, 'Races')),
    el('div', { class: 'admin-card' }, el('b', {}, s.wins || 0), el('span', {}, 'Wins')),
    el('div', { class: 'admin-card' }, el('b', {}, s.best_et_quarter ? etText(s.best_et_quarter) : '—'), el('span', {}, 'Best 1/4 ET')),
    el('div', { class: 'admin-card' }, el('b', {}, fmtMoney(s.total_earnings_cents || 0)), el('span', {}, 'Career earnings'))));

  // ---- money tools
  if (admin.perms.money) {
    detail.appendChild(moneyTools(p));
  }

  // ---- vehicles
  if (admin.perms.vehicles) {
    detail.appendChild(vehicleTools(p, data.cars || []));
  } else {
    detail.appendChild(el('section', { class: 'admin-section' },
      el('h3', {}, `Vehicles (${(data.cars || []).length})`),
      el('div', { class: 'admin-table' },
        ...(data.cars || []).map((c) => el('div', { class: 'at-row' },
          el('span', {}, getCar(c.car_id)?.name || c.car_id),
          el('span', { class: 'muted' }, c.nickname || ''),
          el('span', {}, `${Number(c.engine_health).toFixed(0)}% engine`))))));
  }

  // ---- moderation
  if (admin.perms.moderate) {
    detail.appendChild(moderationTools(p));
  }

  // ---- recent races
  detail.appendChild(el('section', { class: 'admin-section' },
    el('h3', {}, 'Recent races'),
    (data.races || []).length
      ? raceTable(data.races)
      : el('div', { class: 'muted' }, 'No races recorded.')));

  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ------------------------------------------------------------ money tools */

function moneyTools(p) {
  const custom = el('input', { class: 'input', type: 'number', min: 0, step: '0.01', placeholder: '0.00' });
  const reason = el('input', { class: 'input', placeholder: 'Reason (recorded in the audit log)' });
  let operation = 'ADD';

  const opButtons = ['ADD', 'REMOVE', 'SET'].map((op) => {
    const b = el('button', {
      class: `btn toggle${op === 'ADD' ? ' active' : ''}`,
      onclick: () => {
        operation = op;
        opButtons.forEach((x) => x.classList.toggle('active', x.textContent === op));
      },
    }, op);
    return b;
  });

  const quick = [10000, 100000, 1000000, 10000000];  // $100, $1,000, $10,000, $100,000

  async function apply(amountCents) {
    if (!amountCents || amountCents < 0) { toastError('Enter a valid amount.'); return; }
    const big = amountCents >= 1000000; // $10,000+
    const ok = await confirmDialog({
      title: `${operation} ${fmtMoney(amountCents)}`,
      message: `${operation === 'SET' ? 'Set' : operation === 'ADD' ? 'Add' : 'Remove'} ${fmtMoney(amountCents)} `
        + `${operation === 'SET' ? 'as' : operation === 'ADD' ? 'to' : 'from'} ${p.username || 'this player'}'s balance. `
        + 'This is permanent and is written to the audit log.',
      confirmLabel: `${operation} money`,
      danger: operation === 'REMOVE' || operation === 'SET',
      requireTyping: big ? 'CONFIRM' : null,
    });
    if (!ok) return;
    const res = await api.admin.money(p.id, operation, amountCents, reason.value.trim() || null);
    p.money_cents = res.moneyCents;
    toastSuccess(`Balance is now ${fmtMoney(res.moneyCents)}.`);
    openPlayer(p.id);
  }

  const quickButtons = quick.map((cents) => {
    const b = el('button', { class: 'btn small' }, fmtMoney(cents));
    guardButton(b, () => apply(cents), 'Working…');
    return b;
  });

  const applyBtn = el('button', { class: 'btn primary' }, 'Apply custom amount');
  guardButton(applyBtn, () => apply(Math.round(parseFloat(custom.value || '0') * 100)), 'Working…');

  return el('section', { class: 'admin-section' },
    el('h3', {}, 'Economy'),
    el('div', { class: 'op-row' }, ...opButtons),
    el('div', { class: 'quick-row' }, ...quickButtons),
    el('div', { class: 'field-row' },
      el('label', { class: 'field' }, el('span', {}, 'Custom amount ($)'), custom),
      el('label', { class: 'field' }, el('span', {}, 'Reason'), reason)),
    applyBtn);
}

/* ---------------------------------------------------------- vehicle tools */

function vehicleTools(p, cars) {
  const carSelect = el('select', { class: 'input' },
    ...CAR_LIST.map((c) => el('option', { value: c.id }, `${c.name} — ${CLASS_NAMES[c.class]}`)));

  const giveBtn = el('button', { class: 'btn primary' }, 'Give vehicle');
  guardButton(giveBtn, async () => {
    const car = getCar(carSelect.value);
    const ok = await confirmDialog({
      title: 'Give vehicle',
      message: `Add a ${car.name} to ${p.username || 'this player'}'s garage at no cost?`,
      confirmLabel: 'Give vehicle',
    });
    if (!ok) return;
    await api.admin.vehicle(p.id, 'GIVE_CAR', { carId: carSelect.value });
    toastSuccess(`${car.name} added.`);
    openPlayer(p.id);
  }, 'Working…');

  const rows = cars.map((c) => {
    const base = getCar(c.car_id);
    const mk = (label, operation, opts = {}) => {
      const b = el('button', { class: `btn small ${opts.danger ? 'danger' : ''}` }, label);
      guardButton(b, async () => {
        const ok = await confirmDialog({
          title: `${label} — ${base?.name || c.car_id}`,
          message: opts.message,
          confirmLabel: label,
          danger: !!opts.danger,
          requireTyping: opts.requireTyping,
        });
        if (!ok) return;
        await api.admin.vehicle(p.id, operation, { playerCarId: c.id });
        toastSuccess(`${label} done.`);
        openPlayer(p.id);
      }, 'Working…');
      return b;
    };

    return el('div', { class: 'at-row' },
      el('span', {}, base?.name || c.car_id),
      el('span', { class: 'muted' }, c.nickname || ''),
      el('span', { class: healthClass(Number(c.engine_health)) }, `ENG ${Number(c.engine_health).toFixed(0)}%`),
      el('span', { class: healthClass(Number(c.clutch_health)) }, `CLU ${Number(c.clutch_health).toFixed(0)}%`),
      el('span', { class: healthClass(Number(c.tire_health)) }, `TIRE ${Number(c.tire_health).toFixed(0)}%`),
      el('span', { class: 'row-actions' },
        el('button', { class: 'btn small ghost', onclick: () => inspectVehicle(c) }, 'Inspect'),
        mk('Repair', 'REPAIR_CAR', { message: 'Restore every component on this vehicle to 100% at no cost to the player.' }),
        mk('Reset', 'RESET_CAR', {
          message: 'Remove all upgrades and tuning and restore the vehicle to stock condition. This cannot be undone.',
          danger: true,
        }),
        mk('Remove', 'REMOVE_CAR', {
          message: 'Permanently delete this vehicle, its upgrades and its tuning from the player\'s garage.',
          danger: true,
          requireTyping: 'DELETE',
        })));
  });

  return el('section', { class: 'admin-section' },
    el('h3', {}, `Vehicles (${cars.length})`),
    el('div', { class: 'field-row' },
      el('label', { class: 'field' }, el('span', {}, 'Vehicle to give'), carSelect),
      giveBtn),
    cars.length
      ? el('div', { class: 'admin-table' }, ...rows)
      : el('div', { class: 'muted' }, 'This player owns no vehicles.'));
}

function inspectVehicle(c) {
  const base = getCar(c.car_id);
  const upgrades = c.player_upgrades || [];
  const tuning = (Array.isArray(c.player_tuning) ? c.player_tuning[0] : c.player_tuning)?.tuning;
  modal({
    title: `Inspect — ${base?.name || c.car_id}`,
    wide: true,
    body: el('div', { class: 'details-grid' },
      el('div', {},
        el('h3', {}, 'Condition'),
        row('Engine', `${Number(c.engine_health).toFixed(1)}%`),
        row('Transmission', `${Number(c.transmission_health).toFixed(1)}%`),
        row('Clutch', `${Number(c.clutch_health).toFixed(1)}%`),
        row('Tires', `${Number(c.tire_health).toFixed(1)}%`),
        row('Odometer', `${(Number(c.odometer_m || 0) / 1609.34).toFixed(1)} mi`),
        row('Acquired', relativeTime(c.acquired_at))),
      el('div', {},
        el('h3', {}, 'Upgrades'),
        upgrades.length
          ? upgrades.map((u) => row(u.slot, `Level ${u.level}`))
          : el('div', { class: 'muted' }, 'Stock.')),
      el('div', {},
        el('h3', {}, 'Tuning'),
        tuning
          ? Object.entries(tuning).map(([k, v]) => row(k, Array.isArray(v) ? v.join(' / ') : String(v)))
          : el('div', { class: 'muted' }, 'Default tune.')),
      el('div', {},
        el('h3', {}, 'Best times'),
        row('1/4 ET', c.best_et_quarter ? etText(c.best_et_quarter) : '—'),
        row('1/4 MPH', c.best_mph_quarter ? mphText(c.best_mph_quarter) : '—'),
        row('1/8 ET', c.best_et_eighth ? etText(c.best_et_eighth) : '—'),
        row('1/8 MPH', c.best_mph_eighth ? mphText(c.best_mph_eighth) : '—'))),
  });
}

function row(l, v) {
  return el('div', { class: 'ts-row' }, el('span', {}, l), el('b', {}, String(v)));
}

/* ------------------------------------------------------------- moderation */

function moderationTools(p) {
  const reason = el('input', { class: 'input', placeholder: 'Reason (recorded in the audit log)' });
  const banBtn = el('button', { class: `btn ${p.banned ? '' : 'danger'}` }, p.banned ? 'Lift suspension' : 'Suspend account');
  guardButton(banBtn, async () => {
    const op = p.banned ? 'UNBAN' : 'BAN';
    const ok = await confirmDialog({
      title: p.banned ? 'Lift suspension' : 'Suspend account',
      message: p.banned
        ? `${p.username || 'This player'} will be able to play again.`
        : `${p.username || 'This player'} will be locked out of the game until the suspension is lifted.`,
      confirmLabel: p.banned ? 'Lift suspension' : 'Suspend',
      danger: !p.banned,
    });
    if (!ok) return;
    await api.admin.moderate(p.id, op, reason.value.trim() || null);
    toastSuccess(p.banned ? 'Suspension lifted.' : 'Account suspended.');
    openPlayer(p.id);
  }, 'Working…');

  const roleRow = admin.perms.roles
    ? (() => {
      const sel = el('select', { class: 'input' },
        ...['PLAYER', 'MODERATOR', 'ADMIN', 'OWNER'].map((r) =>
          el('option', { value: r, selected: r === p.role }, r)));
      const b = el('button', { class: 'btn' }, 'Set role');
      guardButton(b, async () => {
        const ok = await confirmDialog({
          title: 'Change role',
          message: `Set ${p.username || 'this player'}'s role to ${sel.value}. `
            + 'Granting OWNER gives complete control of the game, including your own account.',
          confirmLabel: 'Change role',
          danger: true,
          requireTyping: sel.value === 'OWNER' ? 'OWNER' : null,
        });
        if (!ok) return;
        await api.admin.moderate(p.id, 'SET_ROLE', reason.value.trim() || null, sel.value);
        // moderate() signature: (playerId, operation, reason) — role rides along
        toastSuccess('Role updated.');
        openPlayer(p.id);
      }, 'Working…');
      return el('div', { class: 'field-row' },
        el('label', { class: 'field' }, el('span', {}, 'Role'), sel), b);
    })()
    : null;

  return el('section', { class: 'admin-section' },
    el('h3', {}, 'Moderation'),
    el('label', { class: 'field' }, el('span', {}, 'Reason'), reason),
    el('div', { class: 'op-row' }, banBtn),
    roleRow);
}

/* ---------------------------------------------------------------- economy */

async function renderEconomy(host) {
  host.appendChild(el('h1', {}, 'Economy'));
  host.appendChild(el('p', { class: 'muted' },
    'Money is stored as integer cents. Every adjustment made here is written to the audit log with your user ID.'));
  const panel = el('div', { class: 'admin-panel' }, el('div', { class: 'muted' }, 'Loading…'));
  host.appendChild(panel);
  try {
    const res = await api.admin.dashboard();
    const d = res.data;
    clear(panel);
    panel.appendChild(el('div', { class: 'admin-cards' },
      el('div', { class: 'admin-card' }, el('b', {}, fmtMoney(d.totalMoneyCents)), el('span', {}, 'Total in circulation')),
      el('div', { class: 'admin-card' }, el('b', {}, fmtMoney(d.averageMoneyCents)), el('span', {}, 'Average balance')),
      el('div', { class: 'admin-card' }, el('b', {}, fmtMoney(d.payoutsLast7dCents)), el('span', {}, 'Race payouts (7 days)')),
      el('div', { class: 'admin-card' }, el('b', {}, fmtMoney(d.adminIssuedCents)), el('span', {}, 'Issued by admins (all time)'))));
    panel.appendChild(el('h2', {}, 'Wealthiest accounts'));
    panel.appendChild(el('div', { class: 'admin-table' },
      el('div', { class: 'at-row at-head' }, el('span', {}, 'Driver'), el('span', {}, 'Balance'), el('span', {}, 'Races'), el('span', {}, '')),
      ...(d.topBalances || []).map((p) => el('div', { class: 'at-row' },
        el('span', {}, p.username || '—'),
        el('span', {}, fmtMoney(p.money_cents)),
        el('span', {}, String(p.races ?? 0)),
        el('button', { class: 'btn small', onclick: () => { show('players'); setTimeout(() => openPlayer(p.id), 60); } }, 'Manage')))));
  } catch (err) {
    clear(panel);
    panel.appendChild(el('div', { class: 'error-text' }, err.message));
  }
}

/* ---------------------------------------------------------------- vehicles */

function renderVehicles(host) {
  host.appendChild(el('h1', {}, 'Vehicles'));
  host.appendChild(el('p', { class: 'muted' },
    'Find a player first, then use the vehicle tools on their account.'));
  renderPlayers(host);
}

/* ------------------------------------------------------------------ races */

async function renderRaces(host) {
  host.appendChild(el('h1', {}, 'Race Results'));
  const panel = el('div', { class: 'admin-panel' }, el('div', { class: 'muted' }, 'Loading…'));
  host.appendChild(panel);
  try {
    const res = await api.admin.raceResults({ limit: 100 });
    clear(panel);
    panel.appendChild(res.data.length ? raceTable(res.data, true) : el('div', { class: 'muted' }, 'No races yet.'));
  } catch (err) {
    clear(panel);
    panel.appendChild(el('div', { class: 'error-text' }, err.message));
  }
}

function raceTable(rows, showPlayer = false) {
  return el('div', { class: 'admin-table' },
    el('div', { class: 'at-row at-head' },
      showPlayer ? el('span', {}, 'Driver') : null,
      el('span', {}, 'When'), el('span', {}, 'Vehicle'), el('span', {}, 'Mode'),
      el('span', {}, 'Dist'), el('span', {}, 'ET'), el('span', {}, 'MPH'),
      el('span', {}, 'Result'), el('span', {}, 'Payout')),
    ...rows.map((r) => el('div', { class: `at-row${r.valid === false ? ' flagged' : ''}` },
      showPlayer ? el('span', {}, r.username || r.player_id?.slice(0, 8)) : null,
      el('span', { class: 'muted' }, relativeTime(r.created_at)),
      el('span', {}, getCar(r.car_id)?.name || r.car_id),
      el('span', { class: 'muted' }, r.mode),
      el('span', {}, `${r.distance_ft}`),
      el('span', {}, r.et == null ? '—' : etText(r.et)),
      el('span', {}, r.trap_mph == null ? '—' : mphText(r.trap_mph)),
      el('span', { class: `res ${r.result}` }, (r.result || '—').toUpperCase()),
      el('span', {}, fmtMoney(r.payout_cents || 0)))));
}

/* -------------------------------------------------------------- audit log */

async function renderAudit(host) {
  host.appendChild(el('h1', {}, 'Audit Log'));
  host.appendChild(el('p', { class: 'muted' },
    'Every privileged action is recorded here by the server. These records cannot be edited or deleted from this panel.'));
  const panel = el('div', { class: 'admin-panel' }, el('div', { class: 'muted' }, 'Loading…'));
  host.appendChild(panel);
  try {
    const res = await api.admin.auditLog({ limit: 200 });
    clear(panel);
    panel.appendChild(res.data.length ? auditTable(res.data) : el('div', { class: 'muted' }, 'No entries yet.'));
  } catch (err) {
    clear(panel);
    panel.appendChild(el('div', { class: 'error-text' }, err.message));
  }
}

function auditTable(rows) {
  return el('div', { class: 'admin-table audit' },
    el('div', { class: 'at-row at-head' },
      el('span', {}, 'When'), el('span', {}, 'Admin'), el('span', {}, 'Action'),
      el('span', {}, 'Target'), el('span', {}, 'Amount'), el('span', {}, 'Detail'), el('span', {}, 'Reason')),
    ...rows.map((a) => el('div', { class: 'at-row' },
      el('span', { class: 'muted' }, relativeTime(a.created_at)),
      el('span', {}, a.admin_username || a.admin_id?.slice(0, 8) || '—'),
      el('span', { class: 'action-badge' }, a.action_type),
      el('span', {}, a.target_username || a.target_player_id?.slice(0, 8) || '—'),
      el('span', {}, a.amount_cents == null ? '—' : fmtMoney(a.amount_cents)),
      el('span', { class: 'muted' }, a.car_id ? (getCar(a.car_id)?.name || a.car_id) : (a.metadata?.detail || '')),
      el('span', { class: 'muted' }, a.reason || ''))));
}

boot().catch((err) => {
  hideLoading();
  console.error(err);
  fatal(err.message || 'The admin panel failed to load.');
});
