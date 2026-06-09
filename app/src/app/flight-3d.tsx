/**
 * 3D Flight — real 3D port of flight-3d.html using @react-three/fiber/native
 * (expo-gl backed) + three.js.
 *
 * Each club's mean trajectory (CLUBS[i].mean, flat [x,y,z,...] with x,z in YARDS
 * and y in FEET) is drawn true-to-scale by converting feet -> yards (/3), exactly
 * like the web (VEXAG=1, Hscale=1/FT_PER_YD). Faint per-shot lines, landing dots,
 * a mean tube, a roll-out tube (meanRoll) and a 1σ landing-zone overlay are
 * reproduced. Touch drag orbits, two-finger pinch zooms; camera presets, auto-orbit
 * and a staggered Launch animation mirror the source page.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
// @ts-ignore — three 0.184 ships no bundled .d.ts and @types/three isn't
// installed; this matches the project's untyped-import convention (see engine.ts).
import * as THREE from 'three';

import CLUBS, { type ClubData } from '@/data';
import { C } from '@/theme';

// ---- units / scale (mirrors flight-3d.html) ----
const VEXAG = 1.0;
const FT_PER_YD = 3;
const Hscale = VEXAG / FT_PER_YD; // engine height(ft) * this -> scene units(yd)
const TUBE_R = 0.282;

function vec(x: number, y: number, z: number) {
  // x downrange yd, y height ft -> yd, z lateral yd
  return new THREE.Vector3(x, y * Hscale, z);
}
function toPts(flat: number[]): THREE.Vector3[] {
  const a: THREE.Vector3[] = [];
  for (let i = 0; i < flat.length; i += 3) a.push(vec(flat[i], flat[i + 1], flat[i + 2]));
  return a;
}

// ---- field extents (yards) ----
const FIELD_X0 = -20;
const FIELD_X1 = 320;
const FIELD_Z = 70;

type Preset = { az: number; el: number; dist: number; tgt: THREE.Vector3 } | null;
const PRESETS: Record<string, Preset> = {
  free: null,
  dtl: { az: -1.55, el: 0.11, dist: 430, tgt: vec(150, 16, 0) },
  behind: { az: 0, el: 0.26, dist: 300, tgt: vec(120, 18, 0) },
  top: { az: -0.001, el: 1.4, dist: 480, tgt: vec(150, 0, 0) },
  side: { az: -Math.PI / 2, el: 0.16, dist: 400, tgt: vec(150, 22, 0) },
};
const CAM_BUTTONS: { key: string; label: string }[] = [
  { key: 'free', label: 'Free' },
  { key: 'dtl', label: 'Down-line' },
  { key: 'behind', label: 'Behind' },
  { key: 'top', label: 'Top-down' },
  { key: 'side', label: 'Side-on' },
];

// ---------------------------------------------------------------------------
// Per-club three.js object graph (built once, imperatively).
// ---------------------------------------------------------------------------
interface ClubObj {
  club: string;
  color: string;
  carry: number;
  total: number;
  apex: number;
  n: number;
  flightTime: number;
  grp: THREE.Group;
  shotGrp: THREE.Group;
  tube: THREE.Object3D;
  mk: THREE.Object3D;
  rollTube: THREE.Object3D | null;
  restMk: THREE.Object3D | null;
  ovl: THREE.Group;
  ball: THREE.Mesh;
  trail: THREE.Line;
  flightPts: THREE.Vector3[];
  rollPts: THREE.Vector3[] | null;
  anim: Anim | null;
}

interface Anim {
  pts: THREE.Vector3[];
  t0: number;
  dur: number;
  ftReal: number;
  roll: THREE.Vector3[] | null;
  rollDur: number;
  rollT0: number;
  phase: 'air' | 'roll';
  trailPos: THREE.Vector3[];
  lastPos: THREE.Vector3 | null;
  lastT: number;
  speed: number;
}

type Ell = { cx: number; cz: number; rx: number; rz: number };

function ellRingGeom(e: Ell) {
  const pts: THREE.Vector3[] = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    pts.push(vec(e.cx + Math.cos(a) * e.rx, 0, e.cz + Math.sin(a) * e.rz));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}
function ellDisc(e: Ell, col: THREE.Color) {
  const shape = new THREE.Shape();
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = e.cx + Math.cos(a) * e.rx;
    const z = e.cz + Math.sin(a) * e.rz;
    if (i === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  }
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  m.position.y = 0.2;
  return m;
}
function gapRing(carry: number, col: THREE.Color) {
  const pts: THREE.Vector3[] = [];
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const z = -55 + (110 * i) / N;
    pts.push(vec(carry, 0, z));
  }
  const m = new THREE.LineDashedMaterial({
    color: col,
    transparent: true,
    opacity: 0.35,
    dashSize: 4,
    gapSize: 4,
  });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), m);
  line.computeLineDistances();
  return line;
}

/** Build the static ground (grid, distance markers, center line, tee). */
function buildField(): THREE.Group {
  const root = new THREE.Group();
  const gridMat = new THREE.LineBasicMaterial({ color: 0x14241b });
  for (let x = FIELD_X0; x <= FIELD_X1; x += 20)
    root.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([vec(x, 0, -FIELD_Z), vec(x, 0, FIELD_Z)]),
        gridMat,
      ),
    );
  for (let z = -FIELD_Z; z <= FIELD_Z; z += 20)
    root.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([vec(FIELD_X0, 0, z), vec(FIELD_X1, 0, z)]),
        gridMat,
      ),
    );
  const mkMat = new THREE.LineBasicMaterial({ color: 0x2a4a38 });
  for (let yd = 0; yd <= 300; yd += 50)
    root.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([vec(yd, 0, -40), vec(yd, 0, 40)]),
        mkMat,
      ),
    );
  root.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([vec(0, 0, 0), vec(300, 0, 0)]),
      new THREE.LineBasicMaterial({ color: 0x39604a }),
    ),
  );
  const tee = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xd4ff4f }),
  );
  tee.position.copy(vec(0, 0, 0));
  root.add(tee);
  return root;
}

