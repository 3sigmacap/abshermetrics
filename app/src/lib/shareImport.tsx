import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/lib/auth';
import { MAX_FILE_BYTES } from '@/lib/csvImport';
import { setPendingShared } from '@/lib/pendingShared';

/**
 * Imports a launch-monitor CSV shared to AbsherMetrics from another app (e.g. Garmin
 * Golf's or the Foresight app's Download → Share → AbsherMetrics). Mounted once inside
 * the providers (see _layout). Reads the file(s) and hands them to the Raw Data screen,
 * which runs them through the SAME path as a manual upload — auto-detecting the device
 * and showing the one-time wedge-mapping prompt when a number-only club needs mapping
 * (so a shared GC3 file works exactly like an in-app upload). If shared while signed
 * out, it re-runs once the session is restored.
 */
export function ShareImporter() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const { session } = useAuth();
  const router = useRouter();
  const busy = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || busy.current) return;
    const files = shareIntent?.files ?? [];
    if (!files.length) return;
    const uid = session?.user?.id;
    if (!uid) return; // not signed in yet — re-runs when the session loads

    busy.current = true;
    void (async () => {
      const texts: string[] = [];
      let lastErr: string | undefined;
      for (const f of files) {
        const name = (f.fileName || f.path || '').toString();
        const isCsv = /csv/i.test(f.mimeType || '') || /\.csv$/i.test(name);
        if (!isCsv) continue;
        if (f.size && f.size > MAX_FILE_BYTES) {
          lastErr = `"${f.fileName ?? 'file'}" is larger than 10 MB.`;
          continue;
        }
        try {
          texts.push(await new File(f.path).text());
        } catch (e) {
          lastErr = e instanceof Error ? e.message : 'Could not read the shared file.';
        }
      }
      resetShareIntent();
      busy.current = false;
      if (!texts.length) {
        Alert.alert('Import failed', lastErr || 'That file isn’t a supported launch-monitor CSV.');
        return;
      }
      // Hand off to Raw Data — same import + wedge-mapping flow as a manual upload.
      setPendingShared(texts);
      router.push('/raw-data');
    })();
  }, [hasShareIntent, shareIntent, session, router, resetShareIntent]);

  return null;
}
