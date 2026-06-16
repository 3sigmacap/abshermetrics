import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { type FollowPerson } from '@/lib/follows';
import { useView } from '@/lib/viewContext';
import { C } from '@/theme';

const label = (p?: { name: string | null; email: string | null } | null) =>
  p?.name || (p?.email || '').split('@')[0] || 'Player';

/** A thin bar above the tabs that lets a follower switch between "My data" and any
 *  player they follow. Renders nothing unless you follow at least one player. Turns
 *  amber + says read-only while spectating someone else. */
export default function ViewBar() {
  const { following, viewedUserId, isViewingOther, setViewedUser } = useView();
  const [open, setOpen] = useState(false);
  if (!following.length) return null;

  const current = following.find((p) => p.id === viewedUserId) ?? null;

  return (
    <>
      <Pressable
        style={[styles.bar, isViewingOther && styles.barOther]}
        onPress={() => setOpen(true)}
        accessibilityRole="button">
        <Text style={[styles.barTxt, isViewingOther && styles.barTxtOther]} numberOfLines={1}>
          {isViewingOther ? `👁  Viewing ${label(current)}’s account · read-only` : '👁  My data'}
        </Text>
        <Text style={[styles.chev, isViewingOther && styles.barTxtOther]}>▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>VIEW ACCOUNT</Text>
            <ScrollView bounces={false}>
              <Row label="My data" active={!isViewingOther} onPress={() => { setViewedUser(null); setOpen(false); }} />
              {following.map((p: FollowPerson) => (
                <Row
                  key={p.id}
                  label={label(p)}
                  sub={p.email ?? ''}
                  active={viewedUserId === p.id}
                  onPress={() => { setViewedUser(p.id); setOpen(false); }}
                />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function Row({ label: l, sub, active, onPress }: { label: string; sub?: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, active && { color: C.accent }]}>👁  {l}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {active ? <Text style={{ color: C.accent }}>✓</Text> : null}
    </Pressable>
  );
}

const mono = 'monospace';
const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: C.bg2,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  barOther: { backgroundColor: '#1a1206', borderBottomColor: '#3a2a0a' },
  barTxt: { flex: 1, color: C.dim, fontFamily: mono, fontSize: 12, letterSpacing: 0.5 },
  barTxtOther: { color: '#ffce6b' },
  chev: { color: C.dim, fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: '#000a', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: '70%' },
  sheetTitle: { fontFamily: mono, fontSize: 11, letterSpacing: 1, color: C.dim2, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#142219' },
  rowLabel: { color: C.ink, fontSize: 16, fontWeight: '600' },
  rowSub: { color: C.dim2, fontFamily: mono, fontSize: 11, marginTop: 2 },
});
