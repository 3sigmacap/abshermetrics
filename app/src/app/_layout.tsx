import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs, useRouter, type Href } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ColorValue } from 'react-native';

import SignInScreen from '@/components/SignInScreen';
import { AuthProvider, useAuth } from '@/lib/auth';
import { DataProvider } from '@/lib/dataStore';
import { ProfileProvider } from '@/lib/profile';
import { C } from '@/theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// Monochrome icons tinted by the tab color (accent when active, dim when not).
const tabIcon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <MaterialCommunityIcons name={name} size={size ?? 22} color={color as string} />
  );

// Settings gear (header right on every tab) and a Done button (header left on Settings).
function HeaderGear() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push('/settings' as Href)} hitSlop={10} style={styles.headerBtn}>
      <MaterialCommunityIcons name="cog-outline" size={22} color={C.accent} />
    </Pressable>
  );
}
function HeaderDone() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
      <Text style={styles.doneTxt}>Done</Text>
    </Pressable>
  );
}

// Full-screen gate: spinner while restoring the session, sign-in when logged out,
// nothing (reveals the app) once authenticated.
function AuthOverlay() {
  const { session, loading } = useAuth();
  if (!loading && session) return null;
  return (
    <View style={styles.overlay}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} size="large" />
        </View>
      ) : (
        <SignInScreen />
      )}
    </View>
  );
}

// Tab order mirrors the web app's nav: Overview · Club Detail · Trends · 2D · 3D · Raw.
export default function RootLayout() {
  // Portrait everywhere; the 3D screen unlocks landscape on focus (see flight-3d.tsx).
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  return (
    <AuthProvider>
      <ProfileProvider>
        <DataProvider>
          <StatusBar style="light" />
          <View style={styles.root}>
            <Tabs
              screenOptions={{
                headerStyle: { backgroundColor: C.bg },
                headerShadowVisible: false,
                headerTitleStyle: { color: C.ink, fontWeight: '700' },
                headerTintColor: C.accent,
                headerRight: () => <HeaderGear />,
                tabBarStyle: { backgroundColor: C.bg2, borderTopColor: C.line },
                tabBarActiveTintColor: C.accent,
                tabBarInactiveTintColor: C.dim,
                tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
              }}>
              <Tabs.Screen name="index" options={{ title: 'Bag', tabBarIcon: tabIcon('golf') }} />
              <Tabs.Screen name="club-detail" options={{ title: 'Clubs', tabBarIcon: tabIcon('golf-tee') }} />
              <Tabs.Screen name="trends" options={{ title: 'Trends', tabBarIcon: tabIcon('chart-line') }} />
              <Tabs.Screen name="dispersion" options={{ title: '2D', tabBarIcon: tabIcon('target') }} />
              <Tabs.Screen name="flight-3d" options={{ title: '3D', tabBarIcon: tabIcon('airplane-takeoff') }} />
              <Tabs.Screen name="raw-data" options={{ title: 'Raw', tabBarIcon: tabIcon('clipboard-text-outline') }} />
              {/* Hidden routes (not tabs): linked from in-app. */}
              <Tabs.Screen name="model" options={{ href: null, title: 'The Model' }} />
              <Tabs.Screen
                name="settings"
                options={{ href: null, title: 'Settings', headerLeft: () => <HeaderDone />, headerRight: () => null }}
              />
            </Tabs>
            <AuthOverlay />
          </View>
        </DataProvider>
      </ProfileProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg, zIndex: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBtn: { paddingHorizontal: 14 },
  doneTxt: { color: C.accent, fontWeight: '700', fontSize: 16 },
});
