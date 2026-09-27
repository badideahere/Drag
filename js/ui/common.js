// js/ui/common.js
// Shared DOM helpers used by every page.

import { fmtMoney } from '../sim/util.js';
import { logout } from '../net/auth.js';
import { pageUrl, CONFIG } from '../config.js';

/* ------------------------------------------------------------------- DOM */

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return n;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export { fmtMoney };

/* ----------------------------------------------------------------- toasts */

let toastHost = null;

export function toast(message, kind = 'info', ms = 3800) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host' });
    document.body.appendChild(toastHost);
  }
  const t = el('div', { class: `toast toast-${kind}` }, message);
  toastHost.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const kill = () => {
    t.classList.remove('in');
    setTimeout(() => t.remove(), 260);
  };
  const timer = setTimeout(kill, ms);
  t.addEventListener('click', () => { clearTimeout(timer); kill(); });
  return t;
}

export const toastError = (m) => toast(m, 'error', 5200);
export const toastSuccess = (m) => toast(m, 'success');

/* ---------------------------------------------------------------- loading */

export function showLoading(message = 'Loading…') {
  let overlay = $('#loading-overlay');
  if (!overlay) {
    overlay = el('div', { id: 'loading-overlay', class: 'loading-overlay' },
      el('div', { class: 'loading-box' },
        el('div', { class: 'spinner' }),
        el('div', { class: 'loading-text' }, message)));
    document.body.appendChild(overlay);
  } else {
    $('.loading-text', overlay).textContent = message;
    overlay.style.display = '';
  }
  overlay.classList.add('visible');
  return {
    update(m) { const t = $('.loading-text', overlay); if (t) t.textContent = m; },
    close() { hideLoading(); },
  };
}

export function hideLoading() {
  const overlay = $('#loading-overlay');
  if (overlay) overlay.classList.remove('visible');
}

/**
 * Wraps an async action so the button cannot be double-clicked and shows a
 * working state. Required for every purchase and admin button.
 */
export function guardButton(button, fn, busyLabel = 'Working…') {
  if (!button) return;
  if (button.dataset.guarded === '1') return;
  button.dataset.guarded = '1';
  button.addEventListener('click', async (ev) => {
    if (button.disabled || button.dataset.busy === '1') return;
    button.dataset.busy = '1';
    const original = button.textContent;
    button.disabled = true;
    button.classList.add('busy');
    button.textContent = busyLabel;
    try {
      await fn(ev);
    } catch (err) {
      toastError(err?.message || 'Something went wrong.');
    } finally {
      button.dataset.busy = '0';
      button.disabled = false;
      button.classList.remove('busy');
      button.textContent = original;
    }
  });
}

/* ----------------------------------------------------------------- modals */

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const bodyNode = typeof body === 'string' ? el('div', { class: 'modal-body', html: body }) : el('div', { class: 'modal-body' }, body);
  const box = el('div', { class: `modal${wide ? ' modal-wide' : ''}` },
    el('div', { class: 'modal-head' },
      el('h2', {}, title),
      el('button', { class: 'modal-x', 'aria-label': 'Close', onclick: () => close() }, '×')),
    bodyNode,
    el('div', { class: 'modal-actions' },
      ...actions.map((a) => {
        const b = el('button', { class: `btn ${a.kind || ''}` }, a.label);
        if (a.onClick) {
          guardButton(b, async () => {
            const keep = await a.onClick();
            if (!keep) close();
          }, a.busyLabel || 'Working…');
        } else {
          b.addEventListener('click', () => close());
        }
        return b;
      })));
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('in'));

  function close() {
    backdrop.classList.remove('in');
    setTimeout(() => backdrop.remove(), 200);
    onClose?.();
  }
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  const esc = (e) => { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', esc); } };
  window.addEventListener('keydown', esc);
  return { close, node: box, body: bodyNode };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, requireTyping = null }) {
  return new Promise((resolve) => {
    let input = null;
    const body = el('div', {},
      el('p', {}, message),
      requireTyping
        ? el('label', { class: 'field' },
          el('span', {}, `Type ${requireTyping} to confirm`),
          (input = el('input', { type: 'text', autocomplete: 'off' })))
        : null);

    const m = modal({
      title,
      body,
      actions: [
        { label: 'Cancel', onClick: null },
        {
          label: confirmLabel,
          kind: danger ? 'danger' : 'primary',
          onClick: () => {
            if (requireTyping && input.value.trim() !== requireTyping) {
              toastError(`Type ${requireTyping} exactly to confirm.`);
              return true; // keep the dialog open
            }
            resolve(true);
            return false;
          },
        },
      ],
      onClose: () => resolve(false),
    });
    setTimeout(() => input?.focus(), 60);
    return m;
  });
}

