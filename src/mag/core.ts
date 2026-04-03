export function normalize_signed_mag(value: unknown, fallback: number = 0): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return Math.floor(fallback || 0);
  return Math.floor(n);
}

export function normalize_nonnegative_mag(value: unknown, fallback: number = 0): number {
  return Math.max(0, normalize_signed_mag(value, fallback));
}

export function clamp_mag(value: unknown, min: number | null = null, max: number | null = null, fallback: number = 0): number {
  const base = normalize_signed_mag(value, fallback);
  if (typeof min === "number" && base < min) return min;
  if (typeof max === "number" && base > max) return max;
  return base;
}
