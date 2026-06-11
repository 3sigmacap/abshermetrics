import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C } from '@/theme';

const mono = 'monospace';

/**
 * Compact club filter used on the 2D and 3D screens. Shows a single summary chip
 * ("8 of 11 clubs ▾") that opens a bottom sheet with a multi-select checklist
 * (tap each club on/off) + All/None presets. No scrolling (all clubs fit) and a
 * safe-area bottom inset so the phone nav bar never covers the last row.
 */
export function ClubMultiSelect({
  clubs,
  visible,
  onToggle,
  onSetAll,
  label = 'CLUBS',
}: {
  clubs: { club: string; color: string }[];
  visible: Record<string, boolean>;
  onToggle: (club: string) => void;
  onSetAll: (on: boolean) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const total = clubs.length;
  const sel = clubs.filter((c) => visible[c.club]).length;
  const summary = sel === total ? `All ${total} clubs` : sel === 0 ? 'No clubs' : `${sel} of ${total} clubs`;

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.summary} onPress={() => setOpen(true)}>
        <Text style={styles.summaryText}>{summary}</Text>
        <Text style={styles.chev}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>Clubs</Text>
          <View style={styles.presets}>
            <TouchableOpacity style={styles.preset} onPress={() => onSetAll(true)}>
              <Text style={styles.presetText}>All</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.preset} onPress={() => onSetAll(false)}>
              <Text style={styles.presetText}>None</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.list}>
            {clubs.map((c) => {
              const on = visible[c.club];
              return (
                <TouchableOpacity key={c.club} style={styles.row} onPress={() => onToggle(c.club)}>
                  <View
                    style={[
                      styles.check,
                      on ? { backgroundColor: c.color, borderColor: c.color } : { borderColor: C.line2 },
                    ]}>
                    {on ? <Text style={styles.checkmark}>✓</Text> : null}
                  </View>
                  <Text style={[styles.rowLabel, { color: on ? C.ink : C.dim }]} numberOfLines={1}>
                    {c.club}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity style={styles.done} onPress={() => setOpen(false)}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: mono, fontSize: 10, letterSpacing: 1, color: C.dim2, marginBottom: 8, textTransform: 'uppercase' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 9, alignSelf: 'flex-start', backgroundColor: C.bg2, borderWidth: 1, borderColor: C.line2, borderRadius: 18, paddingVertical: 9, paddingHorizontal: 14 },
  summaryText: { fontFamily: mono, fontSize: 12, color: C.ink },
  chev: { fontFamily: mono, fontSize: 10, color: C.dim2 },
  backdrop: { flex: 1, backgroundColor: '#000000aa' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '90%', backgroundColor: C.bg2, borderTopWidth: 1, borderColor: C.line2, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 3, backgroundColor: C.line2, marginBottom: 12 },
  title: { fontFamily: mono, fontSize: 11, letterSpacing: 1, color: C.dim2, marginBottom: 12, textTransform: 'uppercase' },
  presets: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  preset: { borderWidth: 1, borderColor: '#2a4a52', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 11 },
  presetText: { fontFamily: mono, fontSize: 11, color: C.accent2 },
  list: { marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9, paddingHorizontal: 4 },
  check: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#0a120d', fontSize: 12, fontWeight: '700' },
  rowLabel: { flex: 1, fontFamily: mono, fontSize: 13 },
  done: { marginTop: 12, alignSelf: 'flex-start', backgroundColor: C.accent2, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 20 },
  doneText: { fontFamily: mono, fontSize: 11, letterSpacing: 1, color: '#0a120d', fontWeight: '600', textTransform: 'uppercase' },
});
