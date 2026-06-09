import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Circle, G, Line, Path, Rect, Svg, Text as SvgText } from 'react-native-svg';

import { type ClubData } from '@/data';
import { useClubs } from '@/lib/dataStore';
import { C } from '@/theme';

/* ------------------------------------------------------------------ *
 * 2D Dispersion — port of top-down.html
 *
 * Two SVG views:
 *  - TOP-DOWN bird's-eye, TRUE 1:1 (same px/yd on both axes). Tee at the
 *    bottom-center, carry runs up the page, lateral spreads left/right. The
 *    web orients miss-left at the TOP and miss-right at the BOTTOM of the box;
 *    we keep that exact mapping. Shows each visible club's mean landing path,
 *    landing dot, dispersion ellipse (from ell), and — when toggled —
 *    individual shot paths + landing dots.
 *  - SIDE profile: height (ft) vs carry (yd), independent axes auto-fit to the
 *    visible data (this naturally exaggerates height, as in the web).
 * ------------------------------------------------------------------ */

// Decode a flat [x,y,z, x,y,z, ...] path into [[x,y,z], ...].
function dec(f: number[]): number[][] {
  const a: number[][] = [];
  for (let i = 0; i < f.length; i += 3) a.push([f[i], f[i + 1], f[i + 2]]);
  return a;
}

// Pick a round grid step (~target divisions) — matches the web niceStep().
function niceStep(range: number, target: number): number {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const c = [1, 2, 2.5, 5, 10];
  for (const m of c) if (p * m >= raw) return p * m;
  return p * 10;
}

const MONO = 'monospace';

// View boxes mirror the web (1000-wide; 520 top / 300 side).
const TW = 1000;
const TH = 520;
const TM = { l: 46, r: 16, t: 14, b: 34 };
const SW = 1000;
const SH = 300;
const SM = { l: 46, r: 16, t: 14, b: 28 };

