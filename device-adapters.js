// device-adapters.js — SHARED (repo root, single source of truth).
//
// Launch-monitor file parsers. The web app imports this directly; the native app gets
// a byte-identical copy synced into app/src/shared/ (see app/scripts/sync-shared.js),
// exactly like flight-engine.js — so the two platforms can NEVER drift.
//
// A device "adapter" knows how to (a) DETECT its own export format and (b) PARSE it
// into a list of normalized shots. The app + physics engine consume BALL DATA ONLY
// (ball speed, launch, spin); carry/total/apex/trajectory are computed by the engine,
// never taken from the file. Club-head / impact metrics are stored when a device
// reports them, for display/analysis only. Every shot is tagged with its device slug.
//
// To add a device: write one adapter (detect + parse) and register it in ADAPTERS.

export const MAX_ROWS = 10_000; // per file (abuse guard; mirrors the prior importer)
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — enforced in parseDeviceFile so
// it can't be bypassed by a picker that reports no file size (web + both mobile callers).

// Sign convention: the physics engine treats POSITIVE lateral = RIGHT of target
// (flight-engine.js). The R50 stores signed values that already follow this (negative
// = left). Devices that label direction with L/R map LEFT → negative, RIGHT → positive.
// If real-world testing ever shows a device is reversed, flip this one constant.
const LEFT_SIGN = -1;

// ── value parsers ────────────────────────────────────────────────────────────
// Tolerant numeric parse: handles plain numbers ("9424", "-2.5"), and values with a
// trailing L/R direction ("5.4 L", "51 R") → signed per LEFT_SIGN. Returns undefined
// for blanks / non-numbers. Rounded to 2 dp to match the prior importer.
function val(raw) {
  if (raw == null) return undefined;
  let s = String(raw).trim();
  if (!s) return undefined;
  let sign = 1;
  const m = s.match(/\s*([LR])\s*$/i);
  if (m) {
    sign = m[1].toUpperCase() === 'L' ? LEFT_SIGN : -LEFT_SIGN;
    s = s.slice(0, m.index).trim();
  }
  const n = parseFloat(s);
  if (Number.isNaN(n)) return undefined;
  const r = Math.round(n * 100) / 100;
  const out = m ? Math.round(Math.abs(r) * sign * 100) / 100 : r;
  // Validate the FINAL value (round-then-check, matching the R50 importer): rejects
  // NaN AND Infinity (e.g. "1e308" rounds to Infinity).
  return Number.isFinite(out) ? out : undefined;
}

// ── canonical club names ───────────────────────────────────────────────────────
// The app aggregates by these names (must match clubData.ts / club-compute.js). A
// device's club label is normalized to one of these so the same club merges across
// devices. The regular "<n>i / <n>w / <n>h" pattern is handled generically; explicit
// aliases cover named clubs. UNKNOWN codes pass through UPPERCASED (visible, not
// silently mis-merged) — extend GC3_CLUB_ALIASES as new device codes are confirmed.
// Lettered codes auto-map (unambiguous). "4H" → "4 Hybrid" is handled by the <n>h regex.
const GC3_CLUB_ALIASES = {
  dr: 'Driver', d: 'Driver', driver: 'Driver',
  pw: 'Pitching Wedge', gw: 'Gap Wedge', aw: 'Approach Wedge', sw: 'Sand Wedge', lw: 'Lob Wedge',
};

/**
 * Normalize a device club label to a canonical app club name so the same club merges
 * across devices. Resolution order:
 *   1. the user's saved per-device mapping (clubMap) — e.g. GC3 "52" → "Gap Wedge"
 *   2. known lettered aliases (Dr, Pw, …)
 *   3. the "<n>i / <n>w / <n>h" pattern → "<n> Iron/Wood/Hybrid"
 *   4. a NUMBER-ONLY code (a wedge loft like "52") → left RAW so the importer can ask
 *      the user to map it once (then (1) resolves it forever, across devices)
 *   5. an unknown lettered code → kept visible (UPPERCASED), never silently mis-merged.
 */
