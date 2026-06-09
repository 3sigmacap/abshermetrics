#!/usr/bin/env node
/**
 * Sync shared web-app artifacts into the native app.
 *
 * The repo root is the SINGLE EDITABLE SOURCE OF TRUTH for the physics engine
 * and the datasets. The native app, however, needs them physically inside its
 * own project tree so Metro bundles them reliably (Metro doesn't crawl the
 * parent folder into its file map, and that also keeps EAS cloud builds simple).
 *
 * This copies the canonical files from `../` into `src/shared/` (a generated,
 * git-ignored folder). Re-run after editing flight-engine.js or regenerating
 * shots.json. It runs automatically before start/ios/android/web/export via the
 * package.json "pre" scripts and on `npm install` (postinstall).
 */
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '..');
const outDir = path.join(appRoot, 'src', 'shared');

const FILES = ['flight-engine.js', 'shots.json', 'raw-shots.json'];

fs.mkdirSync(outDir, { recursive: true });

const BANNER =
  '// AUTO-GENERATED COPY — do not edit. Source of truth: <repo-root>/flight-engine.js\n' +
  '// Regenerate with `npm run sync-shared` (runs automatically before start/build).\n';

let copied = 0;
for (const name of FILES) {
  const src = path.join(repoRoot, name);
  if (!fs.existsSync(src)) {
    console.warn(`[sync-shared] WARNING: ${name} not found at repo root — skipping.`);
    continue;
  }
  const dest = path.join(outDir, name);
  if (name.endsWith('.js')) {
    fs.writeFileSync(dest, BANNER + fs.readFileSync(src, 'utf8'));
  } else {
    fs.copyFileSync(src, dest); // JSON must stay valid JSON — no banner
  }
  copied++;
}
console.log(`[sync-shared] copied ${copied}/${FILES.length} shared file(s) into src/shared/`);
