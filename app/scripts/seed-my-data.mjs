#!/usr/bin/env node
/**
 * One-time seed: load your historical raw-shots.json into YOUR Supabase account.
 *
 * Run from the app/ directory so @supabase/supabase-js resolves:
 *
 *   cd app
 *   SEED_EMAIL=you@example.com SEED_PASSWORD=yourpassword node scripts/seed-my-data.mjs
 *
 * Re-running is blocked if your account already has shots (pass FORCE=1 to override
 * and ADD them again). Uses your login (not the secret key); RLS keeps it scoped to you.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // app/scripts
const appDir = path.resolve(here, '..'); // app
const repoRoot = path.resolve(appDir, '..'); // repo root

function readEnv() {
  const txt = fs.readFileSync(path.join(appDir, '.env'), 'utf8');
  const env = {};
  for (const line of txt.split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

const env = readEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.SEED_EMAIL;
const PASSWORD = process.env.SEED_PASSWORD;

if (!URL || !KEY) {
  console.error('Missing Supabase keys in app/.env'); process.exit(1);
}
if (!EMAIL || !PASSWORD) {
  console.error('Set SEED_EMAIL and SEED_PASSWORD env vars (your app login).'); process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

async function main() {
  const { data: auth, error: ae } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (ae || !auth.session) { console.error('Sign-in failed:', ae?.message); process.exit(1); }
  const userId = auth.user.id;
  console.log('Signed in as', EMAIL);

  const { count } = await sb.from('shots').select('id', { count: 'exact', head: true });
  if (count && count > 0 && !process.env.FORCE) {
    console.error(`Your account already has ${count} shots. Re-run with FORCE=1 to add anyway.`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, 'raw-shots.json'), 'utf8'));
  const sessions = raw.sessions ?? [];
  const shots = raw.shots ?? [];

  // create a session row per source session, map old id -> new id
  const idMap = {};
  for (const s of sessions) {
    const { data, error } = await sb
      .from('sessions')
      .insert({ user_id: userId, label: s.label, date: s.date || null })
      .select('id')
      .single();
    if (error) { console.error('session insert failed:', error.message); process.exit(1); }
    idMap[s.id] = data.id;
  }
  console.log(`Created ${sessions.length} sessions.`);

  const rows = shots.map((s) => ({
    user_id: userId,
    session_id: idMap[s.session] ?? null,
    club: s.club,
    ts: s.ts ?? null,
    bs: s.bs ?? null, la: s.la ?? null, ld: s.ld ?? null,
    bspin: s.bspin ?? null, sspin: s.sspin ?? null, spin: s.spin ?? null,
    axis: s.axis ?? null, apex: s.apex ?? null, carry: s.carry ?? null,
    total: s.total ?? null, dev: s.dev ?? null,
    excluded: Boolean(s.excluded),
  }));

  let inserted = 0;
  for (const part of chunk(rows, 500)) {
    const { error } = await sb.from('shots').insert(part);
    if (error) { console.error('shots insert failed:', error.message); process.exit(1); }
    inserted += part.length;
    console.log(`  inserted ${inserted}/${rows.length} shots…`);
  }
  console.log(`\nDone. Seeded ${rows.length} shots across ${sessions.length} sessions into your account.`);
  await sb.auth.signOut();
}

main().catch((e) => { console.error(e); process.exit(1); });