/* ----------------------------------------------------------------- header */

/**
 * Site header with the staging-light nav indicator.
 * @param {object} opts { active, profile }
 */
export function renderHeader(opts = {}) {
  const host = $('#site-header');
  if (!host) return;
  const links = [
    { id: 'garage', label: 'Garage', href: 'garage.html' },
    { id: 'dealership', label: 'Dealership', href: 'garage.html#dealership' },
    { id: 'race', label: 'Race', href: 'game.html' },
    { id: 'leaderboard', label: 'Leaderboards', href: 'garage.html#leaderboard' },
    { id: 'profile', label: 'Profile', href: 'profile.html' },
  ];
  clear(host);
  host.appendChild(el('div', { class: 'header-inner' },
    el('a', { class: 'brand', href: pageUrl('garage.html') },
      el('span', { class: 'brand-mark' }),
      el('span', { class: 'brand-name' }, CONFIG.GAME_NAME),
      el('span', { class: 'brand-sub' }, CONFIG.GAME_TAGLINE)),
    el('nav', { class: 'main-nav' },
      ...links.map((l) => el('a', {
        class: `nav-link${opts.active === l.id ? ' active' : ''}`,
        href: pageUrl(l.href),
      }, el('span', { class: 'nav-pip' }), l.label))),
    el('div', { class: 'header-right' },
      opts.profile ? el('div', { class: 'money-chip', id: 'money-chip' },
        el('span', { class: 'money-label' }, 'BALANCE'),
        el('span', { class: 'money-value' }, fmtMoney(opts.profile.money_cents))) : null,
      opts.profile ? el('a', { class: 'user-chip', href: pageUrl('profile.html') },
        el('span', { class: 'avatar' }, (opts.profile.username || '?').slice(0, 1).toUpperCase()),
        el('span', {}, opts.profile.username || 'Driver')) : null,
      opts.profile && ['ADMIN', 'OWNER', 'MODERATOR'].includes(opts.profile.role)
        ? el('a', { class: 'btn ghost small', href: pageUrl('admin.html') }, 'Admin')
        : null,
      el('button', {
        class: 'btn ghost small',
        onclick: async () => { await logout(); location.href = pageUrl('index.html'); },
      }, 'Log out'))));
}

export function updateMoneyChip(cents) {
  const v = $('#money-chip .money-value');
  if (v) {
    v.textContent = fmtMoney(cents);
    v.classList.remove('bump');
    void v.offsetWidth;
    v.classList.add('bump');
  }
}

/* ------------------------------------------------------------- formatting */

export function pct(v) { return `${Math.round(v)}%`; }

export function healthClass(v) {
  if (v >= 85) return 'good';
  if (v >= 60) return 'fair';
  if (v >= 35) return 'poor';
  return 'bad';
}

export function etText(v) {
  return v == null ? '—' : Number(v).toFixed(3);
}

export function mphText(v) {
  return v == null ? '—' : Number(v).toFixed(2);
}

export function relativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const secs = (Date.now() - d.getTime()) / 1000;
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)} d ago`;
  return d.toLocaleDateString();
}
