// Small text helpers of the quiz screens.

/** "today at 14:05", "Oct 3" — for the history and the last results. */
export function formatWhen(ms: number | null, now = Date.now()): string {
  if (ms === null) return 'unfinished';
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return `today at ${time}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "1 min 05 s", "42 s". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${String(s)} s`;
  return `${String(Math.floor(s / 60))} min ${String(s % 60).padStart(2, '0')} s`;
}