// ------------------------------------------------------------------
// TOP-DOWN renderer
// ------------------------------------------------------------------
function TopDown({
  data,
  visible,
  showShots,
}: {
  data: ClubData[];
  visible: Record<string, boolean>;
  showShots: boolean;
}) {
  const els = useMemo(() => {
    const shown = data.filter((d) => visible[d.club] && d.mean);
    if (!shown.length) return null;

    // Data extent across visible geometry (carry + lateral), matching the web.
    let maxX = 0;
    let minZ = 0;
    let maxZ = 0;
    const consume = (arr: number[]) => {
      const p = dec(arr);
      for (const q of p) {
        if (q[0] > maxX) maxX = q[0];
        if (q[2] < minZ) minZ = q[2];
        if (q[2] > maxZ) maxZ = q[2];
      }
    };
    shown.forEach((d) => {
      consume(d.mean!);
      if (showShots && d.shots) d.shots.forEach(consume);
      // Make sure ellipses are inside the frame even if they extend past paths.
      if (d.ell) {
        const { cz, rz } = d.ell;
        if (cz - rz < minZ) minZ = cz - rz;
        if (cz + rz > maxZ) maxZ = cz + rz;
        if (d.ell.cx + d.ell.rx > maxX) maxX = d.ell.cx + d.ell.rx;
      }
    });

    const xMax = maxX * 1.04;
    const zPad = Math.max((maxZ - minZ) * 0.08, 2);
    let zLo = minZ - zPad;
    let zHi = maxZ + zPad;
    if (zHi - zLo < 8) {
      const c = (zHi + zLo) / 2;
      zLo = c - 4;
      zHi = c + 4;
    }

    const pW = TW - TM.l - TM.r;
    const pH = TH - TM.t - TM.b;
    // TRUE 1:1 — single px-per-yard = whichever axis is the binding constraint.
    const ppy = Math.min(pW / xMax, pH / (zHi - zLo));
    const zMid = (zLo + zHi) / 2;
    const sx = (x: number) => TM.l + x * ppy; // carry -> px
    const sz = (z: number) => TM.t + pH / 2 + (z - zMid) * ppy; // lateral -> px

    const nodes: React.ReactNode[] = [];
    let key = 0;
    const k = () => `t${key++}`;

    // turf
    nodes.push(
      <Rect key={k()} x={TM.l} y={TM.t} width={pW} height={pH} fill="#16271d" />,
    );

    // carry grid (vertical lines + labels)
    const xs = niceStep(xMax, 6);
    for (let x = 0; x <= xMax + 0.5; x += xs) {
      const gx = sx(x);
      nodes.push(
        <Line key={k()} x1={gx} y1={TM.t} x2={gx} y2={TM.t + pH} stroke="#23402f" />,
      );
      nodes.push(
        <SvgText
          key={k()}
          x={gx}
          y={TM.t + pH + 18}
          fill="#7a9486"
          fontFamily={MONO}
          fontSize={11}
          textAnchor="middle">
          {Math.round(x)}
        </SvgText>,
      );
    }

    // lateral grid (horizontal lines) — same step as carry since 1:1.
    const zs = xs;
    const visZLo = zMid - pH / 2 / ppy;
    const visZHi = zMid + pH / 2 / ppy;
    const zStart = Math.ceil(visZLo / zs) * zs;
    for (let z = zStart; z <= visZHi + 0.001; z += zs) {
      const gz = sz(z);
      if (gz < TM.t - 0.5 || gz > TM.t + pH + 0.5) continue;
      const zero = Math.abs(z) < 1e-6;
      nodes.push(
        <Line
          key={k()}
          x1={TM.l}
          y1={gz}
          x2={TW - TM.r}
          y2={gz}
          stroke={zero ? '#39604a' : '#1c3325'}
          strokeDasharray={zero ? undefined : '2 5'}
        />,
      );
      const lab = zero
        ? '0'
        : z < 0
          ? Math.abs(Math.round(z)) + 'L'
          : Math.round(z) + 'R';
      nodes.push(
        <SvgText
          key={k()}
          x={TM.l - 6}
          y={gz + 4}
          fill="#7a9486"
          fontFamily={MONO}
          fontSize={10}
          textAnchor="end">
          {lab}
        </SvgText>,
      );
    }
    if (visZLo < 0 && visZHi > 0) {
      const gz = sz(0);
      nodes.push(
        <Line key={k()} x1={TM.l} y1={gz} x2={TW - TM.r} y2={gz} stroke="#39604a" />,
      );
    }

    // axis caption
    nodes.push(
      <SvgText
        key={k()}
        x={TW / 2}
        y={TH - 4}
        fill="#9db0a5"
        fontFamily={MONO}
        fontSize={11}
        textAnchor="middle">
        {'CARRY (YDS) →    ↑ MISS LEFT  /  MISS RIGHT ↓  —  true 1:1 scale'}
      </SvgText>,
    );

    // tee
    nodes.push(<Circle key={k()} cx={sx(0)} cy={sz(0)} r={3} fill={C.accent} />);

    // per-club geometry
    shown.forEach((d) => {
      // individual shots (faint paths + faint landing dots)
      if (showShots && d.shots) {
        d.shots.forEach((f) => {
          const p = dec(f);
          const dstr = 'M' + p.map((q) => `${sx(q[0]).toFixed(1)},${sz(q[2]).toFixed(1)}`).join('L');
          nodes.push(
            <Path
              key={k()}
              d={dstr}
              fill="none"
              stroke={d.color}
              strokeWidth={1}
              opacity={0.16}
            />,
          );
          const e2 = p[p.length - 1];
          nodes.push(
            <Circle
              key={k()}
              cx={sx(e2[0])}
              cy={sz(e2[2])}
              r={2.2}
              fill={d.color}
              opacity={0.55}
            />,
          );
        });
      }

      // dispersion ellipse (1σ) from ell — true 1:1 so it's drawn as a real
      // ellipse: rx along carry, rz along lateral, both scaled by ppy.
      if (d.ell) {
        const { cx, cz, rx, rz } = d.ell;
        // Approximate an axis-aligned ellipse with a closed cubic-free polygon.
        const seg = 48;
        let path = '';
        for (let i = 0; i <= seg; i++) {
          const a = (i / seg) * Math.PI * 2;
          const ex = cx + Math.cos(a) * rx;
          const ez = cz + Math.sin(a) * rz;
          path += (i === 0 ? 'M' : 'L') + `${sx(ex).toFixed(1)},${sz(ez).toFixed(1)}`;
        }
        path += 'Z';
        nodes.push(
          <Path
            key={k()}
            d={path}
            fill={d.color}
            fillOpacity={0.1}
            stroke={d.color}
            strokeWidth={1.2}
            strokeOpacity={0.8}
            strokeDasharray="4 4"
          />,
        );
      }

      // mean path + landing dot
      const mp = dec(d.mean!);
      const md = 'M' + mp.map((q) => `${sx(q[0]).toFixed(1)},${sz(q[2]).toFixed(1)}`).join('L');
      nodes.push(
        <Path key={k()} d={md} fill="none" stroke={d.color} strokeWidth={2.2} />,
      );
      const ml = mp[mp.length - 1];
      nodes.push(
        <Circle
          key={k()}
          cx={sx(ml[0])}
          cy={sz(ml[2])}
          r={4}
          fill={d.color}
          stroke="#04100a"
          strokeWidth={1.2}
        />,
      );
    });

    return nodes;
  }, [data, visible, showShots]);

  return (
    <ZoomFrame height={300} viewBox={`0 0 ${TW} ${TH}`}>
      <Rect x={0} y={0} width={TW} height={TH} fill="#0c1812" />
      {els ?? (
        <SvgText
          x={TW / 2}
          y={TH / 2}
          fill="#7a9486"
          fontFamily={MONO}
          fontSize={13}
          textAnchor="middle">
          Select a club
        </SvgText>
      )}
    </ZoomFrame>
  );
}

