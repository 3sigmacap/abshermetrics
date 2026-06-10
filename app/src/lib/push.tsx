import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * Mobile push notifications (Phase E). Registers this device's Expo push token in
 * public.push_tokens; the request-connection / notify-accept Edge Functions read
 * those tokens (service_role) and send via the Expo push API. Web has no native
 * push — it relies on the in-app badge (and, later, email).
 */

// Foreground: still show the banner (so an in-app request/accept surfaces immediately).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const projectId =
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
  (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;

/** Request permission, get the Expo push token, and upsert it for this user. Best-effort. */
export async function registerForPush(uid: string): Promise<void> {
  try {
    if (!Device.isDevice) return; // simulators/emulators can't obtain a push token

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    let status = (await Notifications.getPermissionsAsync()).status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;

    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!token) return;

    await supabase.from('push_tokens').upsert(
      { user_id: uid, token, platform: Platform.OS, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,token' },
    );
  } catch (_) {
    /* best-effort: never block the app on push registration */
  }
}

/** Mount once inside the providers (see _layout); registers when signed in. Renders nothing. */
export function PushRegistrar() {
  const { session } = useAuth();
  const doneFor = useRef<string | null>(null);
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid || doneFor.current === uid) return;
    doneFor.current = uid;
    void registerForPush(uid);
  }, [session]);
  return null;
}
