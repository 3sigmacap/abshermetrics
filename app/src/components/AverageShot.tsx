import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Circle, G, Line, Path, Rect, Svg, Text as SvgText } from 'react-native-svg';

import { simulateFlight } from '@/engine';
import { C } from '@/theme';

/* Engine-computed average-shot views (side profile + top-down), animated at real
 * flight speed. Mean launch -> simulateFlight -> two SVG views. Self-contained so
 * it can live on the Club Detail screen. */

type Pt = [number, number];

const niceStep = (range: number, target: number): number => {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (p * m >= raw) return p * m;
  return p * 10;
};

export interface LaunchMeans {
  bs: number;
  la: number;
  spin: number;
  axis?: number;
  ld?: number;
}

export default function AverageShot({
  club,
  color,
  launch,
}: {
  club: string;
  color: string;
  launch: LaunchMeans | null;
}) {
  const [side, setSide] = useState<Pt | null>(null);
  const [top, setTop] = useState<Pt | null>(null);

  const result = useMemo(() => {
    if (!launch || !(launch.bs > 0) || !(launch.spin > 0)) return null;
    try {
      const r = simulateFlight(
        {
          ballSpeedMph: launch.bs,
          launchDeg: launch.la,
          spinRpm: launch.spin,
          axisDeg: launch.axis || 0,
          directionDeg: launch.ld || 0,
        },
        { rollout: false },
      );
      if (!r.points || r.points.length < 2) return null;
      return r;
    } catch {
      return null;
    }
  }, [launch]);

  const built = useMemo(() => {
    if (!result) return null;
    const P = result.points;
    const ft = result.flightTime || 3.2;
    const maxX = Math.max(...P.map((p) => p[0]));
    const maxY = Math.max(...P.map((p) => p[1]));

    // --- SIDE VIEW ---
    const SW = 560;
    const SH = 210;
    const sm = { l: 34, r: 14, t: 14, b: 24 };
    const sIW = SW - sm.l - sm.r;
    const sIH = SH - sm.t - sm.b;
    const sx = (x: number) => sm.l + (x / (maxX * 1.02)) * sIW;
    const sy = (y: number) => sm.t + sIH - (y / (maxY * 1.15)) * sIH;
    const sGridLines: { x: number; lab: number }[] = [];
    for (let yd = 50; yd <= maxX; yd += 50) sGridLines.push({ x: sx(yd), lab: yd });
    const sPath = P.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1)).join('');
    const sPts: Pt[] = P.map((p) => [+sx(p[0]).toFixed(1), +sy(p[1]).toFixed(1)]);

    // --- TOP-DOWN (tall column, true 1:1, bottom->top) ---
    const TW = 130;
    const TH = 360;
    const tm = { l: 18, r: 14, t: 14, b: 22 };
    const tPW = TW - tm.l - tm.r;
    const tPH = TH - tm.t - tm.b;
    const xMax = maxX * 1.04;
    let zLo = Math.min(0, ...P.map((p) => p[2]));
    let zHi = Math.max(0, ...P.map((p) => p[2]));
    const zPad = Math.max((zHi - zLo) * 0.1, 2);
    zLo -= zPad;
    zHi += zPad;
    if (zHi - zLo < 8) {
      const c = (zHi + zLo) / 2;
      zLo = c - 4;
      zHi = c + 4;
    }
    const ppy = Math.min(tPH / xMax, tPW / (zHi - zLo));
    const zMid = (zLo + zHi) / 2;
    const ty = (x: number) => tm.t + tPH - x * ppy;
    const tx = (z: number) => tm.l + tPW / 2 + (z - zMid) * ppy;
    const xs = niceStep(xMax, 5);
    const carryLines: { y: number; lab: number }[] = [];
    for (let x = 0; x <= xMax + 0.5; x += xs) carryLines.push({ y: ty(x), lab: Math.round(x) });
    const visZLo = zMid - tPW / 2 / ppy;
    const visZHi = zMid + tPW / 2 / ppy;
    const zStart = Math.ceil(visZLo / xs) * xs;
    const latLines: { x: number; lab: string; zero: boolean }[] = [];
    for (let z = zStart; z <= visZHi + 0.001; z += xs) {
      const gx = tx(z);
      if (gx < tm.l - 0.5 || gx > tm.l + tPW + 0.5) continue;
      const zero = Math.abs(z) < 1e-6;
      const lab = zero ? '0' : z < 0 ? Math.abs(Math.round(z)) + 'L' : Math.round(z) + 'R';
      latLines.push({ x: gx, lab, zero });
    }
    const tPath = P.map((p, i) => (i ? 'L' : 'M') + tx(p[2]).toFixed(1) + ' ' + ty(p[0]).toFixed(1)).join('');
    const tPts: Pt[] = P.map((p) => [+tx(p[2]).toFixed(1), +ty(p[0]).toFixed(1)]);

    return {
      ft,
      SW,
      SH,
      sm,
      sIH,
      sGridLines,
      sPath,
      sPts,
      sStart: [sx(0), sy(0)] as Pt,
      TW,
      TH,
      tm,
      tPW,
      tPH,
      carryLines,
      latLines,
      tPath,
      tPts,
      tStart: [tx(0), ty(0)] as Pt,
    };
  }, [result]);

  useEffect(() => {
    if (!built) {
      setSide(null);
      setTop(null);
      return;
    }
    setSide(built.sStart);
    setTop(built.tStart);
    const FLIGHT_MS = built.ft * 1000;
    const HOLD_MS = 900;
    const LOOP_MS = FLIGHT_MS + HOLD_MS;
    let start: number | null = null;
    let raf = 0;
    const at = (pts: Pt[], u: number): Pt => {
      const idx = u * (pts.length - 1);
      const i0 = Math.floor(idx);
      const f = idx - i0;
      const a = pts[i0];
      const b = pts[Math.min(i0 + 1, pts.length - 1)];
      return [+(a[0] + (b[0] - a[0]) * f).toFixed(1), +(a[1] + (b[1] - a[1]) * f).toFixed(1)];
    };
    const frame = (now: number) => {
      if (start === null) start = now;
      const t = (now - start) % LOOP_MS;
      const u = Math.min(1, t / FLIGHT_MS);
      setSide(at(built.sPts, u));
      setTop(at(built.tPts, u));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [built]);

  if (!result || !built) return null;

  return (
    <View style={styles.panel}>
      <Text style={[styles.h2, { color }]}>{club} — Average Shot</Text>
      <Text style={styles.hint}>
        ENGINE-COMPUTED MEAN TRAJECTORY · SIDE + TOP-DOWN (TRUE 1:1) · REAL-TIME ({built.ft.toFixed(1)}s FLIGHT)
      </Text>
      <View style={styles.flightRow}>
        <View style={[styles.fv, { flex: 1 }]}>
          <Text style={styles.fvLbl}>SIDE VIEW — HEIGHT VS CARRY</Text>
          <Svg viewBox={`0 0 ${built.SW} ${built.SH}`} width="100%" height={140}>
            {built.sGridLines.map((g, i) => (
              <G key={`sg${i}`}>
                <Line x1={g.x} y1={built.sm.t} x2={g.x} y2={built.sm.t + built.sIH} stroke="#142219" />
                <SvgText x={g.x} y={built.SH - 8} fill={C.dim2} fontSize={8.5} fontFamily="monospace" textAnchor="middle">
                  {g.lab}
                </SvgText>
              </G>
            ))}
            <Line
              x1={built.sm.l}
              y1={built.sm.t + built.sIH}
              x2={built.SW - built.sm.r}
              y2={built.sm.t + built.sIH}
              stroke="#23402f"
            />
            <Path d={built.sPath} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" opacity={0.92} />
            {side && <Circle cx={side[0]} cy={side[1]} r={3.4} fill="#fff" />}
          </Svg>
        </View>
        <View style={[styles.fv, styles.fvTop]}>
          <Text style={styles.fvLbl}>TOP DOWN · ←L / R→</Text>
          <Svg viewBox={`0 0 ${built.TW} ${built.TH}`} width={108} height={300}>
            <Rect x={built.tm.l} y={built.tm.t} width={built.tPW} height={built.tPH} fill="#16271d" />
            {built.carryLines.map((g, i) => (
              <G key={`cl${i}`}>
                <Line x1={built.tm.l} y1={g.y} x2={built.TW - built.tm.r} y2={g.y} stroke="#23402f" />
                <SvgText x={built.TW - built.tm.r + 3} y={g.y + 3} fill="#7a9486" fontSize={8} fontFamily="monospace" textAnchor="start">
                  {g.lab}
                </SvgText>
              </G>
            ))}
            {built.latLines.map((g, i) => (
              <G key={`ll${i}`}>
                <Line
                  x1={g.x}
                  y1={built.tm.t}
                  x2={g.x}
                  y2={built.tm.t + built.tPH}
                  stroke={g.zero ? '#39604a' : '#1c3325'}
                  strokeDasharray={g.zero ? undefined : '2 5'}
                />
                <SvgText x={g.x} y={built.TH - 8} fill="#7a9486" fontSize={8} fontFamily="monospace" textAnchor="middle">
                  {g.lab}
                </SvgText>
              </G>
            ))}
            <Circle cx={built.tStart[0]} cy={built.tStart[1]} r={2.6} fill="#d4ff4f" />
            <Path d={built.tPath} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" opacity={0.92} />
            {top && <Circle cx={top[0]} cy={top[1]} r={3.4} fill="#fff" />}
          </Svg>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: '#0b1410', borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14, marginTop: 14 },
  h2: { fontSize: 20, fontWeight: '700', marginBottom: 2 },
  hint: { fontFamily: 'monospace', fontSize: 9, color: C.dim2, letterSpacing: 0.5, marginBottom: 10 },
  flightRow: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  fv: { backgroundColor: '#0b1410', borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 8 },
  fvTop: { alignItems: 'center' },
  fvLbl: { fontFamily: 'monospace', fontSize: 8.5, color: C.dim2, letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' },
});