// ------------------------------------------------------------------
// SIDE renderer (height ft vs carry yds, independent auto-fit axes)
// ------------------------------------------------------------------
function Side({
  data,
  visible,
  showShots,
}: {
  data: ClubData[];
  visible: Record<string, boolean>;
  showShots: boolean;
}) {
  const els = useMemo(() => {
    const shown = data.filter((d) => visible[d.club] && d.mean);
    if (!shown.length) return null;

    let maxX = 0;
    let maxY = 0;
    const consume = (arr: number[]) => {
      const p = dec(arr);
      for (const q of p) {
        if (q[0] > maxX) maxX = q[0];
        if (q[1] > maxY) maxY = q[1];
      }
    };
    shown.forEach((d) => {
      consume(d.mean!);
      if (showShots && d.shots) d.shots.forEach(consume);
    });

    const sPW = SW - SM.l - SM.r;
    const sPH = SH - SM.t - SM.b;
    const xMax = maxX * 1.04;
    const yMax = maxY * 1.1;
    const ssx = (x: number) => SM.l + (x / xMax) * sPW;
    const ssy = (y: number) => SM.t + sPH - (y / yMax) * sPH;

    const nodes: React.ReactNode[] = [];
    let key = 0;
    const k = () => `s${key++}`;

    nodes.push(
      <Rect
        key={k()}
        x={SM.l}
        y={ssy(0)}
        width={sPW}
        height={SH - ssy(0)}
        fill="#16271d"
      />,
    );

    const xs = niceStep(xMax, 6);
    for (let x = 0; x <= xMax + 0.5; x += xs) {
      const gx = ssx(x);
      nodes.push(
        <Line key={k()} x1={gx} y1={SM.t} x2={gx} y2={ssy(0)} stroke="#23402f" />,
      );
      nodes.push(
        <SvgText
          key={k()}
          x={gx}
          y={ssy(0) + 18}
          fill="#7a9486"
          fontFamily={MONO}
          fontSize={11}
          textAnchor="middle">
          {Math.round(x)}
        </SvgText>,
      );
    }

    const ys = niceStep(yMax, 4);
    for (let y = 0; y <= yMax + 0.5; y += ys) {
      const gy = ssy(y);
      nodes.push(
        <Line
          key={k()}
          x1={SM.l}
          y1={gy}
          x2={SW - SM.r}
          y2={gy}
          stroke="#1c3325"
          strokeDasharray="2 5"
        />,
      );
      nodes.push(
        <SvgText
          key={k()}
          x={SM.l - 6}
          y={gy + 4}
          fill="#7a9486"
          fontFamily={MONO}
          fontSize={10}
          textAnchor="end">
          {Math.round(y)}
        </SvgText>,
      );
    }

    shown.forEach((d) => {
      if (showShots && d.shots) {
        d.shots.forEach((f) => {
          const p = dec(f);
          const dstr =
            'M' + p.map((q) => `${ssx(q[0]).toFixed(1)},${ssy(q[1]).toFixed(1)}`).join('L');
          nodes.push(
            <Path
              key={k()}
              d={dstr}
              fill="none"
              stroke={d.color}
              strokeWidth={1}
              opacity={0.12}
            />,
          );
        });
      }
      const m = dec(d.mean!);
      const md = 'M' + m.map((q) => `${ssx(q[0]).toFixed(1)},${ssy(q[1]).toFixed(1)}`).join('L');
      nodes.push(
        <Path key={k()} d={md} fill="none" stroke={d.color} strokeWidth={2.4} />,
      );
      nodes.push(
        <Circle
          key={k()}
          cx={ssx(m[m.length - 1][0])}
          cy={ssy(0)}
          r={3.2}
          fill={d.color}
          stroke="#04100a"
        />,
      );
    });

    return nodes;
  }, [data, visible, showShots]);

  return (
    <Svg width="100%" height={210} viewBox={`0 0 ${SW} ${SH}`}>
      <Rect x={0} y={0} width={SW} height={SH} fill="#0c1812" />
      {els ?? (
        <SvgText
          x={SW / 2}
          y={SH / 2}
          fill="#7a9486"
          fontFamily={MONO}
          fontSize={13}
          textAnchor="middle">
          Select a club
        </SvgText>
      )}
    </Svg>
  );
}

