import { clamp_weight_index } from '../mono_ui/weight_system.js';
import type { DiscriminatedRenderPayload, RenderContext, RenderLayer } from './types.js';
import type { AppearanceSlotAssignments, EffectiveRenderState, GraphicOverrideRule, GraphicsModel, StateMatch, ViewDirection } from './graphics_contract.js';
import { make_text_graphic_id } from './graphics_contract.js';
import { resolve_connected_graphic_id } from './tile_connectivity.js';

function normalize_view_direction(value: unknown): ViewDirection {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'south' || raw === 'east' || raw === 'west' || raw === 'up' || raw === 'down') return raw;
  return 'north';
}

function get_state_value(state: Record<string, unknown> | undefined, path: string): unknown {
  if (!state || typeof path !== 'string' || path.length <= 0) return undefined;
  let current: unknown = state;
  for (const part of path.split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function matches_state(state: Record<string, unknown> | undefined, checks: StateMatch[] | undefined): boolean {
  if (!Array.isArray(checks) || checks.length <= 0) return false;
  return checks.every((check) => {
    const value = get_state_value(state, check.path);
    if (Object.prototype.hasOwnProperty.call(check, 'equals')) return value === check.equals;
    if (Array.isArray(check.in)) return check.in.includes(value as never);
    return value !== undefined;
  });
}

function get_tag_names(payload: DiscriminatedRenderPayload | undefined): string[] {
  const tags = Array.isArray(payload?.tags) ? payload.tags : [];
  return tags.map((tag) => String((tag as any)?.name ?? '')).filter((name) => name.length > 0);
}

function matches_tag_override(rule: Extract<GraphicOverrideRule, { kind: 'tags' }>, tagNames: string[]): boolean {
  if (Array.isArray(rule.when_tags_all) && !rule.when_tags_all.every((tag) => tagNames.includes(tag))) return false;
  if (Array.isArray(rule.when_tags_any) && rule.when_tags_any.length > 0 && !rule.when_tags_any.some((tag) => tagNames.includes(tag))) return false;
  if (Array.isArray(rule.when_tags_none) && rule.when_tags_none.some((tag) => tagNames.includes(tag))) return false;
  return true;
}

function merge_appearance_slots(payloadSlots: AppearanceSlotAssignments | undefined, layerSlots: AppearanceSlotAssignments | undefined): AppearanceSlotAssignments | undefined {
  const merged = { ...(payloadSlots ?? {}), ...(layerSlots ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function derive_material_assignments_from_appearance_slots(appearance_slots: AppearanceSlotAssignments | undefined): Partial<Record<1 | 2 | 3, string>> {
  const materials: Partial<Record<1 | 2 | 3, string>> = {};
  if (!appearance_slots) return materials;
  for (const slot of [1, 2, 3] as const) {
    const value = appearance_slots[slot];
    if (value?.kind === 'material' && value.material_id) materials[slot] = value.material_id;
  }
  return materials;
}

function apply_graphics_overrides(graphics: GraphicsModel | undefined, payload: DiscriminatedRenderPayload | undefined, baseWeight: 0 | 1 | 2 | 3, baseMaterials: Partial<Record<1 | 2 | 3, string>>): { graphic_id: string; weight: 0 | 1 | 2 | 3; materials: Partial<Record<1 | 2 | 3, string>> } | null {
  if (!graphics) return null;
  let graphic_id = graphics.base_graphic_id;
  let weight = baseWeight;
  const materials: Partial<Record<1 | 2 | 3, string>> = { ...baseMaterials };
  const overrides = Array.isArray(graphics.overrides) ? graphics.overrides : [];
  const state = payload?.state;
  const tagNames = get_tag_names(payload);

  for (const rule of overrides) {
    let matched = false;
    if (rule.kind === 'state') matched = matches_state(state, rule.when_state);
    if (rule.kind === 'tags') matched = matches_tag_override(rule, tagNames);
    if (!matched) continue;
    if (typeof rule.graphic_id === 'string' && rule.graphic_id.length > 0) graphic_id = rule.graphic_id;
    if (rule.material_slots) Object.assign(materials, rule.material_slots);
    if (typeof rule.set_weight === 'number') weight = clamp_weight_index(rule.set_weight) as 0 | 1 | 2 | 3;
    if (typeof (rule as any).add_weight === 'number') weight = clamp_weight_index(weight + (rule as any).add_weight) as 0 | 1 | 2 | 3;
  }

  return { graphic_id, weight, materials };
}

export function resolve_effective_render_state(layer: RenderLayer, ctx: RenderContext, payload?: DiscriminatedRenderPayload): EffectiveRenderState {
  const payload_graphics = payload?.graphics;
  const view_direction = normalize_view_direction(layer.graphic?.view_direction ?? ctx.view_direction);
  const facing = layer.graphic?.facing ?? normalize_view_direction(payload?.facing ?? ctx.facing);
  const baseWeight = clamp_weight_index(layer.graphic?.weight_index ?? layer.weight_index ?? payload_graphics?.default_weight) as 0 | 1 | 2 | 3;
  const appearance_slots = merge_appearance_slots(payload?.appearance_slots, layer.appearance_slots);
  const baseMaterials = {
    ...(payload_graphics?.material_slots ?? {}),
    ...(payload?.materials ?? {}),
    ...(layer.materials ?? {}),
    ...derive_material_assignments_from_appearance_slots(appearance_slots),
  } as Partial<Record<1 | 2 | 3, string>>;
  const overridden = apply_graphics_overrides(payload_graphics, payload, baseWeight, baseMaterials);
  const baseGraphicId = layer.graphic?.graphic_id ?? overridden?.graphic_id ?? payload_graphics?.base_graphic_id ?? make_text_graphic_id(layer.char ?? ' ');
  return {
    graphic_id: resolve_connected_graphic_id(payload_graphics, payload, ctx, baseGraphicId),
    weight: overridden?.weight ?? baseWeight,
    material_slots: overridden?.materials ?? baseMaterials,
    appearance_slots,
    view_direction,
    facing,
    part_role: payload?.group_context?.part_role ?? ctx.group_context?.part_role,
  };
}
