import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { C } from '@/theme';

/**
 * The Model — long-form reference page ported from model.html.
 *
 * MathJax/LaTeX cannot render natively, so every equation is rendered as
 * clean Unicode/monospace text inside a styled "formula" box. All section
 * structure, headings, prose, equations, the coefficient table, notes, and
 * the sources panel are reproduced from the source web page.
 */

/* ── building blocks ─────────────────────────────────────────────── */

function Kicker({ children }: { children: React.ReactNode }) {
  return <Text style={s.kicker}>{children}</Text>;
}

function H1({ children }: { children: React.ReactNode }) {
  return <Text style={s.h1}>{children}</Text>;
}

function Lead({ children }: { children: React.ReactNode }) {
  return <Text style={s.lead}>{children}</Text>;
}

function H2({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <Text style={s.h2}>
      <Text style={s.h2n}>{n} </Text>
      {children}
    </Text>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <Text style={s.h3}>{children}</Text>;
}

function P({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <Text style={[s.p, muted && s.pMuted]}>{children}</Text>;
}

/** Inline-code-like emphasis used for `dt = 0.01 s` etc. */
function Code({ children }: { children: React.ReactNode }) {
  return <Text style={s.code}> {children} </Text>;
}

/** Strong, ink-colored inline emphasis. */
function B({ children }: { children: React.ReactNode }) {
  return <Text style={s.bInk}>{children}</Text>;
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <View style={s.ul}>
      {items.map((it, i) => (
        <View key={i} style={s.li}>
          <Text style={s.liArrow}>→</Text>
          <Text style={s.liText}>{it}</Text>
        </View>
      ))}
    </View>
  );
}

/** A styled equation box: caption + one or more monospace formula lines. */
function Eq({ cap, lines }: { cap: string; lines: string[] }) {
  return (
    <View style={s.eq}>
      <Text style={s.eqCap}>{cap}</Text>
      {lines.map((ln, i) => (
        <Text key={i} style={s.eqText}>
          {ln}
        </Text>
      ))}
    </View>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.note}>
      <Text style={s.noteText}>{children}</Text>
    </View>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <View style={s.panel}>{children}</View>;
}

/* ── coefficient table (Reynolds bin -> lift behaviour) ──────────── */

const COEF_ROWS: [string, string][] = [
  ['Re ≤ 0.3', 'no lift (C_l = 0)'],
  ['0.3 – 0.5', 'smoothstep ramp into C_l^50k'],
  ['0.5 – 0.7', 'linear blend across the 50k / 60k / 65k / 70k polynomials'],
  ['Re ≥ 0.7', 'saturating form C_l,max · 16S/(1+16S)'],
];

function CoefTable() {
  return (
    <View style={s.table}>
      <View style={[s.trow, s.thead]}>
        <Text style={[s.th, s.tcA]}>Reynolds bin (×10⁵)</Text>
        <Text style={[s.th, s.tcB]}>Lift behaviour</Text>
      </View>
      {COEF_ROWS.map(([a, b], i) => (
        <View key={i} style={s.trow}>
          <Text style={[s.tdInk, s.tcA]}>{a}</Text>
          <Text style={[s.td, s.tcB]}>{b}</Text>
        </View>
      ))}
    </View>
  );
}

/* ── screen ──────────────────────────────────────────────────────── */

export default function ModelScreen() {
  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <Kicker>THE ENGINE</Kicker>
      <H1>
        From launch numbers to <Text style={s.h1Accent}>ball flight</Text>
      </H1>
      <Lead>
        Your launch monitor measures only the moment of impact — how fast the
        ball leaves, at what angle, and how it spins. Everything you see plotted
        on this site (carry, apex, descent, dispersion, roll-out) is{' '}
        <B>computed from those launch numbers by integrating the physics of flight</B>.
        This page documents exactly how, with the real equations.
      </Lead>

      {/* 01 — inputs */}
      <H2 n="01">What the launch monitor actually measures</H2>
      <P>
        The Garmin Approach R50 reports a set of <B>launch</B> quantities — the
        ball&apos;s state in the first instants after impact:
      </P>
      <Bullets
        items={[
          <>
            <B>Ball speed</B> — how fast the ball is travelling (mph)
          </>,
          <>
            <B>Launch angle</B> — vertical angle of the initial flight (degrees)
          </>,
          <>
            <B>Launch direction</B> — horizontal angle relative to target
            (degrees)
          </>,
          <>
            <B>Backspin &amp; sidespin</B> (or total spin + spin axis) — the spin
            vector (rpm)
          </>,
        ]}
      />
      <P>
        The R50 also reports its own estimate of carry, apex, and total.{' '}
        <B>We do not use those for anything plotted.</B> They appear only on the
        Raw Data page, for reference. Every curve on this site is rebuilt from the
        launch quantities above.
      </P>

      {/* 02 — philosophy */}
      <H2 n="02">Why launch-data-only</H2>
      <P>
        A launch monitor measures launch conditions extremely well but{' '}
        <Text style={s.em}>infers</Text> carry and apex from a short observation
        window. By taking only the directly measured launch state and integrating
        the flight ourselves, every downstream number comes from one transparent,
        reproducible physics model rather than a black box. The trade-off is
        honesty: if the model and the monitor disagree, you can see exactly why,
        in the equations below.
      </P>

      {/* 03 — setup */}
      <H2 n="03">Setting up: air, launch velocity, and spin</H2>
      <P>
        Before any forces act, the model converts launch conditions into vectors
        and folds the atmosphere into two scalars.
      </P>

      <H3>Air density</H3>
      <P>
        Density is computed from temperature, pressure, elevation, and humidity
        (the site uses a fixed standard atmosphere: 70°F, 29.92 inHg, sea level,
        50% RH):
      </P>
      <Eq
        cap="air density (kg/m³), with humidity & elevation correction"
        lines={['ρ = ρ₀ · (273.15 / T_K) · (P·e^(−βh) − 0.3783·φ·(SVP/100)) / P₀']}
      />
      <P muted>
        where ρ₀ = 1.2929 kg/m³, T_K is temperature in kelvin, P barometric
        pressure (mmHg), P₀ = 760 mmHg, β = 1.217×10⁻⁴, h elevation (m), φ
        relative humidity, and SVP the saturation vapor pressure of water.
      </P>

      <H3>The lumped drag scalar</H3>
      <P>
        Rather than carry area and mass through every step, libgolf folds them —
        with density — into a single coefficient c₀ that turns a coefficient and
        speed directly into an acceleration in ft/s²:
      </P>
      <Eq
        cap="lumped aerodynamic constant"
        lines={['c₀ = 0.07182 · ρ_imp · (m_ref / m) · (C / C_ref)²']}
      />
      <P muted>
        ρ_imp is density in lb/ft³, m the ball mass (1.62 oz), C its circumference
        (5.277 in), and m_ref = 5.125 oz, C_ref = 9.125 in are libgolf&apos;s
        reference normalizers.
      </P>

      <H3>Reynolds number reference</H3>
      <P>
        Air viscosity follows Sutherland&apos;s law; a reference Reynolds number
        is taken at 100 mph and then scaled by the instantaneous speed during
        flight:
      </P>
      <Eq
        cap="Sutherland viscosity & reference Reynolds number"
        lines={[
          'μ = (1.512×10⁻⁶ · T_K^1.5) / (T_K + 120)',
          'Re₁₀₀ = (ρ · 44.7 · d) / μ',
        ]}
      />
      <P muted>
        d is the ball diameter in metres. During flight the working Reynolds
        number scales linearly with speed: Re = (v_mph / 100) · Re₁₀₀.
      </P>

      <H3>Launch velocity and spin vectors</H3>
      <P>
        With launch angle θ, direction ψ, and ball speed v₀ (converted to ft/s),
        the initial velocity is
      </P>
      <Eq
        cap="launch velocity vector (ft/s) — x lateral, y downrange, z vertical"
        lines={['v₀ = v₀ · (cosθ·sinψ, cosθ·cosψ, sinθ)']}
      />
      <P>
        and the spin vector is built from backspin ω_b and sidespin ω_s (rpm →
        rad/s):
      </P>
      <Eq
        cap="spin vector (rad/s)"
        lines={[
          'ω = (π/30) · (',
          '    ω_b·cosψ − ω_s·sinθ·sinψ,',
          '    −ω_b·sinψ − ω_s·sinθ·cosψ,',
          '    ω_s·cosθ )',
        ]}
      />

      {/* 04 — forces */}
      <H2 n="04">The forces in flight</H2>
      <P>
        Once airborne, three accelerations act on the ball: gravity, aerodynamic
        drag (opposing motion), and the Magnus force (from spin, perpendicular to
        motion — this is what curves the ball and holds it up).
      </P>

      <H3>Drag</H3>
      <P>
        Drag points opposite the ball&apos;s velocity relative to the air, v_rel
        = v − w (with wind w):
      </P>
      <Eq
        cap="drag acceleration (ft/s²)"
        lines={['a_drag = −c₀ · C_d · ‖v_rel‖ · v_rel']}
      />

      <H3>Magnus (lift)</H3>
      <P>
        The Magnus acceleration is proportional to the lift coefficient and to
        the cross product of spin and velocity — a full 3D treatment, which is
        exactly why sidespin and a tilted spin axis produce slice/hook curvature,
        not just height:
      </P>
      <Eq
        cap="Magnus acceleration (ft/s²)"
        lines={['a_Magnus = c₀ · (C_l / ‖ω‖) · ‖v_rel‖ · (ω × v_rel)']}
      />

      <H3>Total acceleration</H3>
      <Eq
        cap="net acceleration each step"
        lines={['a = a_drag + a_Magnus − g·ẑ,   g = 32.174 ft/s²']}
      />

      <H3>Spin decay</H3>
      <P>Spin bleeds off exponentially in flight with a speed-dependent time constant:</P>
      <Eq
        cap="spin decay per step"
        lines={['τ = r / (λ·v),  λ = 2×10⁻⁵', 'ω ← ω · e^(−Δt/τ)']}
      />

      {/* 05 — coefficients */}
      <H2 n="05">The drag &amp; lift coefficients</H2>
      <P>
        C_d and C_l are not constants — they depend on the Reynolds number Re
        (binned, in units of 10⁵) and the spin ratio S = ω·r / v. These fits
        trace to dimpled-sphere wind-tunnel data (Bearman &amp; Harvey) and a
        Washington State University study (Lyu et al.), as used by Nathan&apos;s
        trajectory calculator.
      </P>

      <H3>Drag coefficient</H3>
      <Eq
        cap="C_d — piecewise in Reynolds, with a spin term"
        lines={[
          '         ⎧ 0.500 + 0.180·S,                          Re ≤ 0.5',
          'C_d  =   ⎨ 0.500 − 0.300·(Re−0.5)/0.5 + 0.180·S,   0.5 < Re < 1.0',
          '         ⎩ 0.200 + 0.180·S,                          Re ≥ 1.0',
        ]}
      />
      <P muted>
        A faster ball (higher Re) has lower drag — the classic &quot;drag
        crisis&quot; of a dimpled sphere — and more spin adds a little drag.
      </P>

      <H3>Lift coefficient</H3>
      <P>
        C_l interpolates between four spin-ratio polynomials keyed to Reynolds
        bins (Re at 50k, 60k, 65k, 70k), capped by a spin-dependent maximum
        C_l,max:
      </P>
      <Eq
        cap="lift polynomials (argument is spin ratio S)"
        lines={[
          'C_l^50k(S) = 0.0472 + 2.848·S − 23.434·S² + 45.485·S³',
          'C_l^60k(S) = 0.3205 − 4.703·S + 14.061·S²',
          'C_l^65k(S) = 0.2667 − 4.000·S + 13.333·S²',
          'C_l^70k(S) = 0.0496 + 0.00211·S + 2.342·S²',
        ]}
      />
      <P>
        Below Re = 0.3 there is no lift; above Re = 0.7 a saturating spin-gain
        form is used; in between the model blends the bracketing polynomials
        linearly. The cap rises with spin ratio:
      </P>
      <Eq
        cap="spin-dependent lift ceiling and high-Re form"
        lines={[
          '              ⎧ 0.268,            S ≤ 0.35',
          'C_l,max(S) =  ⎨ lerp to 0.320,   0.35 < S < 0.50',
          '              ⎩ 0.320,            S ≥ 0.50',
          '',
          'C_l^(Re ≥ 0.7) = C_l,max · 16S / (1 + 16S)',
        ]}
      />

      <CoefTable />

      {/* 06 — integration */}
      <H2 n="06">Integrating the trajectory</H2>
      <P>
        With the forces defined, the ball&apos;s path is advanced in small time
        steps using semi-implicit (symplectic) Euler integration — velocity is
        updated, then position uses the updated terms. The step is
        <Code>dt = 0.01 s</Code>.
      </P>
      <Eq
        cap="per-step update"
        lines={['x ← x + v·Δt + ½·a·Δt²', 'v ← v + a·Δt']}
      />
      <P>
        Each step: decay the spin, recompute Re and S, look up C_d and C_l, form
        the net acceleration, and advance. The loop ends when the ball crosses the
        ground (z ≤ 0); the exact landing point is found by linear interpolation
        across that final step. From the path the model reads off:
      </P>
      <Bullets
        items={[
          <>
            <B>Carry</B> — downrange distance at first landing
          </>,
          <>
            <B>Apex</B> — maximum height reached
          </>,
          <>
            <B>Lateral</B> — sideways deviation at landing (curvature from spin)
          </>,
          <>
            <B>Descent angle</B> — flight-path angle at landing
          </>,
          <>
            <B>Flight time</B> — used to pace the 3D animation in real time
          </>,
        ]}
      />

      {/* 07 — ground */}
      <H2 n="07">Bounce &amp; roll (the roll-out)</H2>
      <P>
        For total distance, the model continues past landing through bounce and
        roll on a fairway-like surface. The bounce uses the Penner (2003) model: a
        spin-and-velocity-dependent coefficient of restitution governs the
        vertical rebound, while the tangential response depends on impact angle.
      </P>
      <Eq
        cap="effective restitution at impact"
        lines={['e_eff = e₀ · (1 − f_spin(ω) · f_vel(v⊥))']}
      />
      <P>
        A steep, energetic impact with high backspin produces the{' '}
        <B>spin-back / check</B> you see on wedges, via a tangential spin-back
        term:
      </P>
      <Eq
        cap="Penner tangential speed after a steep, energetic bounce"
        lines={["v_t' = R_ret · v · sin(α − α_c) − (2·r·ω_back) / 7"]}
      />
      <P muted>
        α is the impact angle, α_c = 15° the surface&apos;s critical angle, R_ret
        a spin-scaled retention factor. Shallow or low-energy impacts instead
        release forward with simple friction. Once the ball is moving slowly
        enough, Coulomb friction rolls it to rest. This is why on the 3D page a
        wedge can roll <Text style={s.em}>backward</Text> while a 3 wood releases
        forward.
      </P>
      <Note>
        <Text>
          <B>Carry</B> (the first landing) does not depend on the ground surface
          at all — only the post-landing roll does. The default surface is a
          typical fairway (restitution 0.40, static/dynamic friction 0.50/0.20,
          firmness 0.80, spin retention 0.75).
        </Text>
      </Note>

      {/* 08 — correction */}
      <H2 n="08">The one place we depart from the library</H2>
      <P>
        Every coefficient above is copied verbatim from the published library.
        There is exactly one addition: a small <B>low-spin drag correction</B>.
        The published C_d fit slightly over-drags in the low-spin-ratio regime
        (long fairway woods and low-spin drivers, S below ~0.20), where measured
        carries ran longer than the unmodified model predicted. We apply a smooth,
        drag-only reduction that fades in below S = 0.20 and saturates at S =
        0.06:
      </P>
      <Eq
        cap="low-spin drag correction (smoothstep ramp on spin ratio)"
        lines={[
          'C_d ← C_d · (1 − 0.16·smoothstep(u))',
          'u = (0.20 − S) / (0.20 − 0.06),   S < 0.20',
        ]}
      />
      <P muted>
        It is drag-only on purpose — adding lift instead fixed the distance but
        ballooned the apex into an unphysical shape. This single change improves
        bag-wide carry accuracy (RMSE ~5.95 → ~4.2 yd) and leaves every club at S
        ≥ 0.20 — the entire 4-iron-through-wedge set — untouched. Setting the gain
        to zero restores the pure library model.
      </P>

      {/* 09 — provenance */}
      <H2 n="09">Sources &amp; provenance</H2>
      <Panel>
        <P>
          The flight engine is a faithful JavaScript port of the aerial, bounce,
          and roll physics in <B>libgolf</B> by Gabriel DiFiore, whose in-air
          aerodynamics are based on the work of <B>Prof. Alan M. Nathan</B>{' '}
          (University of Illinois Urbana-Champaign). The drag and lift coefficient
          fits trace to dimpled-sphere wind-tunnel data (Bearman &amp; Harvey) and
          a Washington State University study (Lyu et al.).
        </P>
        <P muted>
          Coefficients are copied verbatim from libgolf&apos;s
          DefaultAerodynamicModel, DefaultBounceModel, DefaultRollModel,
          physics_constants, ShotPhysicsContext, and DefaultIntegrator — with the
          single documented low-spin drag tweak above. The bounce model follows
          Penner (2003).
        </P>
      </Panel>

      {/* footer */}
      <View style={s.foot}>
        <Text style={s.footText}>ABSHERMETRICS · the model behind every curve</Text>
        <Text style={s.footText}>
          libgolf — <Text style={s.footLink}>github.com/gdifiore/libgolf</Text> ·
          physics after Prof. Alan M. Nathan (U. Illinois)
        </Text>
        <Text style={s.footText}>
          Internal units are feet, ft/s, and rad/s; outputs are converted to
          yards and feet to match the rest of the site.
        </Text>
      </View>
    </ScrollView>
  );
}

