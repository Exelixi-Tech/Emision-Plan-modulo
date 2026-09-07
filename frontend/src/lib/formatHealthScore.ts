/** Puntaje de salud funerario: un solo signo, decimales tal cual (sin redondear). */

export function parseHealthScore(raw: string): number | undefined {
  const t = raw.trim().replace(',', '.');
  if (!t || t === '-' || t === '+' || t === '.' || t === '-.') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function formatHealthScoreNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(n);
}

/** `+10` · `−0.5` · `0` — nunca `+-`. */
export function formatHealthScoreSigned(n: number, suffix = ''): string {
  if (!Number.isFinite(n) || n === 0) return `0${suffix}`;
  const sign = n > 0 ? '+' : '−';
  return `${sign}${formatHealthScoreNumber(Math.abs(n))}${suffix}`;
}
