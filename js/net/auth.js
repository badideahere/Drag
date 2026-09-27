// js/net/auth.js
// Account handling. There is no custom password code anywhere in this project:
// registration, login, sessions and password resets are all Supabase Auth.

import { db, supabase, configError } from './supabase.js';
import { CONFIG, pageUrl } from '../config.js';

export async function register(email, password, username) {
  const { data, error } = await db().auth.signUp({
    email,
    password,
    options: {
      data: { username: (username || '').trim().slice(0, 24) },
      emailRedirectTo: `${CONFIG.SITE_ORIGIN}/login.html`,
    },
  });
  if (error) throw friendly(error);
  return data;
}

export async function login(email, password) {
  const { data, error } = await db().auth.signInWithPassword({ email, password });
  if (error) throw friendly(error);
  return data;
}

export async function logout() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function sendPasswordReset(email) {
  const { error } = await db().auth.resetPasswordForEmail(email, {
    redirectTo: `${CONFIG.SITE_ORIGIN}/login.html?reset=1`,
  });
  if (error) throw friendly(error);
}

export async function updatePassword(newPassword) {
  const { error } = await db().auth.updateUser({ password: newPassword });
  if (error) throw friendly(error);
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export async function getUser() {
  const s = await getSession();
  return s?.user || null;
}

export function onAuthChange(cb) {
  if (!supabase) return { unsubscribe() {} };
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
  return data.subscription;
}

/**
 * Guard for pages that need a logged-in player. Redirects to login.html and
 * remembers where the player was trying to go.
 */
export async function requireAuth() {
  if (configError) {
    document.body.innerHTML = `<div class="fatal"><h1>Setup needed</h1><p>${configError}</p></div>`;
    throw new Error(configError);
  }
  const session = await getSession();
  if (!session) {
    const back = encodeURIComponent(location.pathname.split('/').pop() + location.search);
    location.replace(pageUrl(`login.html?next=${back}`));
    return null;
  }
  return session;
}

function friendly(error) {
  const m = (error.message || '').toLowerCase();
  if (m.includes('invalid login')) return new Error('That email and password combination was not recognised.');
  if (m.includes('already registered') || m.includes('already been registered')) {
    return new Error('An account already exists with that email address.');
  }
  if (m.includes('password should be')) return new Error('Password must be at least 6 characters long.');
  if (m.includes('email rate') || m.includes('rate limit')) {
    return new Error('Too many attempts. Please wait a minute and try again.');
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return new Error('Unable to connect to the server. Check your internet connection.');
  }
  return new Error(error.message || 'Something went wrong. Please try again.');
}
