import { StyleSheet, Text, View } from 'react-native';

import Placeholder from '@/components/Placeholder';
import { simulateFlight } from '@/engine';
import { C } from '@/theme';

// Engine self-test: runs the SHARED flight-engine.js natively, proving the
// physics pipeline works in the app exactly as it does on the web. A 7-iron
// mean launch should land ~170 yd carry.
function selfTest() {
  try {
    const r = simulateFlight(
      { ballSpeedMph: 124, launchDeg: 22.6, spinRpm: 7121, axisDeg: 0, directionDeg: 0 },
      { rollout: true },
    );
    return {
      ok: true,
      carry: r.carryYd,
      total: r.totalYd ?? r.carryYd,
      apex: r.apexFt,
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export default function Trends() {
  const t = selfTest();
  return (
    <Placeholder
      title="Trends"
      blurb="Session-over-session changes, the “Why carry changed” attribution panel, and the new session selector are being ported next.">
      <View style={styles.card}>
        <Text style={styles.cardLabel}>ENGINE SELF-TEST · shared flight-engine.js</Text>
        {t.ok ? (
          <>
            <Text style={styles.cardSub}>7-Iron sample · 124 mph / 22.6° / 7121 rpm</Text>
            <Text style={styles.cardValue}>
              carry {t.carry.toFixed(1)} yd · total {t.total.toFixed(1)} yd · apex{' '}
              {t.apex.toFixed(0)} ft
            </Text>
          </>
        ) : (
          <Text style={styles.cardError}>{t.error}</Text>
        )}
      </View>
    </Placeholder>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    padding: 16,
    gap: 6,
    marginTop: 6,
  },
  cardLabel: { fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, color: C.dim2 },
  cardSub: { color: C.dim, fontSize: 14 },
  cardValue: { color: C.accent, fontSize: 17, fontWeight: '600' },
  cardError: { color: C.bad, fontSize: 13, fontFamily: 'monospace' },
});
