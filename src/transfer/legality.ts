import { calculate_grid_dimensions } from "../container_storage/grid_calculator.js";
import { find_actor_item_by_id } from "../item_storage/inline_store.js";
import { load_master_item } from "../item_storage/store.js";
import { load_master_tile } from "../tile_storage/store.js";
import type { TagInstance } from "../tag_system/registry.js";
import { apply_tag_deltas } from "../tag_system/tag_deltas.js";

type SlotType = 'armor' | 'tool' | 'garb';

export type GridTarget = { x: number; y: number } | null;

export type BodySlotTarget = {
  kind: 'body_slot';
  slot_name: string;
  slot_type: SlotType;
  garb_index: number | null;
};

export type ActorItemTarget = {
  kind: 'actor_item';
  actor_id: string;
  item_id: string;
};

export type Target = BodySlotTarget | ActorItemTarget;

export type LegalityOk = { ok: true };
export type LegalityErr = { ok: false; error: string; detail?: any };
export type LegalityResult = LegalityOk | LegalityErr;

export function parse_body_slots_path(p: string): BodySlotTarget | null {
  const parts = String(p || '').split('.');
  if (parts[0] !== 'body_slots') return null;
  if (!parts[1] || !parts[2]) return null;
  const slot_name = parts[1];
  const slot_type = parts[2] as SlotType;
  const garb_index = (slot_type === 'garb' && parts[3] !== undefined) ? parseInt(parts[3], 10) : null;
  return {
    kind: 'body_slot',
    slot_name,
    slot_type,
    garb_index: Number.isFinite(garb_index as any) ? garb_index : null,
  };
}

export function parse_actor_item_container_id(p: string): ActorItemTarget | null {
  const parts = String(p || '').split('.');
  // actor.item.<actor_id>.<item_id>
  if (parts[0] !== 'actor' || parts[1] !== 'item') return null;
  if (!parts[2] || !parts[3]) return null;
  return { kind: 'actor_item', actor_id: parts[2], item_id: parts[3] };
}

export function expand_body_slot_meta(meta: unknown): string[] {
  const m = String(meta ?? '').trim();
  if (!m) return [];
  if (m === 'hand') return ['hand_left', 'hand_right'];
  if (m === 'leg') return ['leg_left', 'leg_right'];
  if (m === 'head') return ['head'];
  if (m === 'torso') return ['torso'];
  if (['hand_left', 'hand_right', 'leg_left', 'leg_right', 'head', 'torso'].includes(m)) return [m];
  return [];
}

export function has_tag(item: any, tag_name: string): boolean {
  const tags = resolve_effective_tags(item);
  if (!Array.isArray(tags)) return false;
  const up = String(tag_name ?? '').toUpperCase();
  return tags.some((t: any) => String(t?.name ?? '').toUpperCase() === up);
}

export function get_tag(item: any, tag_name: string): any | null {
  const tags = resolve_effective_tags(item);
  if (!Array.isArray(tags)) return null;
  const up = String(tag_name ?? '').toUpperCase();
  return tags.find((t: any) => String(t?.name ?? '').toUpperCase() === up) ?? null;
}

