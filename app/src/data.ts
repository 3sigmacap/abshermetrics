/**
 * Shared dataset bridge. shots.json / raw-shots.json live at the repo root and
 * are bundled into the native app at build time (Metro imports JSON natively).
 * Same files the web app fetches — single source of truth.
 */
// @ts-ignore — JSON import, no type declarations. src/shared/ is a generated copy
// of the repo-root dataset (see scripts/sync-shared.js); the root file remains the
// single editable source of truth.
import shotsJson from '@/shared/shots.json';

export interface Ellipse {
  cx: number;
  cz: number;
  rx: number; // carry SD
  rz: number; // lateral SD
}

export interface ShotStat {
  bs: number;
  la: number;
  ld?: number;
  bspin?: number;
  sspin?: number;
  spin: number;
  axis?: number;
  carry?: number;
  total?: number;
  dev?: number;
  apex?: number;
}

export interface ClubData {
  club: string;
  color: string;
  carry: number; // engine carry (yd)
  total: number; // engine total after bounce + roll (yd)
  apex: number; // engine apex (ft)
  descent?: number;
  n: number;
  spinaxis?: number;
  flightTime?: number;
  ell?: Ellipse;
  stats: ShotStat[];
  mean?: number[];
  shots?: number[][];
  meanRoll?: number[];
  roll?: number[][];
  derived?: unknown[];
}

// shots.json is canonical ASCENDING by club length.
const CLUBS = shotsJson as unknown as ClubData[];
export default CLUBS;
