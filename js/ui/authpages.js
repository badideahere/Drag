// js/ui/authpages.js
// Shared logic for login.html and register.html.

import { register, login, sendPasswordReset, getSession, updatePassword } from '../net/auth.js';
import { configError } from '../net/supabase.js';
import { $, el, toastError, toastSuccess, toast } from './common.js';
import { pageUrl, CONFIG } from '../config.js';

function nextTarget() {
  const next = new URLSearchParams(location.search).get('next');
  if (!next) return 'garage.html';
  // Only allow same-site relative targets.
  if (/^[a-z0-9_-]+\.html(\?.*)?$/i.test(next)) return next;
  return 'garage.html';
}

function setBusy(form, busy, label) {
  const btn = form.querySelector('button[type=submit]');
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.label || btn.textContent;
  }
}

function showError(form, message) {
  let box = form.querySelector('.form-error');
  if (!box) {
    box = el('div', { class: 'form-error' });
    form.prepend(box);
  }
  box.textContent = message;
  box.hidden = !message;
}

export async function initLogin() {
  if (configError) {
    $('#config-warning').textContent = configError;
    $('#config-warning').hidden = false;
    return;
  }

  // Password-reset links land here with a recovery session attached.
  const params = new URLSearchParams(location.search);
  const session = await getSession();
  if (session && (params.has('reset') || location.hash.includes('type=recovery'))) {
    showResetForm();
    return;
  }
  if (session) { location.replace(pageUrl(nextTarget())); return; }

  const form = $('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    setBusy(form, true, 'Signing in…');
    try {
      await login($('#email').value.trim(), $('#password').value);
      location.href = pageUrl(nextTarget());
    } catch (err) {
      showError(form, err.message);
      setBusy(form, false);
    }
  });

  $('#forgot-link').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim();
    if (!email) { toastError('Enter your email address first.'); return; }
    try {
      await sendPasswordReset(email);
      toastSuccess('Password reset email sent. Check your inbox.');
    } catch (err) {
      toastError(err.message);
    }
  });
}

function showResetForm() {
  const host = $('#auth-card');
  host.replaceChildren(
    el('h1', {}, 'Set a new password'),
    el('p', { class: 'muted' }, 'Enter a new password for your account.'),
    el('form', {
      class: 'auth-form',
      onsubmit: async (e) => {
        e.preventDefault();
        const pw = $('#new-password').value;
        if (pw.length < 6) { toastError('Password must be at least 6 characters.'); return; }
        try {
          await updatePassword(pw);
          toastSuccess('Password updated. You are signed in.');
          setTimeout(() => location.href = pageUrl('garage.html'), 900);
        } catch (err) {
          toastError(err.message);
        }
      },
    },
      el('label', { class: 'field' }, el('span', {}, 'New password'),
        el('input', { class: 'input', id: 'new-password', type: 'password', required: true, minlength: 6 })),
      el('button', { class: 'btn primary large', type: 'submit' }, 'Update password')));
}

export async function initRegister() {
  if (configError) {
    $('#config-warning').textContent = configError;
    $('#config-warning').hidden = false;
    return;
  }
  const session = await getSession();
  if (session) { location.replace(pageUrl('garage.html')); return; }

  const form = $('#register-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    const username = $('#username').value.trim();
    const email = $('#email').value.trim();
    const pw = $('#password').value;
    const pw2 = $('#password2').value;

    if (username.length < 3) { showError(form, 'Pick a driver name of at least 3 characters.'); return; }
    if (!/^[A-Za-z0-9 _-]+$/.test(username)) { showError(form, 'Driver names can use letters, numbers, spaces, - and _ only.'); return; }
    if (pw.length < 6) { showError(form, 'Password must be at least 6 characters.'); return; }
    if (pw !== pw2) { showError(form, 'Passwords do not match.'); return; }

    setBusy(form, true, 'Creating account…');
    try {
      const data = await register(email, pw, username);
      if (data.session) {
        toastSuccess('Account created. Welcome.');
        location.href = pageUrl('garage.html');
      } else {
        // Email confirmation is switched on in this project.
        $('#auth-card').replaceChildren(
          el('h1', {}, 'Check your email'),
          el('p', {}, `We sent a confirmation link to ${email}. Click it, then come back and sign in.`),
          el('a', { class: 'btn primary', href: pageUrl('login.html') }, 'Go to sign in'));
      }
    } catch (err) {
      showError(form, err.message);
      setBusy(form, false);
    }
  });
}