/** Build all per-club objects + a root group containing field + clubs. */
function buildScene(clubs: ClubData[]): { root: THREE.Group; objs: ClubObj[] } {
  const root = new THREE.Group();
  root.add(buildField());
  const objs: ClubObj[] = [];

  clubs.forEach((d) => {
    if (!d.mean || d.mean.length < 6) return;
    const col = new THREE.Color(d.color);
    const grp = new THREE.Group();

    // faint per-shot lines + landing dots
    const shotGrp = new THREE.Group();
    const land: THREE.Vector3[] = [];
    (d.shots ?? []).forEach((sFlat) => {
      if (!sFlat || sFlat.length < 6) return;
      const g = new THREE.BufferGeometry().setFromPoints(toPts(sFlat));
      shotGrp.add(
        new THREE.Line(
          g,
          new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.12 }),
        ),
      );
      const n = sFlat.length;
      land.push(vec(sFlat[n - 3], 0, sFlat[n - 1]));
    });
    if (land.length) {
      const ld = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(land),
        new THREE.PointsMaterial({ color: col, size: 3.4, transparent: true, opacity: 0.5 }),
      );
      shotGrp.add(ld);
    }

    // mean tube
    const meanPts = toPts(d.mean);
    const curve = new THREE.CatmullRomCurve3(meanPts);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 80, TUBE_R, 8, false),
      new THREE.MeshBasicMaterial({ color: col }),
    );
    const mn = d.mean.length;
    const mk = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 16, 16),
      new THREE.MeshBasicMaterial({ color: col }),
    );
    mk.position.copy(vec(d.mean[mn - 3], 0, d.mean[mn - 1]));

    // roll-out tube (bounce + roll), de-duped
    let rollTube: THREE.Object3D | null = null;
    let restMk: THREE.Object3D | null = null;
    let rollPtsClean: THREE.Vector3[] | null = null;
    if (Array.isArray(d.meanRoll) && d.meanRoll.length >= 6) {
      const rollPts = toPts(d.meanRoll);
      const clean = rollPts.filter((p, i) => i === 0 || p.distanceTo(rollPts[i - 1]) > 1e-4);
      rollPtsClean = clean;
      if (clean.length >= 2) {
        const rollCurve = new THREE.CatmullRomCurve3(clean);
        rollTube = new THREE.Mesh(
          new THREE.TubeGeometry(rollCurve, 60, TUBE_R, 8, false),
          new THREE.MeshBasicMaterial({ color: col }),
        );
        const rn = d.meanRoll.length;
        restMk = new THREE.Mesh(
          new THREE.SphereGeometry(1.2, 14, 14),
          new THREE.MeshBasicMaterial({
            color: col,
            transparent: true,
            opacity: 0.5,
            wireframe: true,
          }),
        );
        restMk.position.copy(vec(d.meanRoll[rn - 3], 0, d.meanRoll[rn - 1]));
      }
    }

    // landing-zone overlay (disc + ring + gap ring)
    const ovl = new THREE.Group();
    const e: Ell = d.ell ?? { cx: d.carry, cz: 0, rx: 5, rz: 6 };
    ovl.add(ellDisc(e, col));
    ovl.add(
      new THREE.Line(
        ellRingGeom(e),
        new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.55 }),
      ),
    );
    ovl.add(gapRing(d.carry, col));
    ovl.visible = false;

    // animated ball + trail
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    ball.visible = false;
    const trailGeom = new THREE.BufferGeometry();
    const TRAIL = 60;
    trailGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const trail = new THREE.Line(
      trailGeom,
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 }),
    );
    trail.visible = false;

    grp.add(shotGrp, tube, mk, ovl, ball, trail);
    if (rollTube) grp.add(rollTube);
    if (restMk) grp.add(restMk);
    root.add(grp);

    objs.push({
      club: d.club,
      color: d.color,
      carry: d.carry,
      total: d.total,
      apex: d.apex,
      n: d.n,
      flightTime: d.flightTime ?? 3.2,
      grp,
      shotGrp,
      tube,
      mk,
      rollTube,
      restMk,
      ovl,
      ball,
      trail,
      flightPts: meanPts.map((p) => p.clone()),
      rollPts: rollPtsClean,
      anim: null,
    });
  });

  return { root, objs };
}

