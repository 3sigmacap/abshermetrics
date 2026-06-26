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
 * (so a shared GC3 file works exactly like an in-app upload).
 *
 * Deliberately does NOT pre-filter shared files by MIME/extension: the OS already routed
 * the file to us, and launch-monitor exports can arrive as text/plain, octet-stream, or a
 * content:// URI with no extension (which is exactly why a shared Foresight GC3 file used
 * to get silently dropped). We read whatever was shared and let the parser decide; if
 * nothing readable came through, we say so out loud (no silent failures).
 */
export function ShareImporter() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const { session } = useAuth();
  const router = useRouter();
  const busy = useRef(false);
  // expo-share-intent delivers the SAME share twice (once via onNewIntent, once via the
  // app-becomes-active refresh). Remember the last share's signature + time so we import
  // it exactly once — without this a single share created a duplicate (and a race left
  // one of the two sessions empty).
  const lastShare = useRef<{ sig: string; at: number }>({ sig: '', at: 0 });

  useEffect(() => {
    if (!hasShareIntent || busy.current) return;
    const files = shareIntent?.files ?? [];
    const sharedText = (shareIntent?.text ?? '').trim();
    if (!files.length && !sharedText) return;
    const uid = session?.user?.id;
    if (!uid) return; // not signed in yet — re-runs when the session loads

    // De-dupe the double delivery: same content within a few seconds = ignore the repeat.
    const sig = files.length
      ? files.map((f) => `${f.fileName ?? ''}:${f.size ?? ''}:${f.path ?? ''}`).join('|')
      : `text:${sharedText.length}`;
    const now = Date.now();
    if (lastShare.current.sig === sig && now - lastShare.current.at < 6000) {
      resetShareIntent();
      return;
    }
    lastShare.current = { sig, at: now };

    busy.current = true;
    // Confirm receipt IMMEDIATELY — if you don't see this right after sharing, the file
    // never reached AbsherMetrics (an OS / share-target problem, not the import itself).
    const recvNames = files.map((f) => f.fileName || (f.path || '').split('/').pop() || 'file').join(', ');
    Alert.alert('Importing shared file', (recvNames || 'shared text') + ' …');

    void (async () => {
      const texts: string[] = [];
      const diag: string[] = []; // per-file outcome → a clear message if nothing imports
      try {
        for (const f of files) {
          const name = (f.fileName || f.path || 'file').toString();
          const short = name.split('/').pop() || name;
          if (f.size && f.size > MAX_FILE_BYTES) {
            diag.push(`• ${short}: larger than 10 MB — skipped`);
            continue;
          }
          try {
            const text = await new File(f.path).text();
            if (text && text.trim()) {
              texts.push(text);
              diag.push(`• ${short}: read OK (${text.length} chars, ${f.mimeType || 'no type'})`);
            } else {
              diag.push(`• ${short}: file was empty`);
            }
          } catch (e) {
            diag.push(`• ${short}: could not read — ${e instanceof Error ? e.message : 'error'}`);
          }
        }
        // Some share targets deliver the CSV as plain text instead of a file attachment.
        if (!texts.length && sharedText) {
          texts.push(sharedText);
          diag.push(`• shared text: ${sharedText.length} chars`);
        }
      } finally {
        resetShareIntent();
        busy.current = false;
      }

      if (!texts.length) {
        Alert.alert(
          'Couldn’t open the shared file',
          'AbsherMetrics received the share but couldn’t read a file from it.\n\n' +
            (diag.join('\n') || 'No file or text was attached.'),
        );
        return;
      }
      // Hand to Raw Data — it runs the same import + wedge-mapping flow and shows a
      // success/failure alert when it finishes. The subscription in pendingShared makes
      // sure it fires even if Raw Data is already mounted.
      setPendingShared(texts);
      router.push('/raw-data');
    })();
  }, [hasShareIntent, shareIntent, session, router, resetShareIntent]);

  return null;
}
