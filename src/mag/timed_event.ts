export function timed_event_stat_to_bps(speed: number): number {
  const s = Math.floor(Number(speed));
  if (!Number.isFinite(s) || s <= 0) return 8;
  if (s >= 8) return 1;
  return Math.max(1, 9 - s);
}
