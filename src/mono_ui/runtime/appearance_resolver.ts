import type { SemanticValue } from '../../mag/light.js';
import { project_lit_semantic_value, resolve_light_mag } from '../../mag/light.js';
import { lerp_rgb, nearest_indexed_rgb } from '../colors.js';
import type { Rgb } from '../types.js';
import type { AppearanceSlotAssignments, InlineMaterialAssignments } from '../../render_shaders/graphics_contract.js';
import { resolve_material_rgb } from './material_registry.js';

export type AppearanceRgbPolicy = 'preserve' | 'quantize_to_active_palette';

export type ResolveAppearanceSlotRgbArgs = {
  slot: 1 | 2 | 3;
  semantic_value: SemanticValue;
  appearance_slots?: AppearanceSlotAssignments;
  materials?: InlineMaterialAssignments;
  light_mag?: unknown;
  rgb_policy?: AppearanceRgbPolicy;
};

export type ResolvePrimaryCellRgbArgs = {
  rgb: Rgb;
  appearance_slots?: AppearanceSlotAssignments;
  materials?: InlineMaterialAssignments;
  light_mag?: unknown;
  slot?: 1 | 2 | 3;
  semantic_value?: SemanticValue;
  rgb_policy?: AppearanceRgbPolicy;
};

function apply_rgb_policy(rgb: Rgb, policy: AppearanceRgbPolicy): Rgb {
  return policy === 'quantize_to_active_palette' ? nearest_indexed_rgb(rgb) : { ...rgb };
}

export function resolve_appearance_slot_rgb(args: ResolveAppearanceSlotRgbArgs): Rgb | null {
  const policy = args.rgb_policy ?? 'preserve';
  const appearance = args.appearance_slots?.[args.slot] ?? args.appearance_slots?.[1];
  if (appearance?.kind === 'flat_rgb') return apply_rgb_policy(appearance.rgb, policy);
  if (appearance?.kind === 'material') {
    const lit_value = project_lit_semantic_value(args.semantic_value, resolve_light_mag(args.light_mag));
    const resolved = resolve_material_rgb(appearance.material_id, lit_value);
    return resolved ? apply_rgb_policy(resolved, policy) : null;
  }
  const material_id = args.materials?.[args.slot] ?? args.materials?.[1];
  if (!material_id) return null;
  const lit_value = project_lit_semantic_value(args.semantic_value, resolve_light_mag(args.light_mag));
  const resolved = resolve_material_rgb(material_id, lit_value);
  return resolved ? apply_rgb_policy(resolved, policy) : null;
}

export function resolve_primary_cell_rgb(args: ResolvePrimaryCellRgbArgs): Rgb {
  const resolved = resolve_appearance_slot_rgb({
    slot: args.slot ?? 1,
    semantic_value: args.semantic_value ?? '2nd_lightest',
    appearance_slots: args.appearance_slots,
    materials: args.materials,
    light_mag: args.light_mag,
    rgb_policy: args.rgb_policy,
  });
  return resolved ?? apply_rgb_policy(args.rgb, args.rgb_policy ?? 'preserve');
}

export function blend_resolved_rgb(a: Rgb, b: Rgb, mix: number, rgb_policy: AppearanceRgbPolicy = 'preserve'): Rgb {
  return apply_rgb_policy(lerp_rgb(a, b, mix), rgb_policy);
}
