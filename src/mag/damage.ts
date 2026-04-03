import { normalize_signed_mag } from "./core.js";

export function get_damage_dice_from_mag(mag: number): string {
  const value = normalize_signed_mag(mag, 0);
  if (value <= 0) return "1";
  if (value === 1) return "1d2";
  if (value === 2) return "1d4";
  if (value === 3) return "1d6";
  if (value === 4) return "1d8";
  if (value === 5) return "2d4";
  if (value === 6) return "1d10";
  return `${Math.floor(value / 2)}d6`;
}
