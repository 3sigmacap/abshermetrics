import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
import { CLUB_ORDER, DEFAULT_LOFTS, clubSortIdx } from '@/lib/clubData';
import { useConnections } from '@/lib/connections';
import { useFollows } from '@/lib/follows';
import { useView } from '@/lib/viewContext';
import { useClubs } from '@/lib/dataStore';
import { useProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { C } from '@/theme';

const mono = 'monospace';

// Limit loft to at most 2 integer digits + one decimal (e.g. 10.5, 56, 42.5),
// so a loft can only be 2 digits and never something like 100 or 12.345.
function sanitizeLoft(t: string): string {
  let s = t.replace(/[^0-9.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  const [intPart = '', decPart = ''] = s.split('.');
  let out = intPart.slice(0, 2);
  if (s.includes('.')) out += '.' + decPart.slice(0, 1);
  return out;
}

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
  const router = useRouter();

  const [name, setName] = useState(profile.displayName);
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // Club list is DATA-DRIVEN: the standard bag PLUS any club found in the user's
  // own shots (e.g. a Driver from an uploaded session), longest first.
  const { clubs: dataClubs } = useClubs();
  const clubsOrdered = useMemo(() => {
    const set = new Set<string>(CLUB_ORDER);
    dataClubs.forEach((c) => set.add(c.club));
    return [...set].sort((a, b) => clubSortIdx(a) - clubSortIdx(b));
  }, [dataClubs]);

  const seed = (c: string) => {
    const spec = profile.clubSpecs[c];
    const loft = spec?.loft ?? DEFAULT_LOFTS[c];
    return { loft: loft != null ? String(loft) : '', inBag: spec?.inBag ?? true };
  };
  const [clubEdits, setClubEdits] = useState<Record<string, { loft: string; inBag: boolean }>>(() => {
    const o: Record<string, { loft: string; inBag: boolean }> = {};
    for (const c of CLUB_ORDER) o[c] = seed(c);
    return o;
  });

  // Add rows for any newly-seen clubs (data loads async after mount).
  useEffect(() => {
    setClubEdits((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const c of clubsOrdered) {
        if (!(c in next)) {
          next[c] = seed(c);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubsOrdered]);

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
              const m = error.message || 'Unknown error';
              flash(`Could not delete account: ${m}`, true);
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
    for (const c of clubsOrdered) {
      const e = clubEdits[c] ?? { loft: '', inBag: true };
      const loft = parseFloat(e.loft);
      specs[c] = { inBag: e.inBag };
      if (Number.isFinite(loft)) specs[c].loft = loft;
    }
    setBusy(true);
    const { error } = await profile.saveClubSpecs(specs);
    setBusy(false);
    flash(error ? `Could not save (run the schema update?): ${error}` : 'Clubs saved', !!error);
  };

  // ---- connections ----
  const conn = useConnections();
  const [connEmail, setConnEmail] = useState('');

  // ---- followers (spectator mode) ----
  const foll = useFollows();
  const view = useView();
  const [follEmail, setFollEmail] = useState('');

  const addFollow = async () => {
    const email = follEmail.trim();
    if (!email) { flash('Enter an email address.', true); return; }
    setBusy(true);
    const { status, error } = await foll.request(email);
    setBusy(false);
    if (error) { flash(error, true); return; }
    const messages: Record<string, string> = {
      requested: 'Request sent — they’ll get to approve you.',
      already: 'You already follow / have a pending request for that player.',
      self: "That's your own email.",
      not_found: 'No AbsherMetrics account uses that email yet.',
    };
    const isErr = status === 'self' || status === 'not_found';
    flash(messages[status ?? ''] ?? 'Done.', isErr);
    if (status === 'requested') setFollEmail('');
  };
  const approveFoll = async (id: string) => {
    setBusy(true);
    const { error } = await foll.approve(id);
    setBusy(false);
    flash(error ?? 'Approved — they can now view your account.', !!error);
  };
  const removeFoll = (id: string) => {
    Alert.alert('Remove follow', 'This ends the follow relationship.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const { error } = await foll.remove(id);
          setBusy(false);
          if (error) flash(error, true);
        },
      },
    ]);
  };
  const viewPlayer = (id: string) => {
    view.setViewedUser(id);
    router.push('/' as Href);
  };
  const follPerson = (f: { other: { name: string | null; email: string | null } }) =>
    f.other.name || (f.other.email || '').split('@')[0] || 'Player';

  const addConnection = async () => {
    const email = connEmail.trim();
    if (!email) {
      flash('Enter an email address.', true);
      return;
    }
    setBusy(true);
    const { status, error } = await conn.request(email);
    setBusy(false);
    if (error) {
      flash(error, true);
      return;
    }
    const messages: Record<string, string> = {
      requested: 'Request sent.',
      accepted: "You're now connected!",
      already: 'You already have a request or connection with that player.',
      self: "That's your own email.",
      invited: 'No account yet — we emailed them an invite. Your request is waiting for them when they join.',
      invite_failed: "Couldn't send the invite email right now. Please try again later.",
      rate_limited: "You've sent a lot of invites today — please try again tomorrow.",
      not_found: 'No AbsherMetrics account uses that email yet.',
    };
    const isErr =
      status === 'self' || status === 'invite_failed' || status === 'rate_limited' || status === 'not_found';
    flash(messages[status ?? ''] ?? 'Done.', isErr);
    if (status === 'requested' || status === 'accepted' || status === 'invited') setConnEmail('');
  };

  const acceptConn = async (id: string) => {
    setBusy(true);
    const { error } = await conn.accept(id);
    setBusy(false);
    flash(error ?? 'Connected!', !!error);
  };

  const removeConn = (id: string, isAccepted: boolean) => {
    const doIt = async () => {
      setBusy(true);
      const { error } = await conn.remove(id);
      setBusy(false);
      if (error) flash(error, true);
    };
    if (isAccepted) {
      Alert.alert('Remove connection', 'You will no longer see each other’s bags.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: doIt },
      ]);
    } else {
      void doIt();
    }
  };

  const connPerson = (c: { other: { name: string | null; email: string | null } }) =>
    c.other.name || c.other.email?.split('@')[0] || 'Player';

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      {msg ? (
        <Text style={[styles.msg, msg.bad ? styles.msgBad : styles.msgOk]}>{msg.text}</Text>
      ) : null}

      {/* ACCOUNT — your own; hidden while spectating another player */}
      {!view.isViewingOther && (
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
      )}

      {/* DATA */}
      <Section title="DATA">
        <Pressable onPress={() => router.push('/raw-data' as Href)} style={styles.navRow}>
          <MaterialCommunityIcons name="clipboard-text-outline" size={20} color={C.accent} />
          <View style={styles.navText}>
            <Text style={styles.navLabel}>Raw shot data</Text>
            <Text style={styles.help}>Every shot exactly as measured, filterable by session.</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={C.dim2} />
        </Pressable>
      </Section>

      {/* CONNECTIONS */}
      <Section title="CONNECTIONS">
        <Text style={styles.help}>
          Link with other players by email. Once you both accept, you can compare bags. They only
          ever see your bag summary &amp; average trajectories — never your raw shots.
        </Text>
        <Text style={styles.label}>ADD BY EMAIL</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={connEmail}
            onChangeText={setConnEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="player@email.com"
            placeholderTextColor={C.dim2}
          />
          <Pressable onPress={addConnection} style={styles.smallBtn} disabled={busy}>
            <Text style={styles.smallBtnTxt}>Add</Text>
          </Pressable>
        </View>

        {conn.pendingIn.length > 0 && (
          <>
            <Text style={styles.connSub}>REQUESTS</Text>
            {conn.pendingIn.map((c) => (
              <View key={c.id} style={styles.connRow}>
                <View style={styles.connWho}>
                  <Text style={styles.connName} numberOfLines={1}>
                    {connPerson(c)}
                  </Text>
                  <Text style={styles.connEmail} numberOfLines={1}>
                    {c.other.email}
                  </Text>
                </View>
                <Pressable
                  onPress={() => acceptConn(c.id)}
                  style={[styles.connBtn, styles.connAccept]}
                  disabled={busy}>
                  <Text style={styles.connAcceptTxt}>Accept</Text>
                </Pressable>
                <Pressable
                  onPress={() => removeConn(c.id, false)}
                  style={[styles.connBtn, styles.connGhost]}
                  disabled={busy}>
                  <Text style={styles.connGhostTxt}>Decline</Text>
                </Pressable>
              </View>
            ))}
          </>
        )}

        {conn.pendingOut.length > 0 && (
          <>
            <Text style={styles.connSub}>SENT</Text>
            {conn.pendingOut.map((c) => (
              <View key={c.id} style={styles.connRow}>
                <View style={styles.connWho}>
                  <Text style={styles.connName} numberOfLines={1}>
                    {connPerson(c)}
                  </Text>
                  <Text style={styles.connEmail} numberOfLines={1}>
                    {c.other.email}
                  </Text>
                </View>
                <Text style={styles.connTag}>Pending</Text>
                <Pressable
                  onPress={() => removeConn(c.id, false)}
                  style={[styles.connBtn, styles.connGhost]}
                  disabled={busy}>
                  <Text style={styles.connGhostTxt}>Cancel</Text>
                </Pressable>
              </View>
            ))}
          </>
        )}

        <Text style={styles.connSub}>CONNECTED</Text>
        {conn.accepted.length > 0 ? (
          conn.accepted.map((c) => (
            <View key={c.id} style={styles.connRow}>
              <View style={styles.connWho}>
                <Text style={styles.connName} numberOfLines={1}>
                  {connPerson(c)}
                </Text>
                <Text style={styles.connEmail} numberOfLines={1}>
                  {c.other.email}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  router.push(
                    `/connection-bag?u=${encodeURIComponent(c.other.id)}&name=${encodeURIComponent(connPerson(c))}` as Href,
                  )
                }
                style={[styles.connBtn, styles.connView]}>
                <Text style={styles.connViewTxt}>View bag</Text>
              </Pressable>
              <Pressable
                onPress={() => removeConn(c.id, true)}
                style={[styles.connBtn, styles.connGhost]}
                disabled={busy}>
                <Text style={styles.connGhostTxt}>Remove</Text>
              </Pressable>
            </View>
          ))
        ) : (
          <Text style={styles.connEmpty}>No connections yet.</Text>
        )}
      </Section>

      {/* FOLLOWERS (spectator mode) */}
      <Section title="FOLLOWERS">
        <Text style={styles.help}>
          Let someone spectate your account — they see your full data read-only (a coach, a parent). Or
          follow a player to view theirs. You approve every follower; only people you approve see your raw shots.
        </Text>
        <Text style={styles.label}>FOLLOW A PLAYER BY EMAIL</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={follEmail}
            onChangeText={setFollEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="player@email.com"
            placeholderTextColor={C.dim2}
          />
          <Pressable onPress={addFollow} style={styles.smallBtn} disabled={busy}>
            <Text style={styles.smallBtnTxt}>Follow</Text>
          </Pressable>
        </View>

        {foll.pendingIn.length > 0 && (
          <>
            <Text style={styles.connSub}>WANTS TO FOLLOW YOU</Text>
            {foll.pendingIn.map((f) => (
              <View key={f.id} style={styles.connRow}>
                <View style={styles.connWho}>
                  <Text style={styles.connName} numberOfLines={1}>{follPerson(f)}</Text>
                  <Text style={styles.connEmail} numberOfLines={1}>{f.other.email}</Text>
                </View>
                <Pressable onPress={() => approveFoll(f.id)} style={[styles.connBtn, styles.connAccept]} disabled={busy}>
                  <Text style={styles.connAcceptTxt}>Approve</Text>
                </Pressable>
                <Pressable onPress={() => removeFoll(f.id)} style={[styles.connBtn, styles.connGhost]} disabled={busy}>
                  <Text style={styles.connGhostTxt}>Deny</Text>
                </Pressable>
              </View>
            ))}
          </>
        )}

        {foll.followers.length > 0 && (
          <>
            <Text style={styles.connSub}>FOLLOWING YOU</Text>
            {foll.followers.map((f) => (
              <View key={f.id} style={styles.connRow}>
                <View style={styles.connWho}>
                  <Text style={styles.connName} numberOfLines={1}>{follPerson(f)}</Text>
                  <Text style={styles.connEmail} numberOfLines={1}>{f.other.email}</Text>
                </View>
                <Pressable onPress={() => removeFoll(f.id)} style={[styles.connBtn, styles.connGhost]} disabled={busy}>
                  <Text style={styles.connGhostTxt}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </>
        )}

        {foll.pendingOut.length > 0 && (
          <>
            <Text style={styles.connSub}>REQUESTED</Text>
            {foll.pendingOut.map((f) => (
              <View key={f.id} style={styles.connRow}>
                <View style={styles.connWho}>
                  <Text style={styles.connName} numberOfLines={1}>{follPerson(f)}</Text>
                  <Text style={styles.connEmail} numberOfLines={1}>{f.other.email}</Text>
                </View>
                <Text style={styles.connTag}>Pending</Text>
                <Pressable onPress={() => removeFoll(f.id)} style={[styles.connBtn, styles.connGhost]} disabled={busy}>
                  <Text style={styles.connGhostTxt}>Cancel</Text>
                </Pressable>
              </View>
            ))}
          </>
        )}

        <Text style={styles.connSub}>YOU FOLLOW</Text>
        {foll.following.length > 0 ? (
          foll.following.map((f) => (
            <View key={f.id} style={styles.connRow}>
              <View style={styles.connWho}>
                <Text style={styles.connName} numberOfLines={1}>{follPerson(f)}</Text>
                <Text style={styles.connEmail} numberOfLines={1}>{f.other.email}</Text>
              </View>
              <Pressable onPress={() => viewPlayer(f.other.id)} style={[styles.connBtn, styles.connView]}>
                <Text style={styles.connViewTxt}>View</Text>
              </Pressable>
              <Pressable onPress={() => removeFoll(f.id)} style={[styles.connBtn, styles.connGhost]} disabled={busy}>
                <Text style={styles.connGhostTxt}>Unfollow</Text>
              </Pressable>
            </View>
          ))
        ) : (
          <Text style={styles.help}>You aren’t following anyone yet.</Text>
        )}
      </Section>

      {/* MY CLUBS + APP — your own; hidden while spectating another player */}
      {!view.isViewingOther && (
      <>
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
        {clubsOrdered.map((c) => {
          const e = clubEdits[c] ?? { loft: '', inBag: true };
          return (
            <View key={c} style={styles.clubRow}>
              <Text style={styles.cClubName}>{c}</Text>
              <TextInput
                style={styles.loftInput}
                value={e.loft}
                onChangeText={(t) =>
                  setClubEdits((p) => ({ ...p, [c]: { ...(p[c] ?? e), loft: sanitizeLoft(t) } }))
                }
                keyboardType="decimal-pad"
                maxLength={4}
                placeholder="—"
                placeholderTextColor={C.dim2}
              />
              <View style={styles.cBag}>
                <Switch
                  value={e.inBag}
                  onValueChange={(v) =>
                    setClubEdits((p) => ({ ...p, [c]: { ...(p[c] ?? e), inBag: v } }))
                  }
                  trackColor={{ true: C.accent, false: C.line2 }}
                  thumbColor="#0a120d"
                />
              </View>
            </View>
          );
        })}
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
      </>
      )}

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
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  navText: { flex: 1 },
  navLabel: { color: C.ink, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  connSub: { fontFamily: mono, fontSize: 10, letterSpacing: 1, color: C.dim2, marginTop: 14, marginBottom: 4 },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#142219' },
  connWho: { flex: 1, minWidth: 0 },
  connName: { color: C.ink, fontSize: 15, fontWeight: '600' },
  connEmail: { fontFamily: mono, fontSize: 11, color: C.dim2 },
  connBtn: { borderRadius: 7, paddingHorizontal: 12, paddingVertical: 8 },
  connAccept: { backgroundColor: C.accent },
  connAcceptTxt: { color: '#0a120d', fontWeight: '700', fontSize: 12, fontFamily: mono },
  connGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line2 },
  connGhostTxt: { color: C.dim, fontWeight: '600', fontSize: 12, fontFamily: mono },
  connView: { backgroundColor: '#10201780', borderWidth: 1, borderColor: C.line2 },
  connViewTxt: { color: C.accent, fontWeight: '600', fontSize: 12, fontFamily: mono },
  connTag: { fontFamily: mono, fontSize: 10, letterSpacing: 1, color: C.dim2, textTransform: 'uppercase' },
  connEmpty: { fontFamily: mono, fontSize: 12, color: C.dim2, paddingVertical: 6 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleLabel: { color: C.ink, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  foot: { fontFamily: mono, fontSize: 11, color: C.dim2, textAlign: 'center', marginTop: 8 },
});
