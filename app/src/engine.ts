/**
 * Typed facade over the shared ball-flight physics engine.
 *
 * The engine itself lives at the repo root in `flight-engine.js` — the EXACT
 * same file the web app loads and `generate_trajectories.py` runs through Node.
 * This is the single source of truth: never copy/fork it. Metro reaches the
 * root file via the `watchFolders` entry in metro.config.js.
 */
// @ts-ignore — plain-JS module, no type declarations. src/shared/ is a generated
// copy of the repo-root engine (see scripts/sync-shared.js); the root file remains
// the single editable source of truth.
import * as engine from '@/shared/flight-engine.js';

export interface Launch {
  ballSpeedMph: number;
  launchDeg: number;
  // either combined spin + axis…
  spinRpm?: number;
  axisDeg?: number;
  // …or split back/side spin
  backspinRpm?: number;
  sidespinRpm?: number;
  directionDeg?: number;
}

export interface FlightResult {
  carryYd: number;
  lateralYd: number;
  apexFt: number;
  descentDeg: number;
  flightTime: number;
  points: number[][]; // [x_downrange_yd, height_ft, z_lateral_yd]
  totalYd?: number;
  totalLateralYd?: number;
  restPoint?: number[];
  groundPoints?: number[][];
}

export interface FlightOpts {
  rollout?: boolean;
  atmos?: Record<string, unknown>;
  ground?: Record<string, unknown>;
  ball?: Record<string, unknown>;
  dt?: number;
}

export const simulateFlight = (engine as any).simulateFlight as (
  launch: Launch,
  opts?: FlightOpts,
) => FlightResult;

export const attributeCarryChange = (engine as any).attributeCarryChange as (
  A: { ballSpeedMph: number; launchDeg: number; spinRpm: number },
  B: { ballSpeedMph: number; launchDeg: number; spinRpm: number },
  opts?: Record<string, unknown>,
) => {
  carryA: number;
  carryB: number;
  total: number;
  parts: { ballSpeed: number; launch: number; spin: number };
  pct: { ballSpeed: number; launch: number; spin: number };
};

export const normalizeLaunch = (engine as any).normalizeLaunch as (L: Launch) => Launch;
export const BALL = (engine as any).BALL;
export const STD_ATMOS = (engine as any).STD_ATMOS;
export const GROUND = (engine as any).GROUND;
