import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';

import { C } from '@/theme';

// Lightweight emoji tab icons (no extra dependency). Keyed per route.
const icon =
  (glyph: string) =>
  ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 17, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>
  );

// Tab order mirrors the web app's nav: Overview · Club Detail · Trends · 2D · 3D · Raw.
export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: C.bg },
          headerShadowVisible: false,
          headerTitleStyle: { color: C.ink, fontWeight: '700' },
          headerTintColor: C.accent,
          tabBarStyle: { backgroundColor: C.bg2, borderTopColor: C.line },
          tabBarActiveTintColor: C.accent,
          tabBarInactiveTintColor: C.dim,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}>
        <Tabs.Screen name="index" options={{ title: 'Bag', tabBarIcon: icon('⛳') }} />
        <Tabs.Screen name="club-detail" options={{ title: 'Clubs', tabBarIcon: icon('🏌️') }} />
        <Tabs.Screen name="trends" options={{ title: 'Trends', tabBarIcon: icon('📈') }} />
        <Tabs.Screen name="dispersion" options={{ title: '2D', tabBarIcon: icon('🎯') }} />
        <Tabs.Screen name="flight-3d" options={{ title: '3D', tabBarIcon: icon('✈️') }} />
        <Tabs.Screen name="raw-data" options={{ title: 'Raw', tabBarIcon: icon('📋') }} />
        {/* Linked from the Bag screen, not shown as a tab (mirrors the web). */}
        <Tabs.Screen name="model" options={{ href: null, title: 'The Model' }} />
      </Tabs>
    </>
  );
}