function normalizeClub(rawClub, clubMap) {
  const raw = String(rawClub == null ? '' : rawClub).trim().replace(/[<>]/g, '').slice(0, 40);
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/\s+/g, '');
  if (clubMap && clubMap[key]) return clubMap[key];
  if (GC3_CLUB_ALIASES[key]) return GC3_CLUB_ALIASES[key];
  const m = key.match(/^(\d{1,2})\s*(i|w|h)$/);
  if (m) return `${m[1]} ${{ i: 'Iron', w: 'Wood', h: 'Hybrid' }[m[2]]}`;
  if (/^\d+$/.test(raw)) return raw; // number-only wedge → needs a one-time mapping
  return raw.toUpperCase();
}

// ── session assembly (shared by all adapters) ──────────────────────────────────
// Faithful port of the prior sessionFromFile: one session per file, labeled by the
// EARLIEST shot. Each shot carries _ts (a Date) until here. Mirrors the R50 importer
// so existing behavior is unchanged.
function buildSession(shots) {
  const valid = shots.filter((s) => s._ts instanceof Date && !Number.isNaN(s._ts.getTime()));
  if (!valid.length) return [];
  valid.sort((a, b) => a._ts.getTime() - b._ts.getTime());
  const startD = valid[0]._ts;
  const pad = (n) => String(n).padStart(2, '0');
  const sid =
    startD.getFullYear() + '-' + pad(startD.getMonth() + 1) + '-' + pad(startD.getDate()) +
    '_' + pad(startD.getHours()) + pad(startD.getMinutes()) + '_u';
  const label =
    startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dateISO =
    startD.getFullYear() + '-' + pad(startD.getMonth() + 1) + '-' + pad(startD.getDate());
  return valid.map((s) => {
    const { _ts, ...rest } = s;
    return { ...rest, session: sid, session_label: label, date: dateISO, ts: _ts.toISOString() };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Adapter 1 — Garmin Approach R50  (flat per-shot CSV; the original format)
// ════════════════════════════════════════════════════════════════════════════
const R50_FIELD_MAP = {
  'Ball Speed': 'bs',
  'Launch Angle': 'la',
  'Launch Direction': 'ld',
  Backspin: 'bspin',
  Sidespin: 'sspin',
  'Spin Rate': 'spin',
  'Spin Axis': 'axis',
  'Apex Height': 'apex',
  'Carry Distance': 'carry',
  'Total Distance': 'total',
  'Carry Deviation Distance': 'dev',
  'Club Speed': 'club_speed', // now stored (was discarded)
  'Smash Factor': 'smash', // now stored (was discarded)
};

const garminR50 = {
  id: 'garmin_r50',
  label: 'Garmin R50',
  detect(text) {
    return (
      /(^|,)\s*Club Type\s*(,|$)/m.test(text) &&
      /(^|,)\s*Apex Height\s*(,|$)/m.test(text) &&
      // …and NOT a GC3 file (so a crafted file with both devices' markers can't mis-route)
      !/(^|,)\s*Shot Analysis\s*(,|$)/m.test(text) &&
      !/(^|,)\s*Peak Height\s*(,|$)/m.test(text)
    );
  },
  parse(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length < 2) return [];
    const head = lines[0].split(',').map((h) => h.trim());
    let start = 1;
    if (!lines[1].split(',')[0].trim()) start = 2; // skip a units row
    const out = [];
    for (let i = start; i < lines.length; i++) {
      const cells = lines[i].split(',');
      const row = {};
      head.forEach((h, j) => (row[h] = (cells[j] || '').trim()));
      if (!row['Date']) continue;
      const o = { club: (row['Club Type'] || '').trim().replace(/[<>]/g, '').slice(0, 40) };
      for (const [csvName, key] of Object.entries(R50_FIELD_MAP)) {
        if (row[csvName] !== undefined && row[csvName] !== '') {
          const v = val(row[csvName]);
          if (v !== undefined) o[key] = v;
        }
      }
      const ds = (row['Date'] || '').replace(/\s*(AM|PM)\s*$/i, '').trim();
      const m = ds.match(/(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
      o._ts = m
        ? new Date(2000 + +m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6])
        : new Date();
      out.push(o);
      if (out.length >= MAX_ROWS) break;
    }
    return buildSession(out);
  },
};

// ════════════════════════════════════════════════════════════════════════════
// Adapter 2 — Foresight GC3  ("Shot Analysis" summary, grouped by club)
// ════════════════════════════════════════════════════════════════════════════
// GC3 column name → internal field. Ball fields feed the engine; the four reference
// fields (carry/total/apex/dev) are stored but NOT used for physics; the rest are
// club-head/impact metrics stored when present (empty in ball-only sessions).
const GC3_FIELD_MAP = {
  'Ball Speed': 'bs',
  'Launch Angle': 'la',
  'Launch Direction': 'ld',
  'Back Spin': 'bspin',
  'Side Spin': 'sspin',
  'Total Spin': 'spin',
  'Spin Axis Tilt': 'axis',
  Carry: 'carry',
  Total: 'total',
  'Peak Height': 'apex',
  Offline: 'dev',
  'Club Speed': 'club_speed',
  'Club Speed at Impact': 'club_speed_impact',
  'Smash Factor': 'smash',
  'Angle of Attack': 'attack_angle',
  'Club Path': 'club_path',
  'Face to Path': 'face_to_path',
  'Lie Angle': 'lie_angle',
  'Dynamic Loft': 'dynamic_loft',
  'Closure Rate': 'closure_rate',
  'Horizontal Impact': 'horiz_impact',
  'Vertical Impact': 'vert_impact',
  'Face to Target': 'face_to_target',
};

// "06/24/2026" + "3:35:37 PM Central Daylight Time" → local Date (tz words ignored).
function parseGC3DateTime(dateStr, timeStr) {
  const d = String(dateStr || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const t = String(timeStr || '').match(/(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/i);
  if (!d) return null; // no parseable date → caller drops the row (don't fabricate "now")
  let h = t ? +t[1] : 0;
  if (t && t[4]) {
    const pm = t[4].toUpperCase() === 'PM';
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  return new Date(+d[3], +d[1] - 1, +d[2], h, t ? +t[2] : 0, t ? +t[3] : 0);
}

const foresightGC3 = {
  id: 'foresight_gc3',
  label: 'Foresight GC3',
  detect(text) {
    return (
      /(^|,)\s*Shot Analysis\s*(,|$)/m.test(text) ||
      (/(^|,)\s*Peak Height\s*(,|$)/m.test(text) && /(^|,)\s*Spin Axis Tilt\s*(,|$)/m.test(text))
    );
  },
  parse(text, clubMap) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const out = [];
    let club = null; // current block's normalized club
    let header = null; // map: GC3 column name → cell index
    for (const line of lines) {
      if (!line.trim()) continue;
      const cells = line.split(',').map((c) => c.trim());
      // Title row: "<player>,Shot Analysis"
      if (cells[1] === 'Shot Analysis') continue;
      // Column-header row: starts blank, then Date,Time,...
      if (cells[1] === 'Date' && cells[2] === 'Time') {
        header = {};
        cells.forEach((c, i) => {
          if (c) header[c] = i;
        });
        continue;
      }
      // Per-club summary row — skip (it's an aggregate, not a shot)
      if (cells[0] === 'Average') continue;
      // Data row: a numeric shot index in col 0 AND a date in col 1 (header + club in
      // scope). The col-1 date is what distinguishes a data row from a number-only club
      // header like "52," (which has an EMPTY col 1).
      if (/^\d+$/.test(cells[0]) && cells[1] && header && club) {
        const get = (name) => {
          const idx = header[name];
          return idx == null ? undefined : cells[idx];
        };
        const o = { club };
        for (const [csvName, key] of Object.entries(GC3_FIELD_MAP)) {
          const v = val(get(csvName));
          if (v !== undefined) o[key] = v;
        }
        o._ts = parseGC3DateTime(get('Date'), get('Time'));
        // Drop rows without a real timestamp (mirrors R50's "skip rows with no date").
        if (!(o._ts instanceof Date) || Number.isNaN(o._ts.getTime())) continue;
        out.push(o);
        if (out.length >= MAX_ROWS) break;
        continue;
      }
      // Club-header row: a LONE label in col 0 (every other cell empty) — e.g. "9i",
      // "3w", "Dr", "Pw", AND number-only wedges like "52". The empty col 1 (no date) is
      // what keeps it from being read as a data row. A partial data row (values in later
      // cells) won't match, so garbage can't silently become a club.
      if (cells[0] && cells.slice(1).every((c) => !c)) {
        club = normalizeClub(cells[0], clubMap) || 'Unknown';
      }
    }
    return buildSession(out);
  },
};

// ── registry + public API ──────────────────────────────────────────────────────
export const ADAPTERS = [garminR50, foresightGC3];

/** Adapter metadata for UI (slug + label), in registry order. */
export const DEVICES = ADAPTERS.map((a) => ({ id: a.id, label: a.label }));

/** Human label for a device slug (falls back to the slug). */
export function deviceLabel(id) {
  const a = ADAPTERS.find((x) => x.id === id);
  return a ? a.label : id || 'Unknown device';
}

/**
 * Parse one launch-monitor export. Auto-detects the device, parses it into one
 * session's worth of normalized shots (each tagged with the device slug), and returns
 * { device, label, shots }. Throws if the format isn't recognized.
 */
export function parseDeviceFile(text, opts = {}) {
  if (typeof text !== 'string') throw new Error('No file content to read.');
  if (text.length > MAX_FILE_BYTES) throw new Error('File is too large (max 10 MB).');
  const adapter = ADAPTERS.find((a) => {
    try {
      return a.detect(text);
    } catch {
      return false;
    }
  });
  if (!adapter) {
    throw new Error('Unrecognized file — not a supported launch-monitor export.');
  }
  // The user's saved per-device club mapping (e.g. { foresight_gc3: { "52": "Gap Wedge" } }).
  const clubMap = opts.clubMaps && opts.clubMaps[adapter.id];
  const shots = adapter.parse(text, clubMap).map((s) => ({ ...s, device: adapter.id }));
  return { device: adapter.id, label: adapter.label, shots };
}

/** Unique club codes in these shots that are PURE NUMBERS (e.g. "52") — number-only GC3
 *  wedge lofts that aren't mapped yet and need a one-time user mapping to a canonical
 *  club. The importer collects these and the UI prompts for them before inserting. */
export function numericClubs(shots) {
  const set = new Set();
  for (const s of shots || []) {
    const c = String(s && s.club != null ? s.club : '');
    if (/^\d+$/.test(c)) set.add(c);
  }
  return [...set];
}

// DB columns a shot row carries (besides user_id / session_id). A WHITELIST, so the
// session-level fields (session / session_label / date) never leak into the insert.
// Used by both importers (web user-data.js + mobile csvImport.ts) to stay in sync.
export const SHOT_COLUMNS = [
  'club', 'ts', 'bs', 'la', 'ld', 'bspin', 'sspin', 'spin', 'axis',
  'apex', 'carry', 'total', 'dev', 'device',
  'club_speed', 'club_speed_impact', 'smash', 'attack_angle', 'club_path',
  'face_to_path', 'lie_angle', 'dynamic_loft', 'closure_rate', 'horiz_impact',
  'vert_impact', 'face_to_target',
];

/** Build a DB shot row from a parsed shot + base ids ({user_id, session_id}). EVERY
 *  SHOT_COLUMNS key is present (null when the shot lacks it) so a bulk insert of many
 *  shots has uniform keys — PostgREST rejects an array whose objects differ in keys
 *  (PGRST102). (The pre-refactor importer set every column with explicit null too.) */
export function toShotRow(shot, base) {
  const row = { ...base };
  for (const c of SHOT_COLUMNS) {
    const v = shot[c];
    row[c] = v === undefined ? null : v;
  }
  return row;
}
