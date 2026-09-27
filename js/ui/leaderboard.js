// js/ui/leaderboard.js
// Leaderboards are read straight from leaderboard_entries. Players cannot
// insert into that table — rows are written by the submit-race Edge Function
// only, from results it has already validated.

import * as api from '../net/api.js';
import { el, clear, relativeTime, etText, mphText, toastError } from './common.js';
import { CAR_LIST, CLASS_NAMES, CLASS_ORDER } from '../data/cars.js';
import { DRIVING_MODES } from './settings.js';

const CATEGORIES = [
  { id: 'quarter_et', label: '1/4 Mile ET', unit: 's', better: 'lower' },
  { id: 'quarter_mph', label: '1/4 Mile MPH', unit: 'mph', better: 'higher' },
  { id: 'eighth_et', label: '1/8 Mile ET', unit: 's', better: 'lower' },
  { id: 'eighth_mph', label: '1/8 Mile MPH', unit: 'mph', better: 'higher' },
];

export function renderLeaderboards(container, ctx = {}) {
  clear(container);

  let category = CATEGORIES[0].id;
  let carId = '';
  let drivingMode = '';

  const tabs = el('div', { class: 'lb-tabs' },
    ...CATEGORIES.map((c) => el('button', {
      class: `lb-tab${c.id === category ? ' active' : ''}`,
      dataset: { id: c.id },
      onclick: (e) => {
        category = c.id;
        container.querySelectorAll('.lb-tab').forEach((b) => b.classList.toggle('active', b.dataset.id === category));
        load();
      },
    }, c.label)));

  const carFilter = el('select', { class: 'input small', onchange: (e) => { carId = e.target.value; load(); } },
    el('option', { value: '' }, 'All vehicles'),
    ...CLASS_ORDER.flatMap((cls) => CAR_LIST.filter((c) => c.class === cls)
      .map((c) => el('option', { value: c.id }, `${c.name} (${cls})`))));

  const modeFilter = el('select', { class: 'input small', onchange: (e) => { drivingMode = e.target.value; load(); } },
    el('option', { value: '' }, 'All driving modes'),
    ...Object.values(DRIVING_MODES).map((m) => el('option', { value: m.id }, m.name)));

  const body = el('div', { class: 'lb-body' }, el('div', { class: 'muted' }, 'Loading…'));

  container.appendChild(el('div', { class: 'lb' },
    el('div', { class: 'lb-head' },
      el('h2', {}, 'Leaderboards'),
      el('div', { class: 'lb-filters' }, carFilter, modeFilter)),
    tabs,
    body));

  async function load() {
    clear(body);
    body.appendChild(el('div', { class: 'muted' }, 'Loading…'));
    try {
      const rows = await api.getLeaderboard(category, {
        carId: carId || undefined,
        drivingMode: drivingMode || undefined,
        limit: 50,
      });
      clear(body);
      if (!rows.length) {
        body.appendChild(el('div', { class: 'empty' }, 'No times recorded yet. Be the first.'));
        return;
      }
      const cat = CATEGORIES.find((c) => c.id === category);
      const table = el('div', { class: 'lb-table' },
        el('div', { class: 'lb-row lb-header' },
          el('span', {}, '#'), el('span', {}, 'Driver'), el('span', {}, 'Vehicle'),
          el('span', {}, 'Mode'), el('span', {}, cat.label), el('span', {}, 'When')));
      rows.forEach((r, i) => {
        const mine = ctx.playerId && r.player_id === ctx.playerId;
        table.appendChild(el('div', { class: `lb-row${mine ? ' mine' : ''}` },
          el('span', { class: 'lb-rank' }, String(i + 1)),
          el('span', {}, r.username || 'Driver'),
          el('span', {}, r.car_name || r.car_id),
          el('span', { class: 'muted' }, r.driving_mode || '—'),
          el('b', {}, cat.unit === 's' ? etText(r.value) : mphText(r.value)),
          el('span', { class: 'muted' }, relativeTime(r.created_at))));
      });
      body.appendChild(table);
    } catch (err) {
      clear(body);
      body.appendChild(el('div', { class: 'error-text' }, err.message));
    }
  }

  load();
}
