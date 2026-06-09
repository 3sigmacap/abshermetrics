import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Circle, G, Line, Path, Polygon, Svg, Text as SvgText } from 'react-native-svg';

import CLUBS, { type ClubData } from '@/data';
import { C } from '@/theme';

/* ------------------------------------------------------------------ *
 * 3D Flight — perspective trajectory view (pure react-native-svg).
 *
 * Renders each club's engine trajectory in a one-point perspective seen
 * from behind the tee, slightly elevated: downrange recedes to a vanishing
 * point, lateral spreads left/right and converges with depth, height lifts
 * vertically. This replaces the expo-gl / react-three-fiber scene, which
 * fails to create a GL context on SDK 56's New Architecture (the
 * `__expoSetLogging of undefined` crash). Same data, no native GL.
 * ------------------------------------------------------------------ */

const data = CLUBS as ClubData[];
const FT_PER_YD = 3;

// flat [x,y,z,...] (x,z yd; y ft) -> [[x, heightYd, z], ...]
function dec(flat: number[] | undefined): number[][] {
  const a: number[][] = [];
  if (!flat) return a;
  for (let i = 0; i < flat.length; i += 3) a.push([flat[i], flat[i + 1] / FT_PER_YD, flat[i + 2]]);
  return a;
}

// ---- axonometric (3/4) projection — to scale, height lightly exaggerated ----
// Seen from front-left-above: downrange flies to the RIGHT (and tilts up toward
// the back), height goes UP, lateral is drawn as depth (diagonal). Straight
// shots therefore read as real arcs rather than collapsing to a vertical line.
const W = 1000;
const H = 520;
const SD = 2.7; // px per yard (downrange + lateral, true scale)
const HSCALE = 1.8; // vertical height exaggeration for readability
const DDY = -0.17; // downrange tilt (farther = higher on screen)
const LX = 0.34; // lateral -> screenX (depth)
const LY = 0.17; // lateral -> screenY (depth)
const OX = 70; // tee screen x
const OY = 430; // tee screen y
const FX1 = 300; // field length drawn (yd)
const FZ = 55; // field half-width drawn (yd)

function proj(x: number, yYd: number, z: number): [number, number] {
  const sx = OX + x * SD + z * SD * LX;
  const sy = OY + x * SD * DDY - yYd * SD * HSCALE + z * SD * LY;
  return [sx, sy];
}
const P = (x: number, yYd: number, z: number) => {
  const [sx, sy] = proj(x, yYd, z);
  return `${sx.toFixed(1)},${sy.toFixed(1)}`;
};
const pathOf = (pts: number[][]) => 'M' + pts.map((q) => P(q[0], q[1], q[2])).join('L');

const MONO = 'monospace';

function Scene({ visible, rollout }: { visible: Record<string, boolean>; rollout: boolean }) {
  const nodes = useMemo(() => {
    const out: React.ReactNode[] = [];
    let key = 0;
    const k = () => `s${key++}`;

    // ground plane (trapezoid receding to the horizon)
    out.push(
      <Polygon
        key={k()}
        points={`${P(0, 0, -FZ)} ${P(FX1, 0, -FZ)} ${P(FX1, 0, FZ)} ${P(0, 0, FZ)}`}
        fill="#102018"
        stroke="#1c3325"
        strokeWidth={1}
      />,
    );

    // downrange yard lines (constant x, span lateral) + labels
    for (let x = 50; x <= FX1; x += 50) {
      out.push(
        <Line
          key={k()}
          x1={proj(x, 0, -FZ)[0]}
          y1={proj(x, 0, -FZ)[1]}
          x2={proj(x, 0, FZ)[0]}
          y2={proj(x, 0, FZ)[1]}
          stroke="#1c3325"
          strokeWidth={1}
        />,
      );
      const [lx, ly] = proj(x, 0, FZ);
      out.push(
        <SvgText key={k()} x={lx + 6} y={ly + 4} fill="#5e7568" fontFamily={MONO} fontSize={11}>
          {x}
        </SvgText>,
      );
    }
    // lateral guide lines (z = -20, 0, +20) tee -> far
    for (const z of [-20, 0, 20]) {
      out.push(
        <Line
          key={k()}
          x1={proj(0, 0, z)[0]}
          y1={proj(0, 0, z)[1]}
          x2={proj(FX1, 0, z)[0]}
          y2={proj(FX1, 0, z)[1]}
          stroke={z === 0 ? '#2c4a38' : '#16271d'}
          strokeWidth={1}
          strokeDasharray={z === 0 ? undefined : '3 7'}
        />,
      );
    }

    // tee marker
    out.push(<Circle key={k()} cx={proj(0, 0, 0)[0]} cy={proj(0, 0, 0)[1]} r={4} fill={C.accent} />);

    const shown = data.filter((d) => visible[d.club] && d.mean && d.mean.length >= 6);

    // roll-out paths first (under the arcs), if toggled
    if (rollout) {
      shown.forEach((d) => {
        const roll = dec(d.meanRoll);
        if (roll.length < 2) return;
        out.push(
          <Path
            key={k()}
            d={pathOf(roll)}
            fill="none"
            stroke={d.color}
            strokeWidth={2}
            strokeDasharray="2 5"
            opacity={0.5}
          />,
        );
        const rest = roll[roll.length - 1];
        out.push(
          <Circle
            key={k()}
            cx={proj(rest[0], 0, rest[2])[0]}
            cy={proj(rest[0], 0, rest[2])[1]}
            r={3}
            fill="none"
            stroke={d.color}
            strokeWidth={1.5}
            opacity={0.7}
          />,
        );
      });
    }

    // aerial arcs + landing dots (draw far clubs behind near ones by carry desc)
    [...shown]
      .sort((a, b) => b.carry - a.carry)
      .forEach((d) => {
        const pts = dec(d.mean);
        out.push(
          <Path key={k()} d={pathOf(pts)} fill="none" stroke={d.color} strokeWidth={2.6} />,
        );
        const land = pts[pts.length - 1];
        const [lx, ly] = proj(land[0], 0, land[2]);
        // drop line from apex-end to ground for depth cue
        out.push(
          <Circle key={k()} cx={lx} cy={ly} r={4} fill={d.color} />,
        );
      });

    return out;
  }, [visible, rollout]);

  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={undefined} style={styles.svg}>
      {nodes}
    </Svg>
  );
}

