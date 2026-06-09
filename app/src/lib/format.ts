/** Shared numeric helpers — mirror the web app's math exactly. */
export const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export const sd = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); // sample SD
};

export const r0 = (x: number) => Math.round(x);
export const r1 = (x: number) => Math.round(x * 10) / 10;
export const comma = (x: number) => Math.round(x).toLocaleString('en-US');
export const f1 = (x: number) => r1(x).toFixed(1);

export const fmt = (n: number | null | undefined, dp = 1, signed = false): string => {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  let s = Number(n).toFixed(dp);
  if (dp === 0) s = Number(s).toLocaleString('en-US');
  return signed && n > 0 ? '+' + s : s;
};