// ---------------------------------------------------------------------------
// Shared mutable view state — read by the render loop, written by UI handlers.
// Kept in a ref so RN re-renders never tear down the GL scene.
// ---------------------------------------------------------------------------
interface ViewState {
  az: number;
  el: number;
  dist: number;
  tgt: THREE.Vector3;
  autoOrbit: boolean;
  tween: { t0: number; ms: number; s: TweenSnap; e: TweenSnap } | null;
  visible: Record<string, boolean>;
  solo: string | null;
  showShots: boolean;
  showMean: boolean;
  showRoll: boolean;
  showOverlay: boolean;
  launchQueue: { club: string; at: number }[];
  flying: number;
}
interface TweenSnap {
  az: number;
  el: number;
  dist: number;
  tx: number;
  ty: number;
  tz: number;
}
interface HudState {
  club: string;
  col: string;
  speed: number;
  text: string;
}
interface LiveStat {
  club: string;
  col: string;
  speed: number;
  cur: number;
  ht: number;
  total: number;
  tRemain: string;
  rolling: boolean;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// animation pacing (mirrors the web)
const TIMESCALE = 1.0;
const MIN_DUR = 300;
const MAX_DUR = 12000;
const ROLL_MS_PER_YD = 26;
const ROLL_MIN_MS = 350;
const ROLL_MAX_MS = 1600;

// ---------------------------------------------------------------------------
// GL scene driver — lives inside <Canvas>, owns the per-frame loop.
// ---------------------------------------------------------------------------
function Scene({
  objs,
  root,
  vs,
  onHud,
  pendingTween,
  pendingLaunch,
}: {
  objs: ClubObj[];
  root: THREE.Group;
  vs: React.MutableRefObject<ViewState>;
  onHud: (h: HudState | null) => void;
  pendingTween: React.MutableRefObject<TweenSnap | null>;
  pendingLaunch: React.MutableRefObject<string[] | null>;
}) {
  const { scene, camera } = useThree();
  const lastHudRef = useRef<string>('');

  // attach scene contents + lights once
  useMemo(() => {
    scene.background = new THREE.Color(0x070d0a);
    scene.fog = new THREE.Fog(0x070d0a, 500, 1300);
    scene.add(root);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dl = new THREE.DirectionalLight(0xffffff, 0.5);
    dl.position.set(100, 300, 200);
    scene.add(dl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyVisibility() {
    const s = vs.current;
    objs.forEach((o) => {
      let vis = s.visible[o.club];
      if (s.solo) vis = o.club === s.solo;
      o.grp.visible = vis;
      o.shotGrp.visible = vis && s.showShots;
      o.tube.visible = vis && s.showMean;
      o.mk.visible = vis && s.showMean;
      if (o.rollTube) o.rollTube.visible = vis && s.showMean && s.showRoll;
      if (o.restMk) o.restMk.visible = vis && s.showMean && s.showRoll;
      o.ovl.visible = vis && s.showOverlay;
    });
  }

  function startFlight(o: ClubObj, now: number) {
    const pts = o.flightPts;
    const ftReal = o.flightTime || 3.2;
    const dur = Math.max(MIN_DUR, Math.min(MAX_DUR, ftReal * 1000 * TIMESCALE));
    o.ball.visible = true;
    o.trail.visible = true;
    (o.ball.material as THREE.MeshBasicMaterial).color.set(o.color);
    vs.current.flying++;
    let roll: THREE.Vector3[] | null = null;
    let rollDur = 0;
    if (o.rollPts && o.rollPts.length >= 2) {
      roll = o.rollPts;
      let gyd = 0;
      for (let i = 1; i < roll.length; i++) {
        const a = roll[i];
        const b = roll[i - 1];
        gyd += Math.hypot(a.x - b.x, a.z - b.z);
      }
      rollDur = Math.max(ROLL_MIN_MS, Math.min(ROLL_MAX_MS, gyd * ROLL_MS_PER_YD));
    }
    o.anim = {
      pts,
      t0: now,
      dur,
      ftReal,
      roll,
      rollDur,
      rollT0: 0,
      phase: 'air',
      trailPos: [],
      lastPos: null,
      lastT: now,
      speed: 0,
    };
  }

  function stepFlights(nowMs: number) {
    let live: LiveStat | null = null;

    objs.forEach((o) => {
      const a = o.anim;
      if (!a) return;
      let pos: THREE.Vector3;
      let u = 1;
      let done = false;
      let rolling = false;
      if (a.phase === 'air') {
        u = (nowMs - a.t0) / a.dur;
        if (u >= 1) u = 1;
        const idx = u * (a.pts.length - 1);
        const i0 = Math.floor(idx);
        const f = idx - i0;
        const p0 = a.pts[Math.min(i0, a.pts.length - 1)];
        const p1 = a.pts[Math.min(i0 + 1, a.pts.length - 1)];
        pos = p0.clone().lerp(p1, f);
        if (u >= 1) {
          if (a.roll) {
            a.phase = 'roll';
            a.rollT0 = nowMs;
          } else done = true;
        }
      } else {
        rolling = true;
        let ru = (nowMs - a.rollT0) / a.rollDur;
        if (ru >= 1) {
          ru = 1;
          done = true;
        }
        const roll = a.roll!;
        const idx = ru * (roll.length - 1);
        const i0 = Math.floor(idx);
        const f = idx - i0;
        const p0 = roll[Math.min(i0, roll.length - 1)];
        const p1 = roll[Math.min(i0 + 1, roll.length - 1)];
        pos = p0.clone().lerp(p1, f);
        u = 1;
      }
      o.ball.position.copy(pos);

      // live ball speed (mph)
      if (a.lastPos) {
        const dxx = pos.x - a.lastPos.x;
        const dzz = pos.z - a.lastPos.z;
        const dyYd = (pos.y - a.lastPos.y) / Hscale / 3;
        const distYd = Math.sqrt(dxx * dxx + dyYd * dyYd + dzz * dzz);
        const dtAnim = (nowMs - a.lastT) / 1000;
        const dtReal = dtAnim / TIMESCALE;
        if (dtReal > 1e-4) {
          const ydPerS = distYd / dtReal;
          const mph = ydPerS * 3 * 0.681818;
          a.speed = a.speed ? a.speed * 0.7 + mph * 0.3 : mph;
        }
      }
      a.lastPos = pos.clone();
      a.lastT = nowMs;

      // trail buffer
      a.trailPos.push(pos.clone());
      if (a.trailPos.length > 60) a.trailPos.shift();
      const arr = (o.trail.geometry.attributes.position as THREE.BufferAttribute)
        .array as Float32Array;
      for (let k = 0; k < 60; k++) {
        const sp = a.trailPos[Math.max(0, a.trailPos.length - 60 + k)] || a.trailPos[0] || pos;
        arr[k * 3] = sp.x;
        arr[k * 3 + 1] = sp.y;
        arr[k * 3 + 2] = sp.z;
      }
      o.trail.geometry.attributes.position.needsUpdate = true;
      o.trail.geometry.setDrawRange(0, Math.min(60, a.trailPos.length));

      live = {
        club: o.club,
        col: o.color,
        speed: Math.round(a.speed),
        cur: Math.round(pos.x),
        ht: Math.round(pos.y / Hscale),
        total: o.total,
        rolling,
        tRemain: rolling ? '0.0' : Math.max(0, a.ftReal * (1 - u)).toFixed(1),
      };

      if (done) {
        o.ball.visible = false;
        o.trail.visible = false;
        o.anim = null;
        vs.current.flying--;
      }
    });

    if (live) {
      const ls: LiveStat = live;
      const text = ls.rolling
        ? `${ls.cur} yd · rolling out · total ${ls.total} yd`
        : `${ls.cur} yd carried · height ${ls.ht} ft · ${ls.tRemain}s to land`;
      const key = `${ls.club}|${ls.speed}|${text}`;
      if (key !== lastHudRef.current) {
        lastHudRef.current = key;
        onHud({ club: ls.club, col: ls.col, speed: ls.speed, text });
      }
    } else if (vs.current.flying <= 0 && lastHudRef.current) {
      lastHudRef.current = '';
      onHud(null);
    }
  }

  useFrame((state) => {
    const s = vs.current;
    const nowMs = state.clock.elapsedTime * 1000;

    // resolve a pending preset tween (UI can't read the GL clock, so it stashes
    // the target snapshot and we time it here against the real elapsed clock).
    if (pendingTween.current) {
      const e = pendingTween.current;
      pendingTween.current = null;
      s.autoOrbit = false;
      s.tween = {
        t0: nowMs,
        ms: 900,
        s: { az: s.az, el: s.el, dist: s.dist, tx: s.tgt.x, ty: s.tgt.y, tz: s.tgt.z },
        e,
      };
    }
    // resolve a pending launch (staggered 140ms apart)
    if (pendingLaunch.current) {
      const clubs = pendingLaunch.current;
      pendingLaunch.current = null;
      s.launchQueue = clubs.map((club, i) => ({ club, at: nowMs + i * 140 }));
    }

    // fire queued launches whose time has come
    if (s.launchQueue.length) {
      const remaining: { club: string; at: number }[] = [];
      s.launchQueue.forEach((q) => {
        if (nowMs >= q.at) {
          const o = objs.find((x) => x.club === q.club);
          if (o) startFlight(o, nowMs);
        } else remaining.push(q);
      });
      s.launchQueue = remaining;
    }

    // camera tween / auto-orbit
    if (s.tween) {
      let u = (nowMs - s.tween.t0) / s.tween.ms;
      if (u >= 1) u = 1;
      const k = ease(u);
      const a = s.tween.s;
      const b = s.tween.e;
      s.az = a.az + (b.az - a.az) * k;
      s.el = a.el + (b.el - a.el) * k;
      s.dist = a.dist + (b.dist - a.dist) * k;
      s.tgt.set(a.tx + (b.tx - a.tx) * k, a.ty + (b.ty - a.ty) * k, a.tz + (b.tz - a.tz) * k);
      if (u >= 1) s.tween = null;
    } else if (s.autoOrbit) {
      s.az += 0.0022;
    }

    // position camera from spherical coords
    camera.position.set(
      s.tgt.x + s.dist * Math.cos(s.el) * Math.sin(s.az),
      s.tgt.y + s.dist * Math.sin(s.el),
      s.tgt.z + s.dist * Math.cos(s.el) * Math.cos(s.az),
    );
    camera.lookAt(s.tgt);

    applyVisibility();
    stepFlights(nowMs);
  });

  return null;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export default function Flight3D() {
  const { root, objs } = useMemo(() => buildScene(CLUBS as ClubData[]), []);

  const vs = useRef<ViewState>({
    az: -0.7,
    el: 0.42,
    dist: 400,
    tgt: vec(150, 22, 0).clone(),
    autoOrbit: false,
    tween: null,
    visible: Object.fromEntries(objs.map((o) => [o.club, true])),
    solo: null,
    showShots: true,
    showMean: true,
    showRoll: false,
    showOverlay: false,
    launchQueue: [],
    flying: 0,
  });

  // bridges from UI handlers (no GL clock access) into the render loop
  const pendingTween = useRef<TweenSnap | null>(null);
  const pendingLaunch = useRef<string[] | null>(null);

  // React state mirrors so the overlay UI re-renders; vs is GL source of truth.
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const [hud, setHud] = useState<HudState | null>(null);
  const [cam, setCam] = useState<string>('free');

  const gestureBase = useRef({ az: 0, el: 0, dist: 0 });
  const pan = Gesture.Pan()
    .onStart(() => {
      vs.current.autoOrbit = false;
      vs.current.tween = null;
      gestureBase.current.az = vs.current.az;
      gestureBase.current.el = vs.current.el;
      setCam('free');
    })
    .onUpdate((e) => {
      const s = vs.current;
      s.az = gestureBase.current.az - e.translationX * 0.006;
      s.el = Math.max(0.05, Math.min(1.49, gestureBase.current.el + e.translationY * 0.006));
    })
    .runOnJS(true);
  const pinch = Gesture.Pinch()
    .onStart(() => {
      vs.current.autoOrbit = false;
      vs.current.tween = null;
      gestureBase.current.dist = vs.current.dist;
    })
    .onUpdate((e) => {
      const scale = e.scale > 0.01 ? e.scale : 1;
      vs.current.dist = Math.max(60, Math.min(1400, gestureBase.current.dist / scale));
    })
    .runOnJS(true);
  const gesture = Gesture.Simultaneous(pan, pinch);

  function applyPreset(name: string) {
    setCam(name);
    if (name === 'free') {
      vs.current.tween = null;
      return;
    }
    const p = PRESETS[name];
    if (!p) return;
    pendingTween.current = {
      az: p.az,
      el: p.el,
      dist: p.dist,
      tx: p.tgt.x,
      ty: p.tgt.y,
      tz: p.tgt.z,
    };
  }

  function toggleClub(club: string) {
    vs.current.visible[club] = !vs.current.visible[club];
    rerender();
  }
  function soloClub(club: string) {
    vs.current.solo = vs.current.solo === club ? null : club;
    rerender();
  }
  function setGroup(filter: (club: string) => boolean) {
    vs.current.solo = null;
    objs.forEach((o) => {
      vs.current.visible[o.club] = filter(o.club);
    });
    rerender();
  }
  function toggle(key: 'showShots' | 'showMean' | 'showRoll' | 'showOverlay' | 'autoOrbit') {
    vs.current[key] = !vs.current[key];
    if (key === 'autoOrbit' && vs.current.autoOrbit) {
      vs.current.tween = null;
      setCam('free');
    }
    rerender();
  }
  function launch() {
    const s = vs.current;
    const fire = objs.filter((o) => (s.solo ? o.club === s.solo : s.visible[o.club]));
    if (!fire.length) return;
    pendingLaunch.current = fire.map((o) => o.club);
  }

  const s = vs.current;

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.canvasWrap}>
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill}>
            <Canvas
              gl={{ antialias: true }}
              camera={{ fov: 45, near: 1, far: 5000, position: [200, 120, 200] }}
              style={styles.canvas}>
              <Scene
                objs={objs}
                root={root}
                vs={vs}
                onHud={setHud}
                pendingTween={pendingTween}
                pendingLaunch={pendingLaunch}
              />
            </Canvas>
          </View>
        </GestureDetector>

        <View style={styles.tag} pointerEvents="none">
          <Text style={styles.tagText}>
            PHYSICS SIM · {objs.reduce((a, o) => a + o.n, 0)} SHOTS
          </Text>
        </View>

        {hud && (
          <View style={styles.hud} pointerEvents="none">
            <Text style={[styles.hudClub, { color: hud.col }]}>{hud.club}</Text>
            <Text style={styles.hudBig}>
              {hud.speed}
              <Text style={styles.hudUnit}> mph</Text>
            </Text>
            <Text style={styles.hudSub}>{hud.text}</Text>
          </View>
        )}

        <View style={styles.cambar} pointerEvents="box-none">
          <Text style={styles.camlbl}>VIEW</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cambarRow}>
            {CAM_BUTTONS.map((b) => (
              <Pressable
                key={b.key}
                onPress={() => applyPreset(b.key)}
                style={[styles.gb, cam === b.key && styles.gbOn]}>
                <Text style={[styles.gbText, cam === b.key && styles.gbTextOn]}>{b.label}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => toggle('autoOrbit')}
              style={[styles.gb, s.autoOrbit && styles.gbOn]}>
              <Text style={[styles.gbText, s.autoOrbit && styles.gbTextOn]}>Auto-orbit</Text>
            </Pressable>
          </ScrollView>
        </View>

        <View style={styles.launchbar} pointerEvents="box-none">
          <Pressable
            onPress={() => toggle('showOverlay')}
            style={[styles.gb, s.showOverlay && styles.gbOn]}>
            <Text style={[styles.gbText, s.showOverlay && styles.gbTextOn]}>Landing zones</Text>
          </Pressable>
          <Pressable onPress={launch} style={styles.fire}>
            <Text style={styles.fireText}>▶ LAUNCH</Text>
          </Pressable>
        </View>

        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>drag orbit · pinch zoom · Launch to fire</Text>
        </View>
      </View>

      {/* bottom control panel: toggles + club list */}
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <Text style={styles.h1}>
          SHOT <Text style={styles.h1Accent}>DISPERSION</Text>
        </Text>
        <Text style={styles.h1Sub}>3D BALL FLIGHT · FITTED TO YOUR DATA</Text>

        <View style={styles.togRow}>
          <PanelBtn label="Show shots" on={s.showShots} onPress={() => toggle('showShots')} grow />
          <PanelBtn label="Show mean" on={s.showMean} onPress={() => toggle('showMean')} grow />
          <PanelBtn label="Roll-out" on={s.showRoll} onPress={() => toggle('showRoll')} grow />
        </View>

        <View style={styles.globRow}>
          <PanelBtn label="All" on={false} onPress={() => setGroup(() => true)} />
          <PanelBtn label="None" on={false} onPress={() => setGroup(() => false)} />
          <PanelBtn label="Irons" on={false} onPress={() => setGroup((c) => /Iron/.test(c))} />
          <PanelBtn label="Wedges" on={false} onPress={() => setGroup((c) => /Wedge/.test(c))} />
        </View>

        <View style={styles.list}>
          {objs.map((o) => {
            const isVis = s.visible[o.club];
            const isSolo = s.solo === o.club;
            return (
              <View
                key={o.club}
                style={[styles.listRow, isSolo && styles.listRowSel, !isVis && styles.listRowOff]}>
                <Pressable onPress={() => toggleClub(o.club)} hitSlop={6}>
                  <View style={[styles.dot, { backgroundColor: o.color, shadowColor: o.color }]} />
                </Pressable>
                <Pressable style={styles.rowNameWrap} onPress={() => soloClub(o.club)}>
                  <Text style={styles.rowName}>{o.club}</Text>
                </Pressable>
                <Pressable onPress={() => soloClub(o.club)}>
                  <Text style={styles.rowMeta}>{o.carry}y</Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <Text style={styles.foot}>
          Solid bright line = mean shot. Faint lines = individual shots. Tap a club name to isolate
          it; tap its dot to toggle. Launch animates the ball flight; Landing zones shows 1σ
          dispersion discs + carry rings. Drawn true-to-scale (height and distance use the same
          yard scale, like a real ball flight).
        </Text>
      </ScrollView>
    </GestureHandlerRootView>
  );
}

function PanelBtn({
  label,
  on,
  onPress,
  grow,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  grow?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.pb, on && styles.pbOn, grow && styles.pbGrow]}>
      <Text style={[styles.pbText, on && styles.pbTextOn]}>{label}</Text>
    </Pressable>
  );
}

const mono = 'monospace';
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  canvasWrap: { flex: 1, minHeight: 320, position: 'relative', backgroundColor: C.bg },
  canvas: { flex: 1 },

  tag: { position: 'absolute', top: 12, right: 12 },
  tagText: { fontFamily: mono, fontSize: 9, letterSpacing: 1, color: C.dim2 },

  hud: { position: 'absolute', top: 18, left: 0, right: 0, alignItems: 'center' },
  hudClub: { fontFamily: mono, fontSize: 13, letterSpacing: 1, fontWeight: '600' },
  hudBig: { fontSize: 52, lineHeight: 54, color: '#fff', fontWeight: '800' },
  hudUnit: { fontSize: 18, color: C.dim },
  hudSub: { fontFamily: mono, fontSize: 11, color: C.dim, letterSpacing: 0.5, marginTop: 2 },

  cambar: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 56,
    flexDirection: 'row',
    alignItems: 'center',
  },
  camlbl: { fontFamily: mono, fontSize: 9, letterSpacing: 1, color: C.dim2, marginRight: 6 },
  cambarRow: { gap: 6, alignItems: 'center', paddingRight: 8 },

  launchbar: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 12,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },

  gb: {
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 11,
    backgroundColor: '#0b1410cc',
  },
  gbOn: { borderColor: C.accent, backgroundColor: '#13261b' },
  gbText: {
    fontFamily: mono,
    fontSize: 10,
    letterSpacing: 0.5,
    color: C.dim,
    textTransform: 'uppercase',
  },
  gbTextOn: { color: C.accent },

  fire: {
    borderWidth: 1,
    borderColor: C.accent,
    borderRadius: 24,
    paddingVertical: 9,
    paddingHorizontal: 22,
    backgroundColor: C.accent,
  },
  fireText: { fontSize: 18, fontWeight: '800', letterSpacing: 1.5, color: '#0a120d' },

  hint: { position: 'absolute', left: 8, right: 8, bottom: 96, alignItems: 'center' },
  hintText: { fontFamily: mono, fontSize: 9, color: '#7a948699', letterSpacing: 0.5 },

  panel: { maxHeight: 320, borderTopWidth: 1, borderTopColor: C.line2, backgroundColor: C.panel },
  panelContent: { padding: 14, paddingBottom: 28 },
  h1: { fontSize: 24, fontWeight: '800', color: C.ink, letterSpacing: 0.5 },
  h1Accent: { color: C.accent },
  h1Sub: { fontFamily: mono, fontSize: 10, color: C.dim2, letterSpacing: 0.5, marginTop: 2 },

  togRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  globRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },

  pb: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 3,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: 'transparent',
  },
  pbGrow: { flex: 1, alignItems: 'center' },
  pbOn: { backgroundColor: C.accent, borderColor: C.accent },
  pbText: {
    fontFamily: mono,
    fontSize: 10,
    letterSpacing: 0.4,
    color: C.dim2,
    textTransform: 'uppercase',
  },
  pbTextOn: { color: '#0a120d' },

  list: { marginTop: 12, gap: 2 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  listRowSel: { borderColor: C.line, backgroundColor: '#13201880' },
  listRowOff: { opacity: 0.34 },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    shadowOpacity: 0.9,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  rowNameWrap: { flex: 1 },
  rowName: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: C.ink,
    textTransform: 'uppercase',
  },
  rowMeta: { fontFamily: mono, fontSize: 11, color: C.dim2 },

  foot: { fontFamily: mono, fontSize: 9.5, color: C.dim2, lineHeight: 15, marginTop: 14 },
});
