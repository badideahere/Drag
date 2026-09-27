// js/ui/upgrades.js
// The upgrade shop. Every card shows what the upgrade does to the *simulated*
// car, computed by building a second spec with that upgrade fitted and running
// the real engine model over it. Nothing here is a made-up marketing number.

import { UPGRADES, UPGRADE_CATEGORIES, getUpgradeLevel, upgradeAvailability } from '../data/upgrades.js';
import { getCar } from '../data/cars.js';
import { buildVehicleSpec, specSummary } from '../sim/build.js';
import { el, fmtMoney, guardButton, toastError, toastSuccess, confirmDialog } from './common.js';
import * as api from '../net/api.js';

/**
 * @param {object} ctx {
 *   playerCar, money, onPurchased(result), container
 * }
 */
export function renderUpgradeShop(container, ctx) {
  container.replaceChildren();
  const pc = ctx.playerCar;
  const stockAspiration = getCar(pc.carId).engine.aspiration;

  const baseSpec = buildVehicleSpec(pc.carId, { upgrades: pc.upgrades, tuning: pc.tuning });
  const baseSummary = specSummary(baseSpec);

  container.appendChild(el('div', { class: 'shop-head' },
    el('h2', {}, 'Upgrades'),
    el('div', { class: 'shop-current' },
      el('span', {}, `${Math.round(baseSummary.peakHp)} hp`),
      el('span', {}, `${Math.round(baseSummary.peakTorqueLbFt)} lb-ft`),
      el('span', {}, `${Math.round(baseSummary.massLb)} lb`),
      el('span', {}, `${baseSummary.powerToWeight.toFixed(0)} hp/t`))));

  for (const category of UPGRADE_CATEGORIES) {
    const slots = Object.values(UPGRADES).filter((u) => u.category === category);
    if (!slots.length) continue;
    const grid = el('div', { class: 'upgrade-grid' });
    for (const slot of slots) grid.appendChild(slotCard(slot, ctx, baseSpec, baseSummary, stockAspiration));
    container.appendChild(el('section', { class: 'shop-section' },
      el('h3', { class: 'section-title' }, category), grid));
  }
}

function slotCard(slot, ctx, baseSpec, baseSummary, stockAspiration) {
  const pc = ctx.playerCar;
  const owned = pc.upgrades[slot.id] || 0;
  const maxLevel = slot.levels[slot.levels.length - 1].level;
  const next = slot.levels.find((l) => l.level === owned + 1);

  const card = el('div', { class: `upgrade-card${owned ? ' owned' : ''}` });
  card.appendChild(el('div', { class: 'uc-head' },
    el('h4', {}, slot.name),
    el('span', { class: 'uc-level' }, owned ? `LV ${owned}/${maxLevel}` : `0/${maxLevel}`)));
  card.appendChild(el('p', { class: 'uc-blurb' }, slot.blurb));

  // Ladder of levels
  const ladder = el('div', { class: 'uc-ladder' },
    ...slot.levels.map((l) => el('div', {
      class: `uc-pip${l.level <= owned ? ' on' : ''}${l.level === owned + 1 ? ' next' : ''}`,
      title: l.name,
    })));
  card.appendChild(ladder);

  if (!next) {
    card.appendChild(el('div', { class: 'uc-max' }, 'Fully upgraded'));
    return card;
  }

  const avail = upgradeAvailability(stockAspiration, pc.upgrades, slot.id);
  if (!avail.ok) {
    card.appendChild(el('div', { class: 'uc-blocked' }, avail.reason));
    return card;
  }

  // Simulate the car WITH this upgrade to show an honest delta.
  const previewSpec = buildVehicleSpec(pc.carId, {
    upgrades: { ...pc.upgrades, [slot.id]: next.level },
    tuning: pc.tuning,
  });
  const preview = specSummary(previewSpec);

  const deltas = [
    ['Power', preview.peakHp - baseSummary.peakHp, 'hp', 0],
    ['Torque', preview.peakTorqueLbFt - baseSummary.peakTorqueLbFt, 'lb-ft', 0],
    ['Weight', preview.massLb - baseSummary.massLb, 'lb', 0, true],
    ['Boost', preview.boostPsi - baseSummary.boostPsi, 'psi', 1],
  ].filter(([, d]) => Math.abs(d) > 0.05);

  const changes = [];
  if (preview.tireCompound !== baseSummary.tireCompound) {
    changes.push(`Tires → ${preview.tireCompound.replace('_', ' ')}`);
  }
  if (preview.clutchType !== baseSummary.clutchType) changes.push(`Clutch → ${preview.clutchType}`);
  if (preview.diffType !== baseSummary.diffType) changes.push(`Diff → ${preview.diffType}`);
  if (preview.gearCount !== baseSummary.gearCount) changes.push(`${preview.gearCount}-speed gearbox`);
  if (previewSpec.engine.aspiration !== baseSpec.engine.aspiration) {
    changes.push(`Now ${previewSpec.engine.aspiration}`);
  }
  if (previewSpec.engine.maxSafeRpm !== baseSpec.engine.maxSafeRpm) {
    changes.push(`Safe rpm → ${previewSpec.engine.maxSafeRpm}`);
  }

  card.appendChild(el('div', { class: 'uc-next' },
    el('div', { class: 'uc-next-name' }, next.name),
    el('div', { class: 'uc-deltas' },
      ...deltas.map(([label, d, unit, places, lowerBetter]) => {
        const good = lowerBetter ? d < 0 : d > 0;
        return el('div', { class: `uc-delta ${good ? 'good' : 'bad'}` },
          el('span', {}, label),
          el('b', {}, `${d > 0 ? '+' : ''}${d.toFixed(places)} ${unit}`));
      }),
      ...changes.map((c) => el('div', { class: 'uc-delta note' }, el('span', {}, c))))));

  const affordable = ctx.money >= next.priceCents;
  const btn = el('button', {
    class: `btn ${affordable ? 'primary' : ''} small`,
    disabled: !affordable,
  }, `Fit — ${fmtMoney(next.priceCents)}`);

  guardButton(btn, async () => {
    const ok = await confirmDialog({
      title: `Fit ${next.name}?`,
      message: `This will cost ${fmtMoney(next.priceCents)} and is permanent. Parts cannot be sold back.`,
      confirmLabel: 'Fit part',
    });
    if (!ok) return;
    const res = await api.buyUpgrade(pc.id, slot.id, next.level);
    toastSuccess(`${next.name} fitted.`);
    ctx.onPurchased?.(res);
  }, 'Fitting…');

  card.appendChild(el('div', { class: 'uc-foot' },
    btn,
    !affordable ? el('span', { class: 'uc-short' }, `Short ${fmtMoney(next.priceCents - ctx.money)}`) : null));

  return card;
}