/* ── styles ──────────────────────────────────────────────────────── */

const MONO = 'monospace';

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 18, paddingBottom: 80 },

  kicker: {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: 3,
    color: C.accent,
    marginBottom: 6,
  },
  h1: {
    fontSize: 40,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: C.ink,
    marginBottom: 12,
  },
  h1Accent: { color: C.accent },
  lead: {
    fontSize: 17,
    lineHeight: 26,
    fontWeight: '300',
    color: C.dim,
    marginBottom: 8,
  },

  h2: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: C.ink,
    marginTop: 38,
    marginBottom: 4,
  },
  h2n: { color: C.accent, fontSize: 18 },
  h3: {
    fontFamily: MONO,
    fontSize: 12,
    letterSpacing: 1,
    color: C.accent2,
    marginTop: 22,
    marginBottom: 6,
    textTransform: 'uppercase',
    fontWeight: '500',
  },

  p: {
    fontSize: 16,
    lineHeight: 26,
    fontWeight: '300',
    color: C.ink,
    marginVertical: 8,
  },
  pMuted: { color: C.dim },
  bInk: { color: C.ink, fontWeight: '600' },
  em: { fontStyle: 'italic', color: C.ink },
  code: {
    fontFamily: MONO,
    fontSize: 13,
    color: C.accent2,
    backgroundColor: '#0c1812',
  },

  ul: { marginVertical: 8, gap: 5 },
  li: { flexDirection: 'row', alignItems: 'flex-start' },
  liArrow: { color: C.accent, width: 18, fontSize: 15, lineHeight: 24 },
  liText: { flex: 1, fontSize: 15.5, lineHeight: 24, fontWeight: '300', color: C.ink },

  eq: {
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.line,
    borderLeftWidth: 3,
    borderLeftColor: C.accent,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginVertical: 14,
  },
  eqCap: {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: 1,
    color: C.dim2,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  eqText: {
    fontFamily: MONO,
    fontSize: 13,
    lineHeight: 21,
    color: C.ink,
  },

  note: {
    backgroundColor: '#0e1a1466',
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 8,
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginVertical: 14,
  },
  noteText: { fontSize: 14.5, lineHeight: 23, color: C.dim },

  panel: {
    backgroundColor: '#0b1410cc',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginVertical: 16,
  },

  table: { marginVertical: 12 },
  trow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#142219',
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  thead: { borderBottomColor: C.line2 },
  th: {
    fontFamily: MONO,
    fontSize: 9.5,
    letterSpacing: 0.5,
    color: C.dim2,
    textTransform: 'uppercase',
    fontWeight: '500',
  },
  td: { fontFamily: MONO, fontSize: 12.5, lineHeight: 18, color: C.dim },
  tdInk: { fontFamily: MONO, fontSize: 12.5, lineHeight: 18, color: C.ink },
  tcA: { width: 130, paddingRight: 8 },
  tcB: { flex: 1 },

  foot: {
    marginTop: 50,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  footText: {
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 19,
    color: C.dim2,
  },
  footLink: { color: C.accent2 },
});
