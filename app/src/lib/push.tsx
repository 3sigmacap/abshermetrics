import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * Mobile push notifications (Phase E). Registers this device's Expo push token in
 * public.push_tokens; Edge Functions (notify-new-session / notify-accept /
 * request-connection) read those tokens (service_role) and send via the Expo push
 * API. Web has no native push — it relies on the in-app badge + email.
 *
 * iOS needs APNs creds in EAS; Android needs FCM (google-services.json in the build +
 * an FCM V1 key in EAS). On a FRESH install the very first getExpoPushTokenAsync()
 * often fails because APNs/FCM registration isn't ready yet — so registration RETRIES
 * on every app-foreground until it succeeds (see PushRegistrar). Without that retry a
 * new user could silently end up with no token and never receive notifications.
 */

// Foreground: still show the banner (so an in-app notification surfaces immediately).
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

/**
 * Request permission, get the Expo push token, and upsert it for this user.
 * Returns true ONLY if a token was successfully stored — a false result means the
 * caller should retry later (e.g. on the next foreground), because the failure is
 * usually transient (permission still pending, or APNs/FCM not ready on first launch).
 * Best-effort: never throws.
 */
export async function registerForPush(uid: string): Promise<boolean> {
  try {
    if (!Device.isDevice) return false; // simulators/emulators can't obtain a push token

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
    if (status !== 'granted') return false;

    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!token) return false;

    const { error } = await supabase.from('push_tokens').upsert(
      { user_id: uid, token, platform: Platform.OS, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,token' },
    );
    return !error;
  } catch (_) {
    return false; // best-effort: caller retries on next foreground
  }
}

/**
 * Mount once inside the providers (see _layout). Registers the device's push token
 * when signed in, and RETRIES on every app-foreground until it succeeds — fresh
 * installs frequently fail the first attempt (APNs/FCM not ready yet) and would
 * otherwise silently never register a token. Renders nothing.
 */
export function PushRegistrar() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const registeredFor = useRef<string | null>(null); // uid we've SUCCESSFULLY registered
  const inFlight = useRef(false);

  useEffect(() => {
    if (!uid) return;

    const attempt = async () => {
      if (registeredFor.current === uid || inFlight.current) return;
      inFlight.current = true;
      try {
        if (await registerForPush(uid)) registeredFor.current = uid;
      } finally {
        inFlight.current = false;
      }
    };

    void attempt(); // on sign-in / mount

    // Retry whenever the app returns to the foreground, until a token sticks.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void attempt();
    });
    return () => sub.remove();
  }, [uid]);

  return null;
}