// ------------------------------------------------------------------
// Pinch-to-zoom + drag-to-pan frame (nice-to-have). Wraps an SVG in a
// transformable Animated.View clipped to a fixed-height stage. Double-tap
// resets. The SVG renders at full resolution; gestures only transform pixels.
// ------------------------------------------------------------------
function ZoomFrame({
  height,
  viewBox,
  children,
}: {
  height: number;
  viewBox: string;
  children: React.ReactNode;
}) {
  const [w, setW] = useState(0);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), 8);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withTiming(1);
      savedScale.value = 1;
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      savedTx.value = 0;
      savedTy.value = 0;
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const aStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  // Self-wrap in GestureHandlerRootView so pinch/pan work regardless of whether
  // the app root provides one (the Tabs root layout here does not). This is a
  // no-op for the static render — the SVG draws correctly even if gestures are
  // never used.
  return (
    <GestureHandlerRootView style={styles.stage}>
      <View style={{ width: '100%', height }} onLayout={onLayout}>
        <GestureDetector gesture={composed}>
          <Animated.View style={[{ width: '100%', height }, aStyle]}>
            {w > 0 ? (
              <Svg width={w} height={height} viewBox={viewBox}>
                {children}
              </Svg>
            ) : null}
          </Animated.View>
        </GestureDetector>
      </View>
    </GestureHandlerRootView>
  );
}

