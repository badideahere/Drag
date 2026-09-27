// js/ui/profile.js

import { requireAuth, logout, updatePassword } from '../net/auth.js';
import * as api from '../net/api.js';
import { getCar } from '../data/cars.js';
import {
  el, $, clear, showLoading, hideLoading, renderHeader, toastError, toastSuccess,
  fmtMoney, etText, mphText, relativeTime, modal, guardButton, confirmDialog,
} from './common.js';
import { pageUrl } from '../config.js';
import { fmtTime } from '../sim/util.js';

async function boot() {
  const session = await requireAuth();
  if (!session) return;
  showLoading('Loading profile…');
  let profile, stats, history, garage;
  try {
    [profile, stats, history, garage] = await Promise.all([
      api.getProfile(), api.getStatistics(), api.getRaceHistory(30), api.getGarage(),
    ]);
  } catch (err) {
    hideLoading();
    toastError(err.message);
    return;
  }
  hideLoading();
  renderHeader({ active: 'profile', profile });

  const root = $('#app');
  clear(root);

  const s = stats || {};
  const wins = s.wins || 0, races = s.races || 0;
  const winRate = races ? (wins / races) * 100 : 0;

  root.appendChild(el('div', { class: 'profile-head' },
    el('div', { class: 'avatar big' }, (profile.username || '?').slice(0, 1).toUpperCase()),
    el('div', {},
      el('h1', {}, profile.username || 'Driver'),
      el('p', { class: 'muted' }, `${roleLabel(profile.role)} · joined ${relativeTime(profile.created_at)}`),
      el('p', { class: 'balance' }, fmtMoney(profile.money_cents))),
    el('div', { class: 'profile-actions' },
      el('button', { class: 'btn', onclick: changePassword }, 'Change password'),
      el('button', {
        class: 'btn ghost',
        onclick: async () => { await logout(); location.href = pageUrl('index.html'); },
      }, 'Log out'))));

  root.appendChild(el('div', { class: 'stat-cards' },
    card('Races', races),
    card('Wins', wins),
    card('Losses', s.losses || 0),
    card('Win rate', `${winRate.toFixed(0)}%`),
    card('Vehicles', garage.length),
    card('Career earnings', fmtMoney(s.total_earnings_cents || 0)),
    card('Best 1/4 ET', s.best_et_quarter ? etText(s.best_et_quarter) : '—'),
    card('Best 1/4 MPH', s.best_mph_quarter ? mphText(s.best_mph_quarter) : '—'),
    card('Best 1/8 ET', s.best_et_eighth ? etText(s.best_et_eighth) : '—'),
    card('Best 1/8 MPH', s.best_mph_eighth ? mphText(s.best_mph_eighth) : '—'),
    card('Red lights', s.red_lights || 0),
    card('Distance raced', `${((s.total_distance_m || 0) / 1609.34).toFixed(1)} mi`)));

  root.appendChild(el('section', { class: 'panel' },
    el('h2', {}, 'Recent runs'),
    history.length
      ? el('div', { class: 'history-table' },
        el('div', { class: 'h-row h-head' },
          el('span', {}, 'When'), el('span', {}, 'Vehicle'), el('span', {}, 'Mode'),
          el('span', {}, 'Dist'), el('span', {}, 'RT'), el('span', {}, 'ET'),
          el('span', {}, 'MPH'), el('span', {}, 'Result'), el('span', {}, 'Payout')),
        ...history.map((r) => {
          const car = getCar(r.car_id);
          return el('div', { class: 'h-row' },
            el('span', { class: 'muted' }, relativeTime(r.created_at)),
            el('span', {}, car?.name || r.car_id),
            el('span', { class: 'muted' }, r.mode),
            el('span', {}, `${r.distance_ft} ft`),
            el('span', {}, r.reaction == null ? '—' : fmtTime(r.reaction, 3)),
            el('span', {}, r.et == null ? '—' : etText(r.et)),
            el('span', {}, r.trap_mph == null ? '—' : mphText(r.trap_mph)),
            el('span', { class: `res ${r.result}` }, (r.result || 'none').toUpperCase()),
            el('span', { class: r.payout_cents >= 0 ? 'plus' : 'minus' },
              `${r.payout_cents >= 0 ? '+' : '−'}${fmtMoney(Math.abs(r.payout_cents || 0))}`));
        }))
      : el('div', { class: 'empty' }, 'No races yet.')));
}

function card(label, value) {
  return el('div', { class: 'stat-card' },
    el('b', {}, String(value)),
    el('span', {}, label));
}

function roleLabel(role) {
  return { PLAYER: 'Driver', MODERATOR: 'Moderator', ADMIN: 'Administrator', OWNER: 'Owner' }[role] || 'Driver';
}

function changePassword() {
  const pw = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const pw2 = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  modal({
    title: 'Change password',
    body: el('div', {},
      el('label', { class: 'field' }, el('span', {}, 'New password'), pw),
      el('label', { class: 'field' }, el('span', {}, 'Confirm new password'), pw2)),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Update password',
        kind: 'primary',
        busyLabel: 'Updating…',
        onClick: async () => {
          if (pw.value.length < 6) { toastError('Password must be at least 6 characters.'); return true; }
          if (pw.value !== pw2.value) { toastError('Passwords do not match.'); return true; }
          await updatePassword(pw.value);
          toastSuccess('Password updated.');
          return false;
        },
      },
    ],
  });
}

boot().catch((err) => {
  hideLoading();
  toastError(err.message || 'Could not load your profile.');
});
