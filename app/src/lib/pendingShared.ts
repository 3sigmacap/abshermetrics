// Hand-off from the OS "share to AbsherMetrics" flow (ShareImporter) to the Raw Data
// screen. The share handler reads the shared file text(s) and stashes them here, then
// navigates to Raw Data, which runs them through the SAME import path as a manual upload
// — including the one-time wedge-mapping prompt and the user's saved club mappings.
//
// Module singleton: one pending share at a time, consumed once. A tiny subscription lets
// an ALREADY-MOUNTED Raw Data screen react the moment a new share arrives — without it, a
// share that lands while Raw Data is already on the stack would never get consumed (its
// mount effect wouldn't re-run), so the file would silently never import.
let pending: string[] | null = null;
const listeners = new Set<() => void>();

export function setPendingShared(texts: string[]): void {
  pending = texts && texts.length ? texts : null;
  // Notify any mounted consumer (Raw Data) that a share is ready to import.
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a listener throwing must not break the share hand-off */
    }
  });
}

/** Returns the pending shared file texts (and clears them), or null if none. */
export function takePendingShared(): string[] | null {
  const p = pending;
  pending = null;
  return p;
}

/** Subscribe to "a new share arrived". Returns an unsubscribe fn. */
export function subscribePendingShared(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
