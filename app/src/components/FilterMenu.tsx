import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C } from '@/theme';

const mono = 'monospace';

export interface FilterItem {
  key: string;
  label: string;
  color: string;
}

/**
 * Compact multi-select filter (same pattern as the 2D/3D club picker, ClubMultiSelect,
 * but generic so clubs AND sessions can both use it). Shows a single summary chip
 * ("8 of 13 sessions ▾") that opens a bottom sheet with a scrollable checklist + All/None
 * presets — so a long filter list takes ONE line instead of filling the screen with chips.
 */
export function FilterMenu({
  label,
  title,
  noun,
  items,
  isOn,
  onToggle,
  onSetAll,
}: {
  label: string;
  title: string;
  noun: string;
  items: FilterItem[];
  isOn: (key: string) => boolean;
  onToggle: (key: string) => void;
  onSetAll: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const total = items.length;
  const sel = items.filter((it) => isOn(it.key)).length;
  const summary =
    total === 0
      ? `No ${noun}`
      : sel === total
        ? `All ${total} ${noun}`
        : sel === 0
          ? `No ${noun}`
          : `${sel} of ${total} ${noun}`;

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.summary} onPress={() => setOpen(true)}>
        <Text style={styles.summaryText} numberOfLines={1}>
          {summary}
        </Text>
        <Text style={styles.chev}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>
          <View style={styles.presets}>
            <TouchableOpacity style={styles.preset} onPress={() => onSetAll(true)}>
              <Text style={styles.presetText}>All</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.preset} onPress={() => onSetAll(false)}>
              <Text style={styles.presetText}>None</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.listScroll} showsVerticalScrollIndicator>
            {items.map((it) => {
              const on = isOn(it.key);
              return (
                <TouchableOpacity key={it.key} style={styles.row} onPress={() => onToggle(it.key)}>
                  <View
                    style={[
                      styles.check,
                      on ? { backgroundColor: it.color, borderColor: it.color } : { borderColor: C.line2 },
                    ]}>
                    {on ? <Text style={styles.checkmark}>✓</Text> : null}
                  </View>
                  <Text style={[styles.rowLabel, { color: on ? C.ink : C.dim }]} numberOfLines={1}>
                    {it.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
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
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    alignSelf: 'flex-start',
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 18,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  summaryText: { fontFamily: mono, fontSize: 12, color: C.ink },
  chev: { fontFamily: mono, fontSize: 10, color: C.dim2 },
  backdrop: { flex: 1, backgroundColor: '#000000aa' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
    backgroundColor: C.bg2,
    borderTopWidth: 1,
    borderColor: C.line2,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
  },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 3, backgroundColor: C.line2, marginBottom: 12 },
  title: { fontFamily: mono, fontSize: 11, letterSpacing: 1, color: C.dim2, marginBottom: 12, textTransform: 'uppercase' },
  presets: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  preset: { borderWidth: 1, borderColor: '#2a4a52', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 11 },
  presetText: { fontFamily: mono, fontSize: 11, color: C.accent2 },
  listScroll: { flexGrow: 0, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9, paddingHorizontal: 4 },
  check: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#0a120d', fontSize: 12, fontWeight: '700' },
  rowLabel: { flex: 1, fontFamily: mono, fontSize: 13 },
  done: { marginTop: 12, alignSelf: 'flex-start', backgroundColor: C.accent2, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 20 },
  doneText: { fontFamily: mono, fontSize: 11, letterSpacing: 1, color: '#0a120d', fontWeight: '600', textTransform: 'uppercase' },
});
