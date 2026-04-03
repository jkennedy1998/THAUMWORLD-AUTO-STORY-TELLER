export type SizeMagBand = {
  mag: number;
  label: string;
  occupancy_tiles: number;
  occupancy_note?: string;
};

export const SIZE_MAG_BANDS: SizeMagBand[] = [
  { mag: -2, label: "xs-", occupancy_tiles: 0, occupancy_note: "no occupancy" },
  { mag: -1, label: "xs+", occupancy_tiles: 0, occupancy_note: "no occupancy" },
  { mag: 0, label: "s-", occupancy_tiles: 0.1 },
  { mag: 1, label: "s+", occupancy_tiles: 0.5 },
  { mag: 2, label: "m-", occupancy_tiles: 1 },
  { mag: 3, label: "m+", occupancy_tiles: 2, occupancy_note: "any 2 adjacent" },
  { mag: 4, label: "l-", occupancy_tiles: 4, occupancy_note: "any shape" },
  { mag: 5, label: "l+", occupancy_tiles: 8, occupancy_note: "any shape" },
  { mag: 6, label: "xl-", occupancy_tiles: 16, occupancy_note: "any shape" },
  { mag: 7, label: "xl+", occupancy_tiles: 32, occupancy_note: "any shape" },
  { mag: 8, label: "xxl-", occupancy_tiles: 64, occupancy_note: "any shape" },
  { mag: 9, label: "xxl+", occupancy_tiles: 128, occupancy_note: "any shape" },
  { mag: 10, label: "xxxl-", occupancy_tiles: 256, occupancy_note: "any shape" },
];

export function normalize_size_mag(value: unknown, fallback: number = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.floor(fallback);
  return Math.floor(n);
}

export function get_size_mag_label(size_mag: unknown): string {
  const mag = normalize_size_mag(size_mag, 0);
  const exact = SIZE_MAG_BANDS.find((entry) => entry.mag === mag);
  if (exact) return exact.label;
  if (mag < -2) return `x${Math.abs(mag) - 2}s-`;
  if (mag > 10) return `x${mag - 10}xxxl+`;
  return `mag ${mag}`;
}

export function get_max_stack_size_from_size_mag(size_mag: unknown): number {
  const mag = normalize_size_mag(size_mag, 0);
  if (mag >= 0) return 1;
  if (mag === -1) return 10;
  if (mag === -2) return 100;
  if (mag === -3) return 1000;
  return 10000;
}

export function is_size_mag_stackable(size_mag: unknown): boolean {
  return get_max_stack_size_from_size_mag(size_mag) > 1;
}
