import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/lib/auth';
import { CLUB_ORDER, DEFAULT_LOFTS } from '@/lib/clubData';
import { useProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { C } from '@/theme';

const mono = 'monospace';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.panel}>{children}</View>
    </View>
  );
}

export default function Settings() {
  const { signOut } = useAuth();
  const profile = useProfile();

  const [name, setName] = useState(profile.displayName);
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // editable club table (longest first), seeded from saved specs + defaults
  const clubsOrdered = useMemo(() => [...CLUB_ORDER].reverse(), []);
  const [clubEdits, setClubEdits] = useState<Record<string, { loft: string; inBag: boolean }>>(() => {
    const o: Record<string, { loft: string; inBag: boolean }> = {};
    for (const c of CLUB_ORDER) {
      const spec = profile.clubSpecs[c];
      const loft = spec?.loft ?? DEFAULT_LOFTS[c];
      o[c] = { loft: loft != null ? String(loft) : '', inBag: spec?.inBag ?? true };
    }
    return o;
  });

  const flash = (text: string, bad = false) => {
    setMsg({ text, bad });
    setTimeout(() => setMsg(null), 3000);
  };

  const saveName = async () => {
    setBusy(true);
    const { error } = await profile.updateName(name.trim());
    setBusy(false);
    flash(error ?? 'Name saved', !!error);
  };

  const changePw = async () => {
    if (pw.length < 6) {
      flash('Password must be at least 6 characters.', true);
      return;
    }
    setBusy(true);
    const { error } = await profile.changePassword(pw);
    setBusy(false);
    setPw('');
    flash(error ?? 'Password updated', !!error);
  };

  const deleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account and all your shots and sessions. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const { error } = await supabase.functions.invoke('delete-account');
            setBusy(false);
            if (error) {
              flash(`Could not delete account: ${error.message}`, true);
              return;
            }
            await signOut();
          },
        },
      ],
    );
  };

  const saveClubs = async () => {
    const specs: Record<string, { loft?: number; inBag?: boolean }> = {};
    for (const c of CLUB_ORDER) {
      const e = clubEdits[c];
      const loft = parseFloat(e.loft);
      specs[c] = { inBag: e.inBag };
      if (!Number.isNaN(loft)) specs[c].loft = loft;
    }
    setBusy(true);
    const { error } = await profile.saveClubSpecs(specs);
    setBusy(false);
    flash(error ? `Could not save (run the schema update?): ${error}` : 'Clubs saved', !!error);
  };

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      {msg ? (
        <Text style={[styles.msg, msg.bad ? styles.msgBad : styles.msgOk]}>{msg.text}</Text>
      ) : null}

      {/* ACCOUNT */}
      <Section title="ACCOUNT">
        <Text style={styles.label}>DISPLAY NAME</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={C.dim2}
          />
          <Pressable onPress={saveName} style={styles.smallBtn} disabled={busy}>
            <Text style={styles.smallBtnTxt}>Save</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>EMAIL</Text>
        <Text style={styles.readonly}>{profile.email || '—'}</Text>

        <Text style={styles.label}>NEW PASSWORD</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={pw}
            onChangeText={setPw}
            secureTextEntry
            autoCapitalize="none"
            placeholder="••••••••"
            placeholderTextColor={C.dim2}
          />
          <Pressable onPress={changePw} style={styles.smallBtn} disabled={busy}>
            <Text style={styles.smallBtnTxt}>Update</Text>
          </Pressable>
        </View>

        <Pressable onPress={signOut} style={styles.signOut}>
          <Text style={styles.signOutTxt}>Sign out</Text>
        </Pressable>
        <Pressable onPress={deleteAccount} style={styles.deleteBtn} disabled={busy}>
          <Text style={styles.deleteTxt}>Delete account</Text>
        </Pressable>
      </Section>

      {/* MY CLUBS */}
      <Section title="MY CLUBS">
        <Text style={styles.help}>
          Lofts feed the rest of the app. Toggle a club off if it isn’t in your bag.
        </Text>
        <View style={[styles.clubRow, styles.clubHead]}>
          <Text style={[styles.cClub, styles.headTxt]}>Club</Text>
          <Text style={[styles.cLoft, styles.headTxt]}>Loft°</Text>
          <Text style={[styles.cBag, styles.headTxt]}>In bag</Text>
        </View>
        {clubsOrdered.map((c) => (
          <View key={c} style={styles.clubRow}>
            <Text style={styles.cClubName}>{c}</Text>
            <TextInput
              style={styles.loftInput}
              value={clubEdits[c].loft}
              onChangeText={(t) => setClubEdits((p) => ({ ...p, [c]: { ...p[c], loft: t } }))}
              keyboardType="decimal-pad"
              placeholder="—"
              placeholderTextColor={C.dim2}
            />
            <View style={styles.cBag}>
              <Switch
                value={clubEdits[c].inBag}
                onValueChange={(v) => setClubEdits((p) => ({ ...p, [c]: { ...p[c], inBag: v } }))}
                trackColor={{ true: C.accent, false: C.line2 }}
                thumbColor="#0a120d"
              />
            </View>
          </View>
        ))}
        <Pressable onPress={saveClubs} style={styles.saveBtn} disabled={busy}>
          {busy ? <ActivityIndicator color="#0a120d" /> : <Text style={styles.saveBtnTxt}>Save clubs</Text>}
        </Pressable>
      </Section>

      {/* APP */}
      <Section title="APP">
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Reduce motion</Text>
            <Text style={styles.help}>Turn off looping chart animations.</Text>
          </View>
          <Switch
            value={!!profile.prefs.reduceMotion}
            onValueChange={(v) => {
              void profile.updatePrefs({ reduceMotion: v });
            }}
            trackColor={{ true: C.accent, false: C.line2 }}
            thumbColor="#0a120d"
          />
        </View>
      </Section>

      <Text style={styles.foot}>AbsherMetrics</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48 },
  msg: { fontFamily: mono, fontSize: 12, padding: 10, borderRadius: 8, marginBottom: 12, overflow: 'hidden' },
  msgOk: { color: '#0a120d', backgroundColor: C.accent },
  msgBad: { color: C.bad, backgroundColor: '#2a1414' },
  section: { marginBottom: 22 },
  sectionTitle: { fontFamily: mono, fontSize: 11, letterSpacing: 1.5, color: C.dim2, marginBottom: 8 },
  panel: { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14 },
  label: { fontFamily: mono, fontSize: 10, letterSpacing: 1, color: C.dim2, marginTop: 10, marginBottom: 5 },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.line2, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, color: C.ink, fontSize: 15,
  },
  readonly: { color: C.dim, fontSize: 15, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallBtn: { backgroundColor: C.line2, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11 },
  smallBtnTxt: { color: C.ink, fontWeight: '700', fontSize: 13 },
  signOut: { marginTop: 18, borderWidth: 1, borderColor: '#5e2b2b', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  signOutTxt: { color: C.bad, fontWeight: '700', fontSize: 15 },
  deleteBtn: { marginTop: 10, paddingVertical: 10, alignItems: 'center' },
  deleteTxt: { color: C.dim2, fontSize: 13, textDecorationLine: 'underline' },
  help: { fontFamily: mono, fontSize: 11, color: C.dim2, lineHeight: 16, marginBottom: 8 },
  clubRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#142219' },
  clubHead: { borderBottomColor: C.line2 },
  headTxt: { fontFamily: mono, fontSize: 9.5, letterSpacing: 0.5, color: C.dim2, textTransform: 'uppercase' },
  cClub: { flex: 1 },
  cClubName: { flex: 1, color: C.ink, fontSize: 14, fontWeight: '600' },
  cLoft: { width: 70, textAlign: 'center' },
  loftInput: {
    width: 70, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line2, borderRadius: 7,
    paddingVertical: 6, color: C.ink, fontSize: 14, textAlign: 'center', fontFamily: mono,
  },
  cBag: { width: 64, alignItems: 'center' },
  saveBtn: { backgroundColor: C.accent, borderRadius: 9, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  saveBtnTxt: { color: '#0a120d', fontWeight: '800', fontSize: 15 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleLabel: { color: C.ink, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  foot: { fontFamily: mono, fontSize: 11, color: C.dim2, textAlign: 'center', marginTop: 8 },
});