// ------------------------------------------------------------------
// Screen
// ------------------------------------------------------------------
export default function Dispersion() {
  const { clubs: data, loading } = useClubs();

  // Default every club to visible; a club absent from the map is treated as on,
  // so new clubs that arrive from the async hook start visible (matching the
  // old eager-initialized behavior) until the user toggles them off.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const visible = useMemo(() => {
    const v: Record<string, boolean> = {};
    data.forEach((d) => (v[d.club] = overrides[d.club] ?? true));
    return v;
  }, [data, overrides]);

  const [showShots, setShowShots] = useState(true);

  const toggle = (club: string) =>
    setOverrides((p) => ({ ...p, [club]: !(p[club] ?? true) }));
  const setAll = (on: boolean) =>
    setOverrides(() => {
      const v: Record<string, boolean> = {};
      data.forEach((d) => (v[d.club] = on));
      return v;
    });

  if (loading) {
    return (
      <View style={styles.fill}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <View style={styles.fill}>
        <Text style={styles.emptyTitle}>No shots yet</Text>
        <Text style={styles.emptyHint}>
          Upload a session on the Raw tab to get started.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>SIDE PROFILE + TOP-DOWN · TRUE 1:1 SCALE</Text>
      <Text style={styles.title}>
        2D <Text style={styles.titleAccent}>DISPERSION</Text> VIEWS
      </Text>

      {/* club chips */}
      <View style={styles.chips}>
        {data.map((d) => {
          const on = visible[d.club];
          return (
            <Pressable
              key={d.club}
              onPress={() => toggle(d.club)}
              style={[
                styles.chip,
                on
                  ? { backgroundColor: d.color, borderColor: d.color }
                  : { backgroundColor: C.panel, borderColor: C.line },
              ]}>
              <View
                style={[
                  styles.sw,
                  { backgroundColor: on ? '#0a120d' : d.color },
                ]}
              />
              <Text style={[styles.chipText, { color: on ? '#0a120d' : C.dim }]}>
                {d.club}
              </Text>
              <Text style={[styles.chipNum, { color: on ? '#0a120d' : C.dim2 }]}>
                {' '}
                {d.ell ? `${d.ell.rz}y` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* option buttons */}
      <View style={styles.opts}>
        <Pressable
          onPress={() => setShowShots((s) => !s)}
          style={[styles.gb, showShots && styles.gbOn]}>
          <Text style={[styles.gbText, showShots && styles.gbTextOn]}>
            Individual shots
          </Text>
        </Pressable>
        <Pressable onPress={() => setAll(true)} style={styles.gb}>
          <Text style={styles.gbText}>All clubs on</Text>
        </Pressable>
        <Pressable onPress={() => setAll(false)} style={styles.gb}>
          <Text style={styles.gbText}>All clubs off</Text>
        </Pressable>
      </View>

      {/* TOP-DOWN */}
      <Text style={styles.h2}>TOP-DOWN — VIEW FROM DIRECTLY ABOVE (FIT TO DATA)</Text>
      <TopDown data={data} visible={visible} showShots={showShots} />

      {/* SIDE */}
      <Text style={styles.h2}>SIDE VIEW — HEIGHT VS CARRY (HEIGHT EXAGGERATED)</Text>
      <View style={styles.stage}>
        <Side data={data} visible={visible} showShots={showShots} />
      </View>

      <Text style={styles.note}>
        The top-down view is true 1:1 — one yard sideways equals one yard
        downrange, so the spread you see is the real spread. Solid line = mean
        flight path; dashed ellipse = 1σ dispersion (from ell); faint lines =
        individual shots; solid dot = landing point. Pinch to zoom and drag to
        pan the top-down chart; double-tap to reset. (The side view exaggerates
        height for readability.)
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 18, paddingBottom: 48 },

  fill: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: C.ink },
  emptyHint: {
    fontFamily: MONO,
    fontSize: 13,
    color: C.dim,
    marginTop: 8,
    textAlign: 'center',
  },

  kicker: { fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: C.accent },
  title: { fontSize: 38, fontWeight: '800', color: C.ink, marginTop: 8, letterSpacing: 0.5 },
  titleAccent: { color: C.accent },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 3,
    borderWidth: 1,
  },
  sw: { width: 9, height: 9, borderRadius: 5, marginRight: 6 },
  chipText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  chipNum: { fontFamily: MONO, fontSize: 11 },

  opts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 4 },
  gb: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 3,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  gbOn: { backgroundColor: C.accent, borderColor: C.accent },
  gbText: { fontFamily: MONO, fontSize: 10, letterSpacing: 0.4, color: C.dim, textTransform: 'uppercase' },
  gbTextOn: { color: '#0a120d' },

  h2: {
    fontFamily: MONO,
    fontSize: 12,
    color: C.dim,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 6,
  },

  stage: {
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 4,
    overflow: 'hidden',
  },

  note: { fontFamily: MONO, fontSize: 11, color: C.dim, marginTop: 16, lineHeight: 18 },
});
