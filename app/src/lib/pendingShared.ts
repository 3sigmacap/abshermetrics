// Hand-off from the OS "share to AbsherMetrics" flow (ShareImporter) to the Raw Data
// screen. The share handler reads the shared file text(s) and stashes them here, then
// navigates to Raw Data, which runs them through the SAME import path as a manual upload
// — including the one-time wedge-mapping prompt and the user's saved club mappings.
// Module singleton: one pending share at a time, consumed once.
let pending: string[] | null = null;

export function setPendingShared(texts: string[]): void {
  pending = texts && texts.length ? texts : null;
}

/** Returns the pending shared file texts (and clears them), or null if none. */
export function takePendingShared(): string[] | null {
  const p = pending;
  pending = null;
  return p;
}