export default function Flight3D() {
  const clubs = useMemo(() => [...data].sort((a, b) => b.carry - a.carry), []);
  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(clubs.map((c) => [c.club, true])),
  );
  const [rollout, setRollout] = useState(false);

  const toggle = (club: string) => setVisible((v) => ({ ...v, [club]: !v[club] }));
  const setAll = (on: boolean) =>
    setVisible(Object.fromEntries(clubs.map((c) => [c.club, on])));

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>3/4 VIEW · TO SCALE</Text>
      <Text style={styles.title}>
        Ball <Text style={{ color: C.accent }}>Flight</Text>
      </Text>
      <Text style={styles.lead}>
        Every club&apos;s engine trajectory in one angled view — flying downrange to the right,
        height up, lateral spread shown as depth. Drawn to scale (height eased up a touch for
        readability).
      </Text>

      {/* controls */}
      <View style={styles.chips}>
        {clubs.map((c) => {
          const on = visible[c.club];
          return (
            <Pressable
              key={c.club}
              onPress={() => toggle(c.club)}
              style={[
                styles.chip,
                { borderColor: on ? c.color : C.line2, backgroundColor: on ? c.color : C.bg2 },
              ]}>
              <View
                style={[styles.dot, { backgroundColor: on ? '#0a120d' : c.color }]}
              />
              <Text style={[styles.chipText, { color: on ? '#0a120d' : C.dim }]}>{c.club}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.chips}>
        <Pressable
          onPress={() => setRollout((r) => !r)}
          style={[
            styles.chip,
            { borderColor: rollout ? C.accent2 : C.line2, backgroundColor: rollout ? C.accent2 : C.bg2 },
          ]}>
          <Text style={[styles.chipText, { color: rollout ? '#0a120d' : C.accent2 }]}>
            Roll-out
          </Text>
        </Pressable>
        <Pressable onPress={() => setAll(true)} style={[styles.chip, styles.ghost]}>
          <Text style={[styles.chipText, { color: C.dim }]}>All clubs on</Text>
        </Pressable>
        <Pressable onPress={() => setAll(false)} style={[styles.chip, styles.ghost]}>
          <Text style={[styles.chipText, { color: C.dim }]}>All clubs off</Text>
        </Pressable>
      </View>

      <View style={styles.frame}>
        <Scene visible={visible} rollout={rollout} />
      </View>

      <Text style={styles.note}>
        Axonometric (3/4) view of the engine&apos;s mean trajectories. Dashed lines + hollow markers
        (with Roll-out on) trace the bounce &amp; roll to rest. Downrange and lateral are true 1:1;
        height is exaggerated ~1.8× so the flat, penetrating shots stay readable.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 18, paddingBottom: 40 },
  kicker: { fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: C.accent },
  title: { fontSize: 34, fontWeight: '800', color: C.ink, marginTop: 8, letterSpacing: 0.5 },
  lead: { fontSize: 15, color: C.dim, marginTop: 8, lineHeight: 21 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  ghost: { borderColor: C.line2, backgroundColor: C.bg2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontFamily: MONO, fontSize: 11, fontWeight: '600' },
  frame: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    backgroundColor: '#070f0b',
    overflow: 'hidden',
  },
  svg: { width: '100%', aspectRatio: W / H },
  note: { fontFamily: MONO, fontSize: 11, color: C.dim2, marginTop: 14, lineHeight: 18 },
});
