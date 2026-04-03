import type { NormalizedTagDefinition } from "../tag_system/definitions.js";

export function compute_dimension_value_delta(definition: NormalizedTagDefinition | null, dim_mag: Record<string, number>): number {
  if (!definition || definition.dimensions.length <= 0) return 0;
  let total = 0;
  for (const dimension of definition.dimensions) {
    const dim_value = typeof dim_mag?.[dimension.id] === "number" ? Math.floor(dim_mag[dimension.id]!) : dimension.default_mag;
    const delta = dim_value - dimension.default_mag;
    if (delta >= 0) total += delta * dimension.value_up_per_mag;
    else total += Math.abs(delta) * dimension.value_down_per_mag;
  }
  return Math.floor(total);
}
