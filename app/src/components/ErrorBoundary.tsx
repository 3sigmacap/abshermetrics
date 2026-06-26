import { Component, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C } from '@/theme';

interface Props {
  children: ReactNode;
  /** Called when the user taps "Try again" — e.g. to re-fetch data before remounting. */
  onReset?: () => void;
}
interface State {
  error: Error | null;
  /** Bumped on each retry so the recovered subtree remounts fresh (clears any latched state). */
  resetKey: number;
}

/**
 * App-wide error boundary.
 *
 * Before this existed, a render-time exception in ANY screen unmounted the entire React
 * tree and left a dead GREY/BLANK screen that only a full app restart could clear (the
 * symptom users saw after some imports). This catches the error instead and shows a
 * recoverable panel — including the actual error message, so the real cause is visible
 * — with a "Try again" button that re-fetches data and remounts the subtree. Context
 * providers (auth, data, …) live ABOVE this boundary, so they survive a screen crash.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Surface the stack in device/Metro logs so the underlying cause stays diagnosable.
    console.error('[ErrorBoundary] render error:', error, info?.componentStack);
  }

  private reset = () => {
    this.props.onReset?.();
    // Clear the error AND bump the key so the children unmount/remount (not just re-render) —
    // resetting any screen-local state/ref that may have latched the value that crashed.
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  render() {
    const { error, resetKey } = this.state;
    if (!error) {
      return (
        <View key={resetKey} style={styles.host}>
          {this.props.children}
        </View>
      );
    }
    return (
      <View style={styles.wrap}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.kicker}>ABSHERMETRICS</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            This screen hit an unexpected error. Your shots are safe — nothing was lost. Tap
            “Try again” to reload. If it keeps happening, fully close and reopen the app.
          </Text>
          <View style={styles.errBox}>
            <Text style={styles.errText} numberOfLines={6}>
              {error.message || String(error)}
            </Text>
          </View>
          <Pressable style={styles.btn} onPress={this.reset}>
            <Text style={styles.btnText}>Try again</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 4 },
  kicker: { fontFamily: 'monospace', fontSize: 11, letterSpacing: 3, color: C.accent },
  title: { fontSize: 30, fontWeight: '800', color: C.ink, marginTop: 6, marginBottom: 8 },
  body: { fontSize: 15, color: C.dim, lineHeight: 22, marginBottom: 16 },
  errBox: {
    borderWidth: 1,
    borderColor: '#5e2b2b',
    backgroundColor: '#2a1414',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  errText: { fontFamily: 'monospace', fontSize: 12, color: '#ff9d9d' },
  btn: {
    alignSelf: 'flex-start',
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  btnText: { color: '#0a120d', fontWeight: '800', fontSize: 16 },
});
