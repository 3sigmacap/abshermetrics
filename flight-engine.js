/* ============================================================================
 * flight-engine.js — AbsherMetrics golf ball flight engine
 * ----------------------------------------------------------------------------
 * A standalone, dependency-free golf-ball trajectory simulator. Given launch
 * conditions (ball speed, launch angle, spin) it integrates the full ball
 * flight and returns the trajectory plus derived numbers (carry, apex,
 * descent angle, flight time).
 *
 * PHYSICS PROVENANCE
 *   This is a faithful JavaScript port of the *aerial-phase* physics in
 *   libgolf (https://github.com/gdifiore/libgolf) by Gabriel DiFiore, whose
 *   in-air aerodynamics are based on the work of Prof. Alan M. Nathan
 *   (University of Illinois Urbana-Champaign), "TrajectoryCalculatorGolf".
 *   Drag/lift coefficient fits trace to Bearman/Harvey dimpled-sphere
 *   wind-tunnel data and a Washington State University study (Bin Lyu et al.).
 *
 *   Every constant and formula below is copied from libgolf's
 *   DefaultAerodynamicModel.hpp, physics_constants.hpp, ShotPhysicsContext.cpp,
 *   and DefaultIntegrator.hpp so results match the C++ library. We implement
 *   only the AERIAL phase (no bounce/roll) because the launch monitor measures
 *   carry, and carry is an aerial quantity.
 *
 * COORDINATE SYSTEM (from libgolf BallState.hpp)
 *   x = lateral (positive = right of target line)
 *   y = forward / downrange (direction 0 points along +y)
 *   z = vertical / height (positive = up)
 *   Internal units are FEET and FT/S; spin in RAD/S. Carry/lateral are
 *   converted to YARDS, apex to FEET on the way out (matching shots.json).
 *
 * WHY THIS FILE EXISTS
 *   The trajectories the rest of the site renders (2D dispersion, 3D flight)
 *   and the carry attribution shown on Trends are all derived from THIS engine,
 *   so there is one documented, reproducible source of truth for ball flight
 *   rather than opaque precomputed numbers.
 *
 * USAGE
 *   import { simulateFlight, attributeCarryChange, BALL } from './flight-engine.js';
 *   const r = simulateFlight({ ballSpeedMph:124, launchDeg:22.6, backspinRpm:7000, sidespinRpm:0 });
 *   // r.carryYd, r.apexFt, r.descentDeg, r.flightTime, r.points[[x,y,z]...] (yards/feet)
 * ========================================================================== */

/* ---- physics_constants.hpp ---- */
const C = {
  STD_BALL_CIRCUMFERENCE_IN: 5.277,
  STD_BALL_MASS_OZ: 1.62,
  DRAG_FORCE_CONST: 0.07182,
  REF_BALL_MASS_OZ: 5.125,
  REF_BALL_CIRC_IN: 9.125,
  GRAVITY_FT_PER_S2: 32.174,
  STD_AIR_DENSITY_KG_PER_M3: 1.2929,
  STD_PRESSURE_MMHG: 760.0,
  KELVIN_OFFSET: 273.15,
  METERS_TO_FEET: 3.28084,
  YARDS_TO_FEET: 3.0,
  INCHES_PER_FOOT: 12.0,
  INCHES_PER_METER: 1.0 / 0.0254,
  MPH_TO_FT_PER_S: 5280.0 / 3600.0,
  RE100_VELOCITY_M_PER_S: 44.7,
  PI: Math.PI,
  DEG_TO_RAD: Math.PI / 180.0,
  RPM_TO_RAD_PER_S: Math.PI / 30.0,
  INHG_TO_MMHG: 1000.0 / (1.0 / 0.0254),
  KG_PER_M3_TO_LB_PER_FT3: 0.06261,
  BETA_PRESSURE_DECAY: 0.0001217,
  WATER_VAPOR_COEFF: 0.3783,
  SVP_COEFF_A: 4.5841,
  SVP_COEFF_B: 18.687,
  SVP_COEFF_C: 234.5,
  SVP_COEFF_D: 257.14,
  SUTHERLAND_CONSTANT: 120.0,
  SUTHERLAND_VISCOSITY_COEFF: 0.000001512,
  SIMULATION_TIME_STEP: 0.01,
  MAX_SIMULATION_TIME: 120.0,
  MIN_SPEED: 0.01,
  MIN_SPIN: 0.01,
};
C.STD_BALL_RADIUS_FT = C.STD_BALL_CIRCUMFERENCE_IN / (2 * C.PI) / C.INCHES_PER_FOOT;

