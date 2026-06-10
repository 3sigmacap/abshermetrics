import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs, useRouter, type Href } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View, type ColorValue } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import SignInScreen from '@/components/SignInScreen';
import { AuthProvider, useAuth } from '@/lib/auth';
import { BagPublisher } from '@/lib/bagSummary';
import { ConnectionsProvider, useConnections } from '@/lib/connections';
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

// Screenshot helper (no-op unless EXPO_PUBLIC_SCREENSHOT_MODE=1, only set for the
// EAS "simulator" build). Reads a route from AsyncStorage and navigates there, so
// App Store screenshots can be captured headlessly without tapping the simulator.
function ScreenshotNav() {
  const router = useRouter();
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_SCREENSHOT_MODE !== '1') return;
    let cancelled = false;
    AsyncStorage.getItem('__shotRoute').then((r) => {
      if (r && !cancelled) setTimeout(() => router.replace(r as Href), 500);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
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

// Tabs: Bag · Clubs · Trends · 2D · 3D · Settings. No nav header — a top
// safe-area inset keeps content clear of the status bar. Raw Data and The Model
// are pushed routes (reached from Settings / Bag) with an in-screen back button.
// The Settings tab carries a badge when connection requests are pending.
function AppTabs() {
  const { pendingCount } = useConnections();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
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
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: tabIcon('cog-outline'),
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          tabBarBadgeStyle: { backgroundColor: C.accent, color: '#0a120d', fontSize: 10 },
        }}
      />
      {/* Hidden routes (not tabs): pushed from in-app, each with a BackBar. */}
      <Tabs.Screen name="model" options={{ href: null, title: 'The Model' }} />
      <Tabs.Screen name="raw-data" options={{ href: null, title: 'Raw Data' }} />
      <Tabs.Screen name="connection-bag" options={{ href: null, title: 'Connection' }} />
      <Tabs.Screen name="compare" options={{ href: null, title: 'Compare' }} />
    </Tabs>
  );
}

export default function RootLayout() {
  // Portrait everywhere; the 3D screen unlocks landscape on focus (see flight-3d.tsx).
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  return (
    <AuthProvider>
      <ProfileProvider>
        <ConnectionsProvider>
          <DataProvider>
            <StatusBar style="light" />
            <View style={styles.root}>
              <SafeAreaView style={styles.root} edges={['top']}>
                <AppTabs />
              </SafeAreaView>
              <AuthOverlay />
              <ScreenshotNav />
              <BagPublisher />
            </View>
          </DataProvider>
        </ConnectionsProvider>
      </ProfileProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg, zIndex: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
