import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { C } from '@/theme';

/** Temporary screen for pages not yet ported from the web app. */
export default function Placeholder({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children?: React.ReactNode;
}) {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.blurb}>{blurb}</Text>
      <View style={styles.tag}>
        <Text style={styles.tagText}>PORTING FROM WEB APP</Text>
      </View>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, gap: 12 },
  title: { fontSize: 30, fontWeight: '800', color: C.ink, letterSpacing: 0.5 },
  blurb: { fontSize: 15, color: C.dim, lineHeight: 21 },
  tag: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 11,
    marginTop: 2,
  },
  tagText: { fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, color: C.accent2 },
});