function resolve_effective_tags(item: any): TagInstance[] {
  // Prefer database-derived tags for inline items.
  const def_id = typeof item?.def_id === 'string' ? String(item.def_id) : '';
  if (def_id) {
    const def_res = load_master_item(def_id);
    const tile_res = !def_res.ok ? load_master_tile(def_id) : null;
    const base = def_res.ok
      ? (def_res.item.tags ?? [])
      : (tile_res && tile_res.ok ? (tile_res.tile.tags ?? []) : []);
    const add = Array.isArray(item?.tag_add) ? (item.tag_add as TagInstance[]) : [];
    const remove = Array.isArray(item?.tag_remove)
      ? item.tag_remove
          .map((op: any) => ({ key: String(op?.key ?? ''), mag: Number(op?.mag ?? 0) }))
          .filter((op: any) => op.key && Number.isFinite(op.mag) && op.mag > 0)
          .map((op: any) => ({ key: op.key, mag: Math.floor(op.mag) }))
      : [];
    return apply_tag_deltas({ base, add, remove });
  }

  // Place tiles / structures used as inline containers.
  const kind = typeof item?.kind === 'string' ? String(item.kind) : '';
  if (kind) {
    const def_res = load_master_tile(kind);
    const base = def_res.ok ? (def_res.tile.tags ?? []) : [];
    const add = Array.isArray(item?.tag_add) ? (item.tag_add as TagInstance[]) : [];
    const remove = Array.isArray(item?.tag_remove)
      ? item.tag_remove
          .map((op: any) => ({ key: String(op?.key ?? ''), mag: Number(op?.mag ?? 0) }))
          .filter((op: any) => op.key && Number.isFinite(op.mag) && op.mag > 0)
          .map((op: any) => ({ key: op.key, mag: Math.floor(op.mag) }))
      : [];
    return apply_tag_deltas({ base, add, remove });
  }

  // Fallback: legacy stored tags.
  return Array.isArray(item?.tags) ? (item.tags as TagInstance[]) : [];
}

export function is_item_compatible_with_body_slot(item: any, target: BodySlotTarget): boolean {
  // Tool slots: tabletop flexibility (any item can be held)
  if (target.slot_type === 'tool') return true;

  if (target.slot_type === 'armor') {
    const armor_tag = get_tag(item, 'ARMOR');
    if (!armor_tag) return false;
    const meta = Array.isArray(armor_tag.meta) ? armor_tag.meta : [];
    const expanded = meta.flatMap((m: any) => expand_body_slot_meta(m));
    return expanded.includes(target.slot_name);
  }

  if (target.slot_type === 'garb') {
    const garb_tag = get_tag(item, 'GARB');
    if (!garb_tag) return false;
    const meta = Array.isArray(garb_tag.meta) ? garb_tag.meta : [];
    const expanded = meta.flatMap((m: any) => expand_body_slot_meta(m));
    return expanded.includes(target.slot_name);
  }

  return false;
}

export function get_container_capacity_max_slots(container_item: any): number {
  const cap = container_item?.container_capacity?.max_slots;
  if (typeof cap === 'number' && Number.isFinite(cap) && cap > 0) return Math.floor(cap);
  const fallback = Array.isArray(container_item?.contents) ? container_item.contents.length : 0;
  return Math.max(1, fallback);
}

export function validate_grid_target(max_slots: number, grid: GridTarget): LegalityResult {
  if (!grid) return { ok: true };
  const { cols, rows } = calculate_grid_dimensions(max_slots);
  const slot_index = (grid.y * cols) + grid.x;
  const in_bounds = grid.x >= 0 && grid.y >= 0 && grid.x < cols && grid.y < rows && slot_index >= 0 && slot_index < max_slots;
  if (!in_bounds) return { ok: false, error: 'target_out_of_bounds', detail: { max_slots, cols, rows, grid } };
  return { ok: true };
}

export function validate_deposit_into_container_item(dest_container_item: any, moving_item: any, grid: GridTarget): LegalityResult {
  if (!has_tag(dest_container_item, 'CONTAINER')) return { ok: false, error: 'not_a_container' };
  if (!Array.isArray(dest_container_item.contents)) dest_container_item.contents = [];

  const max_slots = get_container_capacity_max_slots(dest_container_item);
  if (dest_container_item.contents.length >= max_slots) return { ok: false, error: 'container_full' };

  const max_weight = dest_container_item?.container_capacity?.max_weight;
  if (typeof max_weight === 'number' && Number.isFinite(max_weight) && max_weight > 0) {
    const current_weight = sum_inline_item_weights(dest_container_item.contents);
    const add_weight = sum_inline_item_weights([moving_item]);
    if (current_weight + add_weight > max_weight) {
      return { ok: false, error: 'container_overweight', detail: { current_weight, add_weight, max_weight } };
    }
  }

  const grid_ok = validate_grid_target(max_slots, grid);
  if (!grid_ok.ok) return grid_ok;

  if (grid) {
    const occupied = dest_container_item.contents.find((it: any) => it?.grid_x === grid.x && it?.grid_y === grid.y);
    if (occupied) return { ok: false, error: 'target_slot_occupied' };
  }

  return { ok: true };
}

