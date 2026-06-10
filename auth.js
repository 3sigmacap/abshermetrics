// auth.js — shared Supabase auth client for the AbsherMetrics web app.
//
// The publishable (anon) key below is SAFE to embed in client JS: Row-Level
// Security protects every row, and this exact key already ships inside the
// public mobile app bundle. The SECRET / service_role key must never appear here.
//
// One shared backend, three frontends (web · iOS · Android). This module gives
// the web app the same auth the mobile apps use, so an account works everywhere.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://uzqtotiilluwktewdlmr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PREvGVJ6YSjm0eMGtyhD3A_91EUk2xc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Web: handle email-confirm / magic-link tokens that arrive in the URL.
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: 'am-auth',
  },
});

/** Current session (from localStorage; no network unless a refresh is due). */
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Gate a protected page. If signed out, redirect to login (remembering where we
 * were) and return null. If signed in, return the session.
 */
export async function guard() {
  const session = await getSession();
  if (!session) {
    const here = location.pathname.split('/').pop() || 'index.html';
    location.replace('login.html?next=' + encodeURIComponent(here + location.search));
    return null;
  }
  return session;
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({
    email: String(email).trim(),
    password,
  });
  return { error: error?.message };
}

export async function signUp(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email: String(email).trim(),
    password,
    options: { data: { display_name: (displayName || '').trim() } },
  });
  // With email confirmation OFF, signUp returns a live session immediately.
  // If it's ON, session is null and the user must confirm via email first.
  return { error: error?.message, needsConfirm: !error && !data.session };
}

export async function signOut() {
  await supabase.auth.signOut();
  location.replace('login.html');
}

/** Display name from user metadata, falling back to the email's local part. */
export function displayNameOf(session) {
  const u = session?.user;
  if (!u) return '';
  const meta = u.user_metadata?.display_name;
  if (meta && meta.trim()) return meta.trim();
  return (u.email || '').split('@')[0];
}
