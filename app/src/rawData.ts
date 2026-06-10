/**
 * Raw R50 launch data (raw-shots.json) + browser-style uploaded sessions.
 * Mirrors the web app's loading in trends.html / raw-data.html, but persists
 * uploads via AsyncStorage instead of window.storage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
// @ts-ignore — JSON import, generated copy of repo-root raw-shots.json
import raw from '@/shared/raw-shots.json';

export interface RawShot {
  session: string;
  session_label?: string;
  ts?: string;
  date?: string;
  club: string;
  bs?: number;
  la?: number;
  ld?: number;
  bspin?: number;
  sspin?: number;
  spin?: number;
  axis?: number;
  apex?: number;
  carry?: number;
  total?: number;
  dev?: number;
  cs?: number;
  smash?: number;
  excluded?: boolean;
  [k: string]: unknown;
}

export interface Session {
  id: string;
  label: string;
  date?: string;
  start?: string;
  n?: number;
  _uploaded?: boolean;
}

const BASE = raw as unknown as {
  club_order: string[];
  sessions: Session[];
  colors: Record<string, string>;
  shots: RawShot[];
};

export const CLUB_ORDER: string[] = BASE.club_order || [];
export const BASE_COLORS: Record<string, string> = BASE.colors || {};

/** Bundled sample data (the developer's R50 history) for the in-app "Load sample data" action. */
export const SAMPLE_DATA: { sessions: Session[]; shots: RawShot[] } = {
  sessions: BASE.sessions ?? [],
  shots: BASE.shots ?? [],
};
export const orderIdx = (c: string) => {
  const i = CLUB_ORDER.indexOf(c);
  return i < 0 ? 999 : i;
};

const FALLBACK = ['#d4ff4f', '#7fd4ff', '#ff9d9d', '#b6f24f', '#4fd6a8', '#f2b24f', '#c98fff'];
const UPLOAD_KEY = 'uploaded_shots';

export async function loadUploaded(): Promise<RawShot[]> {
  try {
    const v = await AsyncStorage.getItem(UPLOAD_KEY);
    return v ? (JSON.parse(v) as RawShot[]) : [];
  } catch {
    return [];
  }
}

export async function saveUploaded(shots: RawShot[]): Promise<void> {
  await AsyncStorage.setItem(UPLOAD_KEY, JSON.stringify(shots));
}

export interface RawData {
  shots: RawShot[];
  sessions: Session[];
  colors: Record<string, string>;
  clubOrder: string[];
}

/** Merge bundled base data with any uploaded sessions (sorted by date). */
export async function getRawData(): Promise<RawData> {
  const up = await loadUploaded();
  const shots = [...BASE.shots, ...up];
  const colors = { ...BASE_COLORS };
  let ci = 0;
  shots.forEach((s) => {
    if (!colors[s.club]) {
      colors[s.club] = FALLBACK[ci % FALLBACK.length];
      ci++;
    }
  });
  const sm: Record<string, Session> = {};
  (BASE.sessions || []).forEach((s) => {
    sm[s.id] = { ...s };
  });
  up.forEach((s) => {
    if (!sm[s.session]) {
      sm[s.session] = {
        id: s.session,
        label: s.session_label || s.session,
        date: s.date || '',
        _uploaded: true,
      };
    }
  });
  const sessions = Object.values(sm).sort(
    (a, b) => (a.date || '').localeCompare(b.date || '') || a.id.localeCompare(b.id),
  );
  return { shots, sessions, colors, clubOrder: CLUB_ORDER };
}
