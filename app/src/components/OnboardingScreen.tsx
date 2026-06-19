import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import Bounded from '@/components/Bounded';
import { useFollows } from '@/lib/follows';
import { useProfile } from '@/lib/profile';
import { C } from '@/theme';

/**
 * First-run prompt shown once, the first time a user enters the app (any signup
 * method). Replaces the old "track vs follow" choice that lived on the signup form.
 * Gated by profiles.onboarded (see _layout OnboardingOverlay). Faithful peer of the
 * web onboarding.js.
 */
export default function OnboardingScreen() {
  const { completeOnboarding } = useProfile();
  const foll = useFollows();
  const [choice, setChoice] = useState<'track' | 'follow'>('track');
  const [followEmail, setFollowEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const go = async () => {
    setError(null);
    setNotice(null);
    if (choice === 'track') {
      setBusy(true);
      await completeOnboarding();
      // Overlay unmounts when onboarded flips true.
      return;
    }
    // follow
    const email = followEmail.trim();
    if (!email) {
      setError('Enter the player’s email — or pick “Track my game”.');
      return;
    }
    setBusy(true);
    const res = await foll.request(email);
    if (res.error) {
      setError('Couldn’t send the request: ' + res.error);
      setBusy(false);
      return;
    }
    if (res.status === 'not_found') {
      setError('No account uses that email yet. You can invite them later from Settings → Followers.');
      setBusy(false);
      return;
    }
    // requested / already / self → onboarding is done either way.
    setNotice(
      res.status === 'self'
        ? 'That was your own email — taking you in…'
        : 'Request sent! They’ll get a prompt to approve.',
    );
    await completeOnboarding();
  };

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Bounded>
        <Text style={styles.brand}>
          ABSHER<Text style={{ color: C.accent }}>METRICS</Text>
        </Text>
        <Text style={styles.sub}>How do you want to use the app?</Text>
        <Text style={styles.hint}>You can change this anytime in Settings.</Text>

        <Pressable
          style={[styles.choice, choice === 'track' && styles.choiceOn]}
          onPress={() => {
            setChoice('track');
            setError(null);
          }}>
          <Text style={styles.choiceTitle}>Track my game</Text>
          <Text style={styles.choiceDesc}>Upload your launch-monitor data and analyze your own shots.</Text>
        </Pressable>

        <Pressable
          style={[styles.choice, choice === 'follow' && styles.choiceOn]}
          onPress={() => {
            setChoice('follow');
            setError(null);
          }}>
          <Text style={styles.choiceTitle}>Follow a player</Text>
          <Text style={styles.choiceDesc}>Watch another player’s account read-only — once they approve.</Text>
        </Pressable>

        {choice === 'follow' ? (
          <>
            <Text style={styles.label}>PLAYER’S EMAIL TO FOLLOW</Text>
            <TextInput
              style={styles.input}
              value={followEmail}
              onChangeText={setFollowEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="player@example.com"
              placeholderTextColor={C.dim2}
              inputMode="email"
              onSubmitEditing={go}
              returnKeyType="go"
            />
          </>
        ) : null}

        {error ? <Text style={styles.err}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <Pressable onPress={go} disabled={busy} style={[styles.btn, busy && { opacity: 0.7 }]}>
          {busy ? (
            <ActivityIndicator color="#0a120d" />
          ) : (
            <Text style={styles.btnTxt}>Get started</Text>
          )}
        </Pressable>
        </Bounded>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const mono = 'monospace';
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  brand: { fontSize: 32, fontWeight: '800', color: C.ink, letterSpacing: 1, textAlign: 'center' },
  sub: { fontFamily: mono, fontSize: 14, color: C.ink, textAlign: 'center', marginTop: 18 },
  hint: { fontFamily: mono, fontSize: 11, color: C.dim, textAlign: 'center', marginTop: 6, marginBottom: 22 },
  choice: {
    borderWidth: 1,
    borderColor: C.line2,
    backgroundColor: C.bg2,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  choiceOn: { borderColor: C.accent, backgroundColor: C.panel },
  choiceTitle: { color: C.ink, fontSize: 18, fontWeight: '700' },
  choiceDesc: { color: C.dim, fontFamily: mono, fontSize: 11, lineHeight: 16, marginTop: 4 },
  label: { fontFamily: mono, fontSize: 10, letterSpacing: 1, color: C.dim2, marginTop: 8, marginBottom: 5 },
  input: {
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.ink,
    fontSize: 16,
  },
  err: { color: C.bad, fontSize: 13, marginTop: 14, lineHeight: 18 },
  notice: { color: C.accent2, fontSize: 13, marginTop: 14, lineHeight: 18 },
  btn: { backgroundColor: C.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 22 },
  btnTxt: { color: '#0a120d', fontWeight: '800', fontSize: 16 },
});