/* Reference ball (the ball the model assumes). Exposed for inspection. */
export const BALL = {
  massOz: C.STD_BALL_MASS_OZ,
  circumferenceIn: C.STD_BALL_CIRCUMFERENCE_IN,
  radiusFt: C.STD_BALL_RADIUS_FT,
};

/* Default sea-level-ish atmosphere. The R50 export carries per-shot air
 * density/temperature, but raw-shots.json does not retain them, so we use a
 * fixed standard atmosphere — matching how the site's trajectories were made.
 * (Override per call via opts.atmos if you ever wire density back in.) */
export const STD_ATMOS = {
  tempF: 70.0,        // °F
  elevationFt: 0.0,   // ft
  pressureInHg: 29.92,// inHg
  relHumidity: 50.0,  // %
  windMph: 0.0,
  windDirDeg: 0.0,
};

/* ---- math_utils ---- */
const f2c = f => (f - 32.0) * (5.0 / 9.0);
const c2k = c => c + C.KELVIN_OFFSET;
const ft2m = ft => ft / C.METERS_TO_FEET;

/* ----------------------------------------------------------------------------
 * ShotPhysicsContext: derive the lumped atmospheric scalars c0 and re100 plus
 * the launch velocity / spin vectors, exactly as libgolf does.
 * -------------------------------------------------------------------------- */
function buildContext(launch, atmos, ball) {
  const tempC = f2c(atmos.tempF);
  const tempK = c2k(tempC);
  const elevationM = ft2m(atmos.elevationFt);

  const barometricPressure = atmos.pressureInHg * C.INHG_TO_MMHG;           // mmHg
  const SVP = C.SVP_COEFF_A * Math.exp((C.SVP_COEFF_B - tempC / C.SVP_COEFF_C) * tempC / (C.SVP_COEFF_D + tempC));

  // Air density (kg/m^3) with elevation + humidity correction.
  const rhoMetric = C.STD_AIR_DENSITY_KG_PER_M3 * (
    (C.KELVIN_OFFSET / tempK) *
    ((barometricPressure * Math.exp(-C.BETA_PRESSURE_DECAY * elevationM)
      - C.WATER_VAPOR_COEFF * atmos.relHumidity * (SVP / 100.0)) / C.STD_PRESSURE_MMHG)
  );
  const rhoImperial = rhoMetric * C.KG_PER_M3_TO_LB_PER_FT3;

  // Lumped drag coefficient c0 (folds density, area, mass — yields ft/s^2).
  const c0 = C.DRAG_FORCE_CONST * rhoImperial * (C.REF_BALL_MASS_OZ / ball.massOz)
           * Math.pow(ball.circumferenceIn / C.REF_BALL_CIRC_IN, 2);

  // Sutherland viscosity and Re at 100 mph reference.
  const airViscosity = C.SUTHERLAND_VISCOSITY_COEFF * Math.pow(tempK, 1.5) / (tempK + C.SUTHERLAND_CONSTANT);
  const diameterM = ball.circumferenceIn / (C.PI * C.INCHES_PER_METER);
  const re100 = rhoMetric * C.RE100_VELOCITY_M_PER_S * diameterM / airViscosity;

  // Launch velocity vector (ft/s). direction in degrees (0 = straight).
  const la = launch.launchDeg * C.DEG_TO_RAD;
  const dir = (launch.directionDeg || 0) * C.DEG_TO_RAD;
  const v0 = launch.ballSpeedMph * C.MPH_TO_FT_PER_S;
  const vel = [
    v0 * Math.cos(la) * Math.sin(dir),
    v0 * Math.cos(la) * Math.cos(dir),
    v0 * Math.sin(la),
  ];

  // Spin vector (rad/s) from back/side spin, same construction as libgolf.
  const back = launch.backspinRpm || 0;
  const side = launch.sidespinRpm || 0;
  const spin = [
    (back * Math.cos(dir) - side * Math.sin(la) * Math.sin(dir)) * C.RPM_TO_RAD_PER_S,
    (-back * Math.sin(dir) - side * Math.sin(la) * Math.cos(dir)) * C.RPM_TO_RAD_PER_S,
    (side * Math.cos(la)) * C.RPM_TO_RAD_PER_S,
  ];

  // Wind vector (ft/s).
  const wind = [
    atmos.windMph * C.MPH_TO_FT_PER_S * Math.sin(atmos.windDirDeg * C.DEG_TO_RAD),
    atmos.windMph * C.MPH_TO_FT_PER_S * Math.cos(atmos.windDirDeg * C.DEG_TO_RAD),
    0,
  ];

  return { c0, re100, vel, spin, wind, ballRadius: ball.radiusFt };
}

