import { useFocusEffect, useNavigation } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { Circle, G, Line, Path, Polygon, Svg } from 'react-native-svg';

import CLUBS, { type ClubData } from '@/data';
import { C } from '@/theme';

/* ------------------------------------------------------------------ *
 * 3D Flight — orthographic 3D (pure react-native-svg).
 *
 * Real orbit/zoom/pan via 3D rotation math (no expo-gl, which crashes on SDK 56
 * New Architecture). Restores the web page's features: show mean / show shots /
 * roll-out, club filters, camera presets, auto-orbit, and the Launch animation
 * (ball flies each visible club's path at real flight time, then bounces + rolls,
 * with a live decelerating-mph HUD). Drawn true-to-scale like the web.
 * ------------------------------------------------------------------ */

const data = CLUBS as ClubData[];
const FT_PER_YD = 3;
const VEXAG = 1.0; // true-to-scale height (orbit to see the arc)
const Hs = VEXAG / FT_PER_YD; // engine height ft -> scene yd
const W = 1000;
const H = 640;
const CENTER = { x: 135, y: 14, z: 0 }; // orbit target (yd)
const ROLL_MS_PER_YD = 26;

// flat [x,y,z,...] (x,z yd; y ft) -> [[x, heightYd, z], ...]
function dec(flat: number[] | undefined, step = 1): number[][] {
  const a: number[][] = [];
  if (!flat) return a;
  for (let i = 0; i < flat.length; i += 3 * step) a.push([flat[i], flat[i + 1] * Hs, flat[i + 2]]);
  const last = flat.length - 3;
  if (last >= 0 && (a.length === 0 || a[a.length - 1][0] !== flat[last]))
    a.push([flat[last], flat[last + 1] * Hs, flat[last + 2]]);
  return a;
}

type View3 = { az: number; el: number; scale: number; ox: number; oy: number };

// rotate (az about vertical Y, el about horizontal X) then orthographic project.
function projector(v: View3) {
  const ca = Math.cos(v.az),
    sa = Math.sin(v.az);
  const ce = Math.cos(v.el),
    se = Math.sin(v.el);
  return (x: number, y: number, z: number): [number, number, number] => {
    const X = x - CENTER.x,
      Y = y - CENTER.y,
      Z = z - CENTER.z;
    const x1 = X * ca + Z * sa;
    const z1 = -X * sa + Z * ca;
    const y2 = Y * ce - z1 * se;
    const z2 = Y * se + z1 * ce;
    return [W / 2 + v.ox + x1 * v.scale, H / 2 + v.oy - y2 * v.scale, z2];
  };
}

const MONO = 'monospace';
const FX1 = 300; // field length (yd)
const FZ = 55; // field half-width (yd)

const PRESETS: Record<string, { az: number; el: number; scale: number }> = {
  free: { az: -0.62, el: 0.34, scale: 2.3 }, // 3/4 angle
  dtl: { az: -Math.PI / 2, el: 0.14, scale: 2.5 }, // down the line (downrange into screen)
  behind: { az: -Math.PI / 2, el: 0.5, scale: 2.3 }, // behind tee, elevated
  top: { az: -0.01, el: 1.5, scale: 2.4 }, // straight down
  side: { az: 0, el: 0.12, scale: 2.4 }, // side profile (downrange across screen)
};
const CAMS = [
  { k: 'free', label: 'Free' },
  { k: 'dtl', label: 'Down-line' },
  { k: 'behind', label: 'Behind' },
  { k: 'top', label: 'Top-down' },
  { k: 'side', label: 'Side-on' },
];

