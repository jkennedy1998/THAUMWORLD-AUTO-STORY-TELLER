export function calculate_weight_mag(weight: number): number {
  if (weight <= 5) return 1;
  if (weight <= 15) return 2;
  if (weight <= 30) return 3;
  if (weight <= 50) return 4;
  return 5;
}