function sum_inline_item_weights(items: any[], visited?: Set<string>): number {
  const seen = visited ?? new Set<string>();
  let total = 0;
  if (!Array.isArray(items)) return 0;
  for (const it of items) {
    if (!it) continue;
    const id = typeof it.id === 'string' ? it.id : null;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const qty = typeof it.qty === 'number' && Number.isFinite(it.qty) && it.qty > 0 ? it.qty : 1;
    const def_id = typeof it.def_id === 'string' ? it.def_id : '';
    const def_res = load_master_item(def_id);
    const unit = def_res.ok ? Number(def_res.item.weight ?? 0) : 0;
    total += unit * qty;
    if (Array.isArray(it.contents)) {
      total += sum_inline_item_weights(it.contents, seen);
    }
  }
  return total;
}

export function validate_equip_to_body_slot(actor: any, moving_item: any, target: BodySlotTarget): LegalityResult {
  const body_slots = actor?.body_slots;
  const slot = body_slots?.[target.slot_name];
  if (!slot) return { ok: false, error: 'slot_not_found' };

  if (!is_item_compatible_with_body_slot(moving_item, target)) {
    return { ok: false, error: 'incompatible_slot', detail: { slot_name: target.slot_name, slot_type: target.slot_type } };
  }

  if (target.slot_type === 'armor') {
    if (slot.armor) return { ok: false, error: 'armor_slot_occupied' };
    return { ok: true };
  }

  if (target.slot_type === 'tool') {
    if (slot.tool) return { ok: false, error: 'tool_slot_occupied' };
    return { ok: true };
  }

  if (target.slot_type === 'garb') {
    if (!Array.isArray(slot.garb)) slot.garb = [];
    const idx = target.garb_index;
    if (idx === null || idx === slot.garb.length) return { ok: true };
    if (idx < 0 || idx > slot.garb.length) return { ok: false, error: 'invalid_garb_index' };
    if (slot.garb[idx]) return { ok: false, error: 'garb_slot_occupied' };
    return { ok: true };
  }

  return { ok: false, error: 'invalid_to_path' };
}

export function resolve_target(to_container: string): Target | null {
  return parse_actor_item_container_id(to_container) || parse_body_slots_path(to_container);
}

export function resolve_actor_container_item(actor: any, actor_id: string, item_id: string): any | null {
  const found = find_actor_item_by_id(actor, item_id);
  if (!found) return null;
  return found.item;
}

export function validate_transfer_destination(
  actor: any,
  actor_id: string,
  moving_item: any,
  to_container: string,
  grid: GridTarget
): LegalityResult {
  const target = resolve_target(to_container);
  if (!target) return { ok: false, error: 'invalid_to_path' };

  if (target.kind === 'actor_item') {
    if (target.actor_id !== actor_id) return { ok: false, error: 'destination_not_found' };
    if (target.item_id === moving_item?.id) return { ok: false, error: 'self_deposit' };
    const dest_item = resolve_actor_container_item(actor, actor_id, target.item_id);
    if (!dest_item) return { ok: false, error: 'destination_not_found' };
    return validate_deposit_into_container_item(dest_item, moving_item, grid);
  }

  // body slot target
  // If the body slot currently contains a container-item (CONTAINER tag), treat this as container deposit.
  const body_slot = actor?.body_slots?.[target.slot_name];
  if (!body_slot) return { ok: false, error: 'slot_not_found' };
  let existing: any = null;
  if (target.slot_type === 'armor') existing = body_slot.armor;
  else if (target.slot_type === 'tool') existing = body_slot.tool;
  else if (target.slot_type === 'garb' && target.garb_index !== null) existing = body_slot.garb?.[target.garb_index] ?? null;

  if (existing && has_tag(existing, 'CONTAINER')) {
    if (existing.id === moving_item?.id) return { ok: false, error: 'self_deposit' };
    return validate_deposit_into_container_item(existing, moving_item, grid);
  }

  return validate_equip_to_body_slot(actor, moving_item, target);
}