export default function Flight3D() {
  const clubs = useMemo(() => [...data].sort((a, b) => b.carry - a.carry), []);
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;

  // Hide the nav header ("3D" title) in landscape so the plot fills that space.
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ headerShown: !landscape });
  }, [landscape, navigation]);

  // Allow landscape while viewing 3D; restore portrait when leaving the tab.
  useFocusEffect(
    useCallback(() => {
      ScreenOrientation.unlockAsync().catch(() => {});
      return () => {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      };
    }, []),
  );

  const [view, setView] = useState<View3>({ ...PRESETS.free, ox: 0, oy: 30 });
  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(clubs.map((c) => [c.club, true])),
  );
  const [showShots, setShowShots] = useState(true);
  const [showMean, setShowMean] = useState(true);
  const showRoll = true; // always on, no toggle (per request)
  const showZones = false; // landing zones removed from UI (render code kept, dormant)
  const [autoOrbit, setAutoOrbit] = useState(false); // button removed; rotate manually. code kept.
  const [interacting, setInteracting] = useState(false);
  const [cam, setCam] = useState('free');

  // launch animation state
  const [balls, setBalls] = useState<{ x: number; y: number; z: number; color: string }[]>([]);
  const [hud, setHud] = useState<{ club: string; color: string; mph: number; yd: number; ft: number } | null>(null);
  const [launching, setLaunching] = useState(false);

  // ---- gesture start refs ----
  const start = useRef({ az: 0, el: 0, scale: 0, ox: 0, oy: 0 });

  const beginOrbit = useCallback(() => {
    setInteracting(true);
    setView((v) => {
      start.current.az = v.az;
      start.current.el = v.el;
      return v;
    });
  }, []);
  const applyOrbit = useCallback((tx: number, ty: number) => {
    setCam('free');
    setView((v) => ({
      ...v,
      az: start.current.az + tx * 0.006,
      // drag up tilts the view up (was inverted)
      el: Math.max(-0.25, Math.min(1.55, start.current.el + ty * 0.006)),
    }));
  }, []);
  const beginPinch = useCallback(() => {
    setInteracting(true);
    setView((v) => {
      start.current.scale = v.scale;
      return v;
    });
  }, []);
  const applyPinch = useCallback((s: number) => {
    setView((v) => ({ ...v, scale: Math.max(0.8, Math.min(9, start.current.scale * s)) }));
  }, []);
  const beginPan = useCallback(() => {
    setInteracting(true);
    setView((v) => {
      start.current.ox = v.ox;
      start.current.oy = v.oy;
      return v;
    });
  }, []);
  const applyPan = useCallback((tx: number, ty: number) => {
    setView((v) => ({ ...v, ox: start.current.ox + tx, oy: start.current.oy + ty }));
  }, []);
  const endGesture = useCallback(() => setInteracting(false), []);

  const gesture = useMemo(() => {
    const orbit = Gesture.Pan()
      .maxPointers(1)
      .onBegin(() => runOnJS(beginOrbit)())
      .onUpdate((e) => runOnJS(applyOrbit)(e.translationX, e.translationY))
      .onFinalize(() => runOnJS(endGesture)());
    const pan = Gesture.Pan()
      .minPointers(2)
      .onBegin(() => runOnJS(beginPan)())
      .onUpdate((e) => runOnJS(applyPan)(e.translationX, e.translationY))
      .onFinalize(() => runOnJS(endGesture)());
    const pinch = Gesture.Pinch()
      .onBegin(() => runOnJS(beginPinch)())
      .onUpdate((e) => runOnJS(applyPinch)(e.scale))
      .onFinalize(() => runOnJS(endGesture)());
    return Gesture.Simultaneous(pinch, pan, orbit);
  }, [beginOrbit, applyOrbit, beginPan, applyPan, beginPinch, applyPinch, endGesture]);

  // ---- auto-orbit ----
  const rafAuto = useRef<number | null>(null);
  useEffect(() => {
    if (!autoOrbit) {
      if (rafAuto.current) cancelAnimationFrame(rafAuto.current);
      rafAuto.current = null;
      return;
    }
    const tick = () => {
      setView((v) => ({ ...v, az: v.az + 0.0045 }));
      rafAuto.current = requestAnimationFrame(tick);
    };
    rafAuto.current = requestAnimationFrame(tick);
    return () => {
      if (rafAuto.current) cancelAnimationFrame(rafAuto.current);
    };
  }, [autoOrbit]);

  // ---- toggles ----
  const toggle = (club: string) => setVisible((v) => ({ ...v, [club]: !v[club] }));
  const setGroup = (pred: (c: string) => boolean) =>
    setVisible(Object.fromEntries(clubs.map((c) => [c.club, pred(c.club)])));
  const preset = (k: string) => {
    setCam(k);
    setView((v) => ({ ...v, ...PRESETS[k], ox: 0, oy: 30 }));
  };

  // ---- launch animation ----
  const rafLaunch = useRef<number | null>(null);
  const stopLaunch = useCallback(() => {
    if (rafLaunch.current) cancelAnimationFrame(rafLaunch.current);
    rafLaunch.current = null;
    setLaunching(false);
    setBalls([]);
    setHud(null);
  }, []);

  const launch = useCallback(() => {
    const anims = clubs
      .filter((c) => visible[c.club] && c.mean && c.mean.length >= 6)
      .map((c) => {
        const air = dec(c.mean);
        const roll = dec(c.meanRoll);
        const airDur = Math.max(700, Math.min(6000, (c.flightTime || 3.2) * 1000));
        let rollYd = 0;
        if (roll.length > 1) rollYd = Math.abs(roll[roll.length - 1][0] - roll[0][0]);
        const rollDur = roll.length > 1 ? Math.max(250, Math.min(2600, rollYd * ROLL_MS_PER_YD)) : 0;
        return { club: c.club, color: c.color, air, roll, airDur, rollDur, total: airDur + rollDur };
      });
    if (!anims.length) return;
    if (rafLaunch.current) cancelAnimationFrame(rafLaunch.current);
    setLaunching(true);
    let startT = 0;
    const lead = anims.reduce((a, b) => (b.total > a.total ? b : a), anims[0]);
    const lastLead = { x: 0, t: 0, mph: 0, has: false };

    const sample = (pts: number[][], u: number): [number, number, number] => {
      const idx = u * (pts.length - 1);
      const i0 = Math.floor(idx);
      const f = idx - i0;
      const a = pts[i0];
      const b = pts[Math.min(i0 + 1, pts.length - 1)];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    };

    const step = (now: number) => {
      if (!startT) startT = now;
      const t = now - startT;
      const out: { x: number; y: number; z: number; color: string }[] = [];
      let allDone = true;
      for (const an of anims) {
        let pos: [number, number, number];
        if (t < an.airDur) {
          allDone = false;
          pos = sample(an.air, t / an.airDur);
        } else if (an.roll.length > 1 && t < an.total) {
          allDone = false;
          pos = sample(an.roll, (t - an.airDur) / an.rollDur);
        } else {
          const end = an.roll.length > 1 ? an.roll[an.roll.length - 1] : an.air[an.air.length - 1];
          pos = [end[0], end[1], end[2]];
        }
        out.push({ x: pos[0], y: pos[1], z: pos[2], color: an.color });
        if (an === lead) {
          const flying = t < lead.airDur;
          const yd = Math.round(pos[0]);
          const ft = Math.round(pos[1] / Hs);
          let mph = lastLead.mph;
          if (lastLead.has && now > lastLead.t) {
            const dyd = Math.abs(pos[0] - lastLead.x);
            const dtS = (now - lastLead.t) / 1000;
            if (dtS > 0) {
              const inst = (dyd / dtS) * 0.681818; // yd/s -> mph
              mph = lastLead.mph ? lastLead.mph * 0.7 + inst * 0.3 : inst;
            }
          }
          lastLead.x = pos[0];
          lastLead.t = now;
          lastLead.mph = mph;
          lastLead.has = true;
          setHud({ club: lead.club, color: lead.color, mph: Math.round(flying ? mph : 0), yd, ft });
        }
      }
      setBalls(out);
      if (allDone) {
        rafLaunch.current = null;
        setLaunching(false);
        setTimeout(() => {
          setBalls([]);
          setHud(null);
        }, 1400);
        return;
      }
      rafLaunch.current = requestAnimationFrame(step);
    };
    rafLaunch.current = requestAnimationFrame(step);
  }, [clubs, visible]);

  useEffect(() => () => stopLaunch(), [stopLaunch]);

  // ---- scene geometry (recomputed on view / toggles) ----
  const scene = useMemo(() => {
    const pj = projector(view);
    const out: React.ReactNode[] = [];
    let key = 0;
    const k = () => `g${key++}`;
    const xy = (p: [number, number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

    // ground plane
    out.push(
      <Polygon
        key={k()}
        points={`${xy(pj(0, 0, -FZ))} ${xy(pj(FX1, 0, -FZ))} ${xy(pj(FX1, 0, FZ))} ${xy(pj(0, 0, FZ))}`}
        fill="#0f1d15"
        stroke="#1c3325"
        strokeWidth={1}
      />,
    );
    // downrange grid lines + lateral guides
    for (let x = 0; x <= FX1; x += 50) {
      const a = pj(x, 0, -FZ);
      const b = pj(x, 0, FZ);
      out.push(<Line key={k()} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#1b3124" strokeWidth={1} />);
    }
    for (const z of [-40, -20, 0, 20, 40]) {
      const a = pj(0, 0, z);
      const b = pj(FX1, 0, z);
      out.push(
        <Line
          key={k()}
          x1={a[0]}
          y1={a[1]}
          x2={b[0]}
          y2={b[1]}
          stroke={z === 0 ? '#2c4a38' : '#16271d'}
          strokeWidth={1}
        />,
      );
    }
    const tee = pj(0, 0, 0);
    out.push(<Circle key={k()} cx={tee[0]} cy={tee[1]} r={4} fill={C.accent} />);

    const shown = clubs.filter((c) => visible[c.club] && c.mean && c.mean.length >= 6);
    // far-to-near by current depth of landing (rough painter's order)
    const order = shown
      .map((c) => {
        const pts = dec(c.mean);
        const land = pj(pts[pts.length - 1][0], 0, pts[pts.length - 1][2]);
        return { c, depth: land[2] };
      })
      .sort((a, b) => a.depth - b.depth)
      .map((o) => o.c);

    const liteShots = showShots && !interacting && !launching && !autoOrbit;

    order.forEach((c) => {
      // landing zone (1σ disc + carry ring) on the ground
      if (showZones && c.ell) {
        const { cx, cz, rx, rz } = c.ell;
        const ringPts: string[] = [];
        for (let a = 0; a <= 360; a += 18) {
          const r = (a * Math.PI) / 180;
          ringPts.push(xy(pj(cx + rx * Math.cos(r), 0, cz + rz * Math.sin(r))));
        }
        out.push(
          <Polygon key={k()} points={ringPts.join(' ')} fill={c.color} fillOpacity={0.08} stroke={c.color} strokeOpacity={0.4} strokeWidth={1} />,
        );
      }
      // individual shots (faint), only when idle for performance
      if (liteShots && c.shots) {
        c.shots.forEach((f) => {
          const p = dec(f, 2);
          if (p.length < 2) return;
          out.push(
            <Path key={k()} d={'M' + p.map((q) => xy(pj(q[0], q[1], q[2]))).join('L')} fill="none" stroke={c.color} strokeWidth={1} opacity={0.14} />,
          );
        });
      }
      // roll-out path
      if (showRoll && c.meanRoll) {
        const r = dec(c.meanRoll);
        if (r.length > 1) {
          out.push(
            <Path key={k()} d={'M' + r.map((q) => xy(pj(q[0], q[1], q[2]))).join('L')} fill="none" stroke={c.color} strokeWidth={1.6} strokeDasharray="2 5" opacity={0.6} />,
          );
          const rest = r[r.length - 1];
          const rp = pj(rest[0], 0, rest[2]);
          out.push(<Circle key={k()} cx={rp[0]} cy={rp[1]} r={3} fill="none" stroke={c.color} strokeWidth={1.4} opacity={0.7} />);
        }
      }
      // mean path
      if (showMean) {
        const m = dec(c.mean);
        out.push(<Path key={k()} d={'M' + m.map((q) => xy(pj(q[0], q[1], q[2]))).join('L')} fill="none" stroke={c.color} strokeWidth={2.6} />);
        const land = m[m.length - 1];
        const lp = pj(land[0], 0, land[2]);
        out.push(<Circle key={k()} cx={lp[0]} cy={lp[1]} r={4} fill={c.color} />);
      }
    });

    return out;
  }, [view, visible, showShots, showMean, showRoll, showZones, interacting, launching, autoOrbit, clubs]);

  // ball overlay (separate so launch frames don't recompute the scene paths)
  const ballNodes = useMemo(() => {
    if (!balls.length) return null;
    const pj = projector(view);
    return balls.map((b, i) => {
      const p = pj(b.x, b.y, b.z);
      return <Circle key={`b${i}`} cx={p[0]} cy={p[1]} r={4.5} fill="#fff" stroke={b.color} strokeWidth={1.5} />;
    });
  }, [balls, view]);

  const chip = (on: boolean, color?: string) => ({
    borderColor: on ? color || C.accent2 : C.line2,
    backgroundColor: on ? color || C.accent2 : C.bg2,
  });
  const chipTxt = (on: boolean, color?: string) => ({ color: on ? '#0a120d' : color || C.dim });

  const scene3d = (
    <View style={[styles.frame, landscape && styles.frameFill]}>
      <GestureDetector gesture={gesture}>
        <View style={landscape ? styles.sceneFill : styles.sceneAspect}>
          <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%">
            <G>{scene}</G>
            {ballNodes}
          </Svg>
          {hud && (
            <View pointerEvents="none" style={styles.hud}>
              <Text style={[styles.hudClub, { color: hud.color }]}>{hud.club}</Text>
              <Text style={styles.hudBig}>
                {hud.mph}
                <Text style={styles.hudUnit}> mph</Text>
              </Text>
              <Text style={styles.hudSub}>
                {hud.yd} yd carry · {hud.ft} ft high
              </Text>
            </View>
          )}
        </View>
      </GestureDetector>
    </View>
  );

  const controlsContent = (
    <>
      <View style={styles.row}>
        <Pressable onPress={launching ? stopLaunch : launch} style={[styles.btn, styles.fire, { backgroundColor: launching ? C.bad : C.accent }]}>
          <Text style={styles.fireTxt}>{launching ? '■ Stop' : '▶ Launch'}</Text>
        </Pressable>
        <Pressable onPress={() => setShowMean((s) => !s)} style={[styles.btn, chip(showMean)]}>
          <Text style={[styles.btnTxt, chipTxt(showMean)]}>Show mean</Text>
        </Pressable>
        <Pressable onPress={() => setShowShots((s) => !s)} style={[styles.btn, chip(showShots)]}>
          <Text style={[styles.btnTxt, chipTxt(showShots)]}>Show shots</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Pressable onPress={() => setGroup(() => true)} style={[styles.btn, styles.ghost]}>
          <Text style={[styles.btnTxt, { color: C.dim }]}>All</Text>
        </Pressable>
        <Pressable onPress={() => setGroup(() => false)} style={[styles.btn, styles.ghost]}>
          <Text style={[styles.btnTxt, { color: C.dim }]}>None</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        {clubs.map((c) => {
          const on = visible[c.club];
          return (
            <Pressable key={c.club} onPress={() => toggle(c.club)} style={[styles.clubChip, chip(on, c.color)]}>
              <View style={[styles.dot, { backgroundColor: on ? '#0a120d' : c.color }]} />
              <Text style={[styles.clubTxt, chipTxt(on, c.color)]}>{c.club}</Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );

  // Landscape: scene fills the screen, controls in a scrollable side panel.
  if (landscape) {
    return (
      <GestureHandlerRootView style={styles.page}>
        <View style={styles.landRow}>
          {scene3d}
          <ScrollView style={styles.sidePanel} contentContainerStyle={styles.sidePanelInner}>
            {controlsContent}
          </ScrollView>
        </View>
      </GestureHandlerRootView>
    );
  }

  // Portrait: header, scene (aspect), controls below.
  return (
    <GestureHandlerRootView style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>
          Ball <Text style={{ color: C.accent }}>Flight</Text>
        </Text>
        <Text style={styles.hint}>drag · orbit   ·   pinch · zoom   ·   two-finger · pan</Text>
      </View>
      {scene3d}
      <View style={styles.controls}>{controlsContent}</View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  title: { fontSize: 28, fontWeight: '800', color: C.ink, letterSpacing: 0.5 },
  hint: { fontFamily: MONO, fontSize: 10.5, color: C.dim2, marginTop: 2, letterSpacing: 0.5 },
  frame: { marginHorizontal: 12, borderWidth: 1, borderColor: C.line, borderRadius: 12, backgroundColor: '#070f0b', overflow: 'hidden' },
  frameFill: { flex: 1, minWidth: 0, margin: 8 },
  sceneAspect: { width: '100%', aspectRatio: W / H },
  sceneFill: { flex: 1, minHeight: 200 },
  landRow: { flex: 1, flexDirection: 'row' },
  sidePanel: { width: 200, flexGrow: 0, flexShrink: 0, borderLeftWidth: 1, borderLeftColor: C.line },
  sidePanelInner: { padding: 8, paddingBottom: 28, gap: 6 },
  hud: { position: 'absolute', top: 14, left: 0, right: 0, alignItems: 'center' },
  hudClub: { fontFamily: MONO, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  hudBig: { fontFamily: MONO, fontSize: 44, color: '#fff', fontWeight: '800', lineHeight: 46 },
  hudUnit: { fontSize: 16, color: C.dim },
  hudSub: { fontFamily: MONO, fontSize: 11, color: C.dim },
  controls: { paddingHorizontal: 12, paddingTop: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  btn: { borderWidth: 1, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 11 },
  ghost: { borderColor: C.line2, backgroundColor: C.bg2 },
  btnTxt: { fontFamily: MONO, fontSize: 11, fontWeight: '600' },
  fire: { borderWidth: 0 },
  fireTxt: { fontFamily: MONO, fontSize: 12, fontWeight: '800', color: '#0a120d' },
  clubChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 14, paddingVertical: 5, paddingHorizontal: 10 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  clubTxt: { fontFamily: MONO, fontSize: 10.5, fontWeight: '600' },
});
