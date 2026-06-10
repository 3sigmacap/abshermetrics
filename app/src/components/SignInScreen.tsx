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

import { useAuth } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { C } from '@/theme';

export default function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (mode === 'up' && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    const res = mode === 'in' ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (mode === 'up') {
      // If email confirmation is on, no session yet — tell the user. If it's off,
      // a session is set and the app reveals itself automatically.
      setNotice('Account created. If sign-in doesn’t happen automatically, check your email to confirm, then sign in.');
      setMode('in');
    }
  };

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>
          ABSHER<Text style={{ color: C.accent }}>METRICS</Text>
        </Text>
        <Text style={styles.sub}>{mode === 'in' ? 'Sign in to your bag' : 'Create your account'}</Text>

        <Text style={styles.label}>EMAIL</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="you@example.com"
          placeholderTextColor={C.dim2}
          inputMode="email"
        />

        <Text style={styles.label}>PASSWORD</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          placeholder="••••••••"
          placeholderTextColor={C.dim2}
          onSubmitEditing={submit}
          returnKeyType="go"
        />

        {error ? <Text style={styles.err}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <Pressable onPress={submit} disabled={busy} style={[styles.btn, busy && { opacity: 0.7 }]}>
          {busy ? (
            <ActivityIndicator color="#0a120d" />
          ) : (
            <Text style={styles.btnTxt}>{mode === 'in' ? 'Sign in' : 'Create account'}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            setMode((m) => (m === 'in' ? 'up' : 'in'));
            setError(null);
            setNotice(null);
          }}
          hitSlop={10}>
          <Text style={styles.toggle}>
            {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </Text>
        </Pressable>

        {!isSupabaseConfigured ? (
          <Text style={styles.err}>Backend not configured — see supabase/SETUP.md, then restart Metro.</Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const mono = 'monospace';
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 4 },
  brand: { fontSize: 34, fontWeight: '800', color: C.ink, letterSpacing: 1, textAlign: 'center' },
  sub: { fontFamily: mono, fontSize: 13, color: C.dim, textAlign: 'center', marginBottom: 22 },
  label: { fontFamily: mono, fontSize: 10, letterSpacing: 1, color: C.dim2, marginTop: 12, marginBottom: 5 },
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
  btn: {
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 22,
  },
  btnTxt: { color: '#0a120d', fontWeight: '800', fontSize: 16 },
  toggle: { color: C.dim, fontFamily: mono, fontSize: 12.5, textAlign: 'center', marginTop: 20 },
});
