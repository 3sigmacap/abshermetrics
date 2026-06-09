import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { C } from '@/theme';

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
        <Tabs.Screen name="index" options={{ title: 'Bag' }} />
        <Tabs.Screen name="club-detail" options={{ title: 'Clubs' }} />
        <Tabs.Screen name="trends" options={{ title: 'Trends' }} />
        <Tabs.Screen name="dispersion" options={{ title: '2D' }} />
        <Tabs.Screen name="flight-3d" options={{ title: '3D' }} />
        <Tabs.Screen name="raw-data" options={{ title: 'Raw' }} />
        {/* Linked from the Bag screen, not shown as a tab (mirrors the web). */}
        <Tabs.Screen name="model" options={{ href: null, title: 'The Model' }} />
      </Tabs>
    </>
  );
}
