import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/lib/auth';
import { importCsvText, MAX_FILE_BYTES } from '@/lib/csvImport';
import { useData } from '@/lib/dataStore';

/**
 * Imports a CSV shared to AbsherMetrics from another app — e.g. Garmin Golf's
 * Download → Share → AbsherMetrics. Mounted once inside the providers (see _layout).
 * Reuses the same importer as the in-app upload, so a shared file becomes a session
 * identically. If shared while signed out, it imports once the session is restored.
 */
export function ShareImporter() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const { session } = useAuth();
  const { refresh } = useData();
  const router = useRouter();
  const busy = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || busy.current) return;
    const files = shareIntent?.files ?? [];
    if (!files.length) return;
    const uid = session?.user?.id;
    if (!uid) return; // not signed in yet — re-runs and imports when the session loads

    busy.current = true;
    void (async () => {
      let added = 0;
      let sessions = 0;
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
          const text = await new File(f.path).text();
          const res = await importCsvText(text, uid);
          if (res.error) lastErr = res.error;
          else {
            added += res.added;
            sessions += 1;
          }
        } catch (e) {
          lastErr = e instanceof Error ? e.message : 'Could not read the shared file.';
        }
      }
      resetShareIntent();
      busy.current = false;
      if (sessions > 0) {
        await refresh();
        router.push('/raw-data');
        Alert.alert(
          'Imported',
          `Added ${added} shot${added === 1 ? '' : 's'} from ${sessions} file${sessions === 1 ? '' : 's'}.`,
        );
      } else {
        Alert.alert('Import failed', lastErr || 'That file had no valid Garmin R50 shot rows.');
      }
    })();
  }, [hasShareIntent, shareIntent, session, refresh, router, resetShareIntent]);

  return null;
}
