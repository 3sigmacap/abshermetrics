import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const txt = fs.readFileSync('.env', 'utf8');
const env = {};
for (const l of txt.split('\n')) {
  if (!l.includes('=') || l.trim().startsWith('#')) continue;
  const i = l.indexOf('=');
  env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
}
const captured = {};
const storage = {
  getItem: async (k) => captured[k] ?? null,
  setItem: async (k, v) => { captured[k] = v; },
  removeItem: async (k) => { delete captured[k]; },
};
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
});
const { error } = await sb.auth.signInWithPassword({ email: 'demo@abshermetrics.com', password: 'AbsherDemo2026!' });
if (error) { console.log('ERR', error.message); process.exit(1); }
await new Promise((r) => setTimeout(r, 400));

const DIR = process.env.ASYNC_DIR;
fs.mkdirSync(DIR, { recursive: true });
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const manifest = {};
for (const [k, v] of Object.entries(captured)) {
  manifest[k] = null;
  fs.writeFileSync(path.join(DIR, md5(k)), v);
}
const route = process.env.SHOT_ROUTE;
if (route) manifest['__shotRoute'] = route;
fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(manifest));
console.log('injected session + __shotRoute=' + route);
