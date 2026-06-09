import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { C } from '@/theme';

/**
 * Small in-screen back affordance for pushed detail screens (Raw Data, The
 * Model). The app has no nav header, so each detail screen renders this at the
 * top of its content to return to wherever it was opened from.
 */
export default function BackBar({ label = 'Back' }: { label?: string }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.back()} hitSlop={12} style={styles.row}>
      <MaterialCommunityIcons name="chevron-left" size={22} color={C.accent} />
      <Text style={styles.txt}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginLeft: -4, marginBottom: 10, paddingVertical: 4 },
  txt: { color: C.accent, fontSize: 15, fontWeight: '600' },
});
