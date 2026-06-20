import * as ScreenOrientation from 'expo-screen-orientation';
import { Platform } from 'react-native';

/**
 * The app's DEFAULT orientation lock:
 *  - iPad → ALL (the app rotates freely; full landscape support).
 *  - iPhone / Android phones → portrait only (the layouts are phone-first).
 * Used on app start (_layout) and to restore orientation when leaving the 3D screen.
 * Best-effort — never throws.
 */
export function lockDefaultOrientation(): Promise<unknown> {
  const lock =
    Platform.OS === 'ios' && Platform.isPad
      ? ScreenOrientation.OrientationLock.ALL
      : ScreenOrientation.OrientationLock.PORTRAIT_UP;
  return ScreenOrientation.lockAsync(lock).catch(() => {});
}