/* ----------------------------------------------------------------------------
 * DefaultAerodynamicModel — Cd / Cl / spin-decay. Verbatim coefficients.
 * -------------------------------------------------------------------------- */
const AERO = {
  TAU_COEFF: 0.00002,
  RE_THRESHOLD_LOW: 0.5, RE_THRESHOLD_HIGH: 1.0,
  RE_SCALE_FACTOR: 0.00001, RE_VELOCITY_DIVISOR: 100.0,
  CD_SPIN: 0.180, CD_LOW: 0.500, CD_HIGH: 0.200,
  RE_BIN_NO_LIFT: 0.3, RE_BIN_LOW: 0.5, RE_BIN_MID_LOW: 0.6, RE_BIN_MID_HIGH: 0.65, RE_BIN_HIGH: 0.7,
  CL_RE50K: [0.0472121, 2.84795, -23.4342, 45.4849],
  CL_RE60K: [0.320524, -4.7032, 14.0613],
  CL_RE65K: [0.266667, -4.0, 13.3333],
  CL_RE70K: [0.0496189, 0.00211396, 2.34201],
  CL_MAX_BASE: 0.268, CL_MAX_HIGH_SR: 0.320,
  CL_MAX_SR_LERP_LOW: 0.35, CL_MAX_SR_LERP_HIGH: 0.50,
  HIGH_RE_SPIN_GAIN: 16.0,
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smoothStep01 = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
function clMaxForS(S) {
  if (S <= AERO.CL_MAX_SR_LERP_LOW) return AERO.CL_MAX_BASE;
  if (S >= AERO.CL_MAX_SR_LERP_HIGH) return AERO.CL_MAX_HIGH_SR;
  const t = (S - AERO.CL_MAX_SR_LERP_LOW) / (AERO.CL_MAX_SR_LERP_HIGH - AERO.CL_MAX_SR_LERP_LOW);
  return AERO.CL_MAX_BASE + (AERO.CL_MAX_HIGH_SR - AERO.CL_MAX_BASE) * t;
}
const clRe50k = S => AERO.CL_RE50K[0] + AERO.CL_RE50K[1]*S + AERO.CL_RE50K[2]*S*S + AERO.CL_RE50K[3]*S*S*S;
const clRe60k = S => AERO.CL_RE60K[0] + AERO.CL_RE60K[1]*S + AERO.CL_RE60K[2]*S*S;
const clRe65k = S => AERO.CL_RE65K[0] + AERO.CL_RE65K[1]*S + AERO.CL_RE65K[2]*S*S;
const clRe70k = S => AERO.CL_RE70K[0] + AERO.CL_RE70K[1]*S + AERO.CL_RE70K[2]*S*S;

function computeCd(Re_x_e5, S) {
  const { CD_LOW: lo, CD_HIGH: hi, RE_THRESHOLD_LOW: rl, RE_THRESHOLD_HIGH: rh, CD_SPIN: cs } = AERO;
  if (Re_x_e5 <= rl) return lo + cs * S;
  if (Re_x_e5 < rh) return lo - (lo - hi) * (Re_x_e5 - rl) / (rh - rl) + cs * S;
  return hi + cs * S;
}
function computeCl(Re_x_e5, S) {
  if (S <= 0) return 0;
  const clMax = clMaxForS(S);
  if (Re_x_e5 <= AERO.RE_BIN_NO_LIFT) return 0;
  if (Re_x_e5 < AERO.RE_BIN_LOW) {
    const t = smoothStep01((Re_x_e5 - AERO.RE_BIN_NO_LIFT) / (AERO.RE_BIN_LOW - AERO.RE_BIN_NO_LIFT));
    return clamp(clRe50k(S) * t, 0, clMax);
  }
  if (Re_x_e5 >= AERO.RE_BIN_HIGH) {
    const g = AERO.HIGH_RE_SPIN_GAIN;
    return clamp(clMax * S * g / (1 + S * g), 0, clMax);
  }
  let reA, reB, clA, clB;
  if (Re_x_e5 < AERO.RE_BIN_MID_LOW) { reA=AERO.RE_BIN_LOW; reB=AERO.RE_BIN_MID_LOW; clA=clRe50k(S); clB=clRe60k(S); }
  else if (Re_x_e5 < AERO.RE_BIN_MID_HIGH) { reA=AERO.RE_BIN_MID_LOW; reB=AERO.RE_BIN_MID_HIGH; clA=clRe60k(S); clB=clRe65k(S); }
  else { reA=AERO.RE_BIN_MID_HIGH; reB=AERO.RE_BIN_HIGH; clA=clRe65k(S); clB=clRe70k(S); }
  const w = (Re_x_e5 - reA) / (reB - reA);
  return clamp(clA + (clB - clA) * w, 0, clMax);
}

/* Aerodynamic acceleration (ft/s^2), gravity added by the integrator. */
function aeroAccel(vel, wind, spin, c0, re100, ballRadius) {
  const vrx = vel[0]-wind[0], vry = vel[1]-wind[1], vrz = vel[2]-wind[2];
  const vw = Math.sqrt(vrx*vrx + vry*vry + vrz*vrz);
  if (vw < C.MIN_SPEED) return [0,0,0];
  const vwMph = vw / C.MPH_TO_FT_PER_S;
  const Re_x_e5 = (vwMph / AERO.RE_VELOCITY_DIVISOR) * re100 * AERO.RE_SCALE_FACTOR;
  const omegaMag = Math.sqrt(spin[0]*spin[0] + spin[1]*spin[1] + spin[2]*spin[2]);
  const S = omegaMag * ballRadius / vw;
  const Cd = computeCd(Re_x_e5, S);
  const Cl = computeCl(Re_x_e5, S);
  const dragScale = -c0 * Cd * vw;
  let ax = dragScale*vrx, ay = dragScale*vry, az = dragScale*vrz;
  if (omegaMag > C.MIN_SPIN) {
    const ms = c0 * (Cl / omegaMag) * vw;        // Magnus: c0*(Cl/|ω|)*vw*(ω × vRel)
    ax += ms * (spin[1]*vrz - spin[2]*vry);
    ay += ms * (spin[2]*vrx - spin[0]*vrz);
    az += ms * (spin[0]*vry - spin[1]*vrx);
  }
  return [ax, ay, az];
}
const spinDecayTau = (vel, ballRadius) => {
  const v = Math.sqrt(vel[0]*vel[0]+vel[1]*vel[1]+vel[2]*vel[2]);
  return 1.0 / (AERO.TAU_COEFF * v / ballRadius);
};

/* ----------------------------------------------------------------------------
 * simulateFlight — integrate the aerial phase to ground.
 *   launch: { ballSpeedMph, launchDeg, backspinRpm, sidespinRpm, directionDeg? }
 *           (you can also pass spinRpm + axisDeg; see normalizeLaunch below)
 * Returns { carryYd, lateralYd, apexFt, descentDeg, flightTime, points }
 *   points: array of [x_yd, height_ft, z_yd]  (shots.json's x,y,z layout:
 *   x downrange yards, y height feet, z lateral yards)
 * -------------------------------------------------------------------------- */
export function simulateFlight(launchIn, opts = {}) {
  const atmos = { ...STD_ATMOS, ...(opts.atmos || {}) };
  const ball = { ...BALL, ...(opts.ball || {}) };
  const launch = normalizeLaunch(launchIn);
  const dt = opts.dt || C.SIMULATION_TIME_STEP;
  const ctx = buildContext(launch, atmos, ball);

  let pos = [0, 0, 0];
  let vel = ctx.vel.slice();
  let spin = ctx.spin.slice();
  let t = 0;
  let acc = addGravity(aeroAccel(vel, ctx.wind, spin, ctx.c0, ctx.re100, ctx.ballRadius));

  // record trajectory in shots.json layout: [x_downrange_yd, height_ft, z_lateral_yd]
  const pts = [[0, 0, 0]];
  let apexFt = 0;
  let prev = pos.slice();

  while (t < C.MAX_SIMULATION_TIME) {
    // spin decays once per step using the velocity from the start of step
    const tau = spinDecayTau(vel, ctx.ballRadius);
    const decay = Math.exp(-dt / tau);
    spin = [spin[0]*decay, spin[1]*decay, spin[2]*decay];

    // semi-implicit Euler (DefaultIntegrator): pos uses 0.5*a*dt^2, vel forward-Euler
    prev = pos.slice();
    for (let i = 0; i < 3; i++) {
      pos[i] += vel[i]*dt + 0.5*acc[i]*dt*dt;
      vel[i] += acc[i]*dt;
    }
    t += dt;
    if (pos[2] > apexFt) apexFt = pos[2];

    if (pos[2] <= 0 && prev[2] > 0) {
      // interpolate landing at z=0
      const f = prev[2] / (prev[2] - pos[2]);
      const land = [
        prev[0] + (pos[0]-prev[0])*f,
        prev[1] + (pos[1]-prev[1])*f,
        0,
      ];
      pts.push([land[1]/C.YARDS_TO_FEET, land[2], land[0]/C.YARDS_TO_FEET]);
      return finalize(pts, apexFt, t, prev, land, ball);
    }
    pts.push([pos[1]/C.YARDS_TO_FEET, pos[2], pos[0]/C.YARDS_TO_FEET]);

    // start-of-next-step acceleration
    acc = addGravity(aeroAccel(vel, ctx.wind, spin, ctx.c0, ctx.re100, ctx.ballRadius));
    if (pos[1]/C.YARDS_TO_FEET > 600) break; // safety
  }
  return finalize(pts, apexFt, t, prev, pos, ball);
}
function addGravity(a){ return [a[0], a[1], a[2] - C.GRAVITY_FT_PER_S2]; }

function finalize(pts, apexFt, flightTime, prevFt, landFt, ball) {
  const carryYd = landFt[1] / C.YARDS_TO_FEET;     // downrange y -> yards
  const lateralYd = landFt[0] / C.YARDS_TO_FEET;   // lateral x -> yards
  // descent angle from the last airborne segment (feet space)
  const dx = landFt[1] - prevFt[1];                // downrange ft
  const dz = prevFt[2] - landFt[2];                // drop ft (prev above ground)
  const descentDeg = Math.atan2(dz, dx) * 180 / C.PI;
  return { carryYd, lateralYd, apexFt, descentDeg, flightTime, points: pts };
}

/* Accept either {backspinRpm,sidespinRpm} or {spinRpm,axisDeg} (R50 gives both
 * total spin + axis; we can split into back/side). If only total spin is given
 * with an axis, split it; if neither, treat spin as pure backspin. */
export function normalizeLaunch(L) {
  const out = {
    ballSpeedMph: L.ballSpeedMph,
    launchDeg: L.launchDeg,
    directionDeg: L.directionDeg || 0,
  };
  if (L.backspinRpm != null || L.sidespinRpm != null) {
    out.backspinRpm = L.backspinRpm || 0;
    out.sidespinRpm = L.sidespinRpm || 0;
  } else if (L.spinRpm != null) {
    const axis = (L.axisDeg || 0) * C.DEG_TO_RAD;
    out.backspinRpm = L.spinRpm * Math.cos(axis);
    out.sidespinRpm = L.spinRpm * Math.sin(axis);
  } else {
    out.backspinRpm = 0; out.sidespinRpm = 0;
  }
  return out;
}

/* ----------------------------------------------------------------------------
 * attributeCarryChange — THE INSIGHT FUNCTION.
 *
 * Given two launch states A (earlier) and B (later), decompose the change in
 * modeled carry (B - A) into how much each input variable contributed:
 * ball speed, launch angle, and spin. Uses a Shapley decomposition
 * (average marginal contribution over all input orderings), so the parts sum
 * EXACTLY to the modeled carry change with no leftover interaction term —
 * the honest way to answer "what drove the change?" when variables interact.
 *
 * Inputs A and B are objects: { ballSpeedMph, launchDeg, spinRpm }.
 * (Spin treated as total/backspin for carry; axis affects lateral, not carry.)
 *
 * Returns:
 *   { carryA, carryB, total, parts:{ballSpeed, launch, spin}, pct:{...} }
 * where parts.* are yards and sum to (carryB - carryA) within rounding.
 * -------------------------------------------------------------------------- */
export function attributeCarryChange(A, B, opts = {}) {
  const vars = ['ballSpeedMph', 'launchDeg', 'spinRpm'];
  const label = { ballSpeedMph: 'ballSpeed', launchDeg: 'launch', spinRpm: 'spin' };

  // carry for an arbitrary mix of A/B values (subset S takes B, rest take A)
  const carryFor = (useB) => {
    const L = {
      ballSpeedMph: (useB.has('ballSpeedMph') ? B : A).ballSpeedMph,
      launchDeg:    (useB.has('launchDeg')    ? B : A).launchDeg,
      spinRpm:      (useB.has('spinRpm')      ? B : A).spinRpm,
    };
    return simulateFlight({ ballSpeedMph: L.ballSpeedMph, launchDeg: L.launchDeg, spinRpm: L.spinRpm }, opts).carryYd;
  };

  // Shapley value for each variable: average over all orderings of the
  // marginal gain from switching that variable from A to B.
  const perms = permutations(vars);
  const contrib = { ballSpeedMph: 0, launchDeg: 0, spinRpm: 0 };
  for (const order of perms) {
    const used = new Set();
    let prevCarry = carryFor(used); // all-A
    for (const v of order) {
      used.add(v);
      const nowCarry = carryFor(used);
      contrib[v] += (nowCarry - prevCarry);
      prevCarry = nowCarry;
    }
  }
  const nperm = perms.length;
  for (const v of vars) contrib[v] /= nperm;

  const carryA = carryFor(new Set());
  const carryB = carryFor(new Set(vars));
  const total = carryB - carryA;
  const parts = { ballSpeed: contrib.ballSpeedMph, launch: contrib.launchDeg, spin: contrib.spinRpm };
  const denom = Math.abs(parts.ballSpeed) + Math.abs(parts.launch) + Math.abs(parts.spin) || 1;
  const pct = {
    ballSpeed: parts.ballSpeed / denom * 100,
    launch: parts.launch / denom * 100,
    spin: parts.spin / denom * 100,
  };
  return { carryA, carryB, total, parts, pct };
}

function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}
