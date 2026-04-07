export const MIN_WEIGHT_INDEX = 0;
export const MAX_WEIGHT_INDEX = 3;
export const DEFAULT_WEIGHT_INDEX = 1;
export const DEFAULT_WEIGHT_INDEX_TO_CSS: readonly number[] = [80, 160, 320, 640] as const;

export function clamp_weight_index(n: unknown): number {
  const raw = typeof n === 'number' ? n : DEFAULT_WEIGHT_INDEX;
  if (!Number.isFinite(raw)) return DEFAULT_WEIGHT_INDEX;
  const v = Math.trunc(raw);
  return Math.max(MIN_WEIGHT_INDEX, Math.min(MAX_WEIGHT_INDEX, v));
}

export function bump_weight_index(weight_index: number, delta: number): number {
  return Math.max(MIN_WEIGHT_INDEX, Math.min(MAX_WEIGHT_INDEX, clamp_weight_index(weight_index) + Math.trunc(delta)));
}
