import { calculate_grid_dimensions } from "../types/container.js";
import type { InlineBodySlot, InlineItem } from "../types/inline_item.js";
import { SLOT_DISPLAY_NAMES, STANDARD_BODY_SLOTS } from "../types/body_slots.js";
import { has_effective_tag, resolve_inline_item } from "../item_storage/resolve.js";
import type {
  OwnerInventoryGroup,
  OwnerInventoryView,
  StorageContributorRef,
  StorageOwnerRef,
  StorageSlot,
  StorageSlotItemSummary,
  StorageSurface,
} from "./types.js";
import { build_slot_target_id, build_surface_target_id } from "./target_ids.js";

type BodySlotType = "tool" | "armor" | "garb";

function summarize_item(item: InlineItem): StorageSlotItemSummary {
  const resolved = resolve_inline_item(String(item?.def_id ?? ""), item);
  return {
    id: String(item?.id ?? ""),
    def_id: String(item?.def_id ?? ""),
    name: resolved?.name ?? String((item as any)?.name ?? item?.def_id ?? "unknown"),
    qty: typeof item?.qty === "number" && Number.isFinite(item.qty) && item.qty > 0 ? Math.floor(item.qty) : 1,
    display_char: resolved?.display_char ?? (String((item as any)?.display_char ?? "?").charAt(0) || "?"),
    display_color: resolved?.display_color ?? (typeof (item as any)?.display_color === "string" ? String((item as any).display_color) : null),
    is_container: !!resolved && has_effective_tag(resolved.effective_tags, "CONTAINER"),
    tags: Array.isArray(resolved?.effective_tags) ? resolved.effective_tags : [],
    graphics: resolved?.graphics,
    material_options: resolved?.material_options,
    materials: resolved?.materials,
    state: resolved?.state,
    facing: resolved?.facing,
  };
}

function make_body_slot_contributor(slot_name: string, sort_index: number): StorageContributorRef {
  const display = SLOT_DISPLAY_NAMES[slot_name] ?? String(slot_name ?? "").replace(/_/g, " ").toUpperCase();
  return {
    id: `actor.body_slot.${slot_name}`,
    kind: "body_slot",
    name: display,
    depth: 0,
    sort_key: `body:${String(sort_index).padStart(3, "0")}:${slot_name}`,
  };
}

function build_single_slot_surface(opts: {
  owner: StorageOwnerRef;
  contributor: StorageContributorRef;
  slot_name: string;
  slot_kind: "tool" | "armor";
  item: InlineItem | null;
}): StorageSurface {
  const surface_id = `surface:${opts.contributor.id}:${opts.slot_kind}`;
  const slots: StorageSlot[] = [
    {
      id: `${surface_id}:0`,
      surface_id,
      slot_target_id: build_slot_target_id(`body_slots.${opts.slot_name}.${opts.slot_kind}`, 0),
      slot_index: 0,
      grid_x: 0,
      grid_y: 0,
      slot_kind: opts.slot_kind,
      occupied: !!opts.item,
      item: opts.item ? summarize_item(opts.item) : undefined,
      is_placeholder: !opts.item,
    },
  ];
  return {
    id: surface_id,
    surface_target_id: build_surface_target_id(`body_slots.${opts.slot_name}.${opts.slot_kind}`),
    owner: opts.owner,
    contributor: opts.contributor,
    surface_kind: opts.slot_kind,
    display_region: "body",
    label: opts.slot_kind.toUpperCase(),
    slot_count: 1,
    min_visible_slots: 1,
    auto_expand: false,
    accepts_player_insert: true,
    accepts_player_withdraw: true,
    accepts_system_insert: true,
    slots,
  };
}

function build_garb_surface(owner: StorageOwnerRef, contributor: StorageContributorRef, slot_name: string, items: InlineItem[]): StorageSurface {
  const surface_id = `surface:${contributor.id}:garb`;
  const surface_container_id = `body_slots.${slot_name}.garb`;
  const slots: StorageSlot[] = [];
  const live_items = Array.isArray(items) ? items.filter(Boolean) : [];
  for (let i = 0; i < live_items.length; i += 1) {
    const slot_container_id = `body_slots.${slot_name}.garb.${i}`;
    slots.push({
      id: `${surface_id}:${i}`,
      surface_id,
      slot_target_id: build_slot_target_id(slot_container_id, i),
      slot_index: i,
      grid_x: i,
      grid_y: 0,
      slot_kind: "garb",
      occupied: true,
      item: summarize_item(live_items[i]!),
    });
  }
  slots.push({
    id: `${surface_id}:${live_items.length}`,
    surface_id,
    slot_target_id: build_slot_target_id(`body_slots.${slot_name}.garb.${live_items.length}`, live_items.length),
    slot_index: live_items.length,
    grid_x: live_items.length,
    grid_y: 0,
    slot_kind: "garb",
    occupied: false,
    is_placeholder: true,
  });
  return {
    id: surface_id,
    surface_target_id: build_surface_target_id(surface_container_id),
    owner,
    contributor,
    surface_kind: "garb",
    display_region: "body",
    label: "GARB",
    slot_count: slots.length,
    min_visible_slots: 1,
    auto_expand: true,
    accepts_player_insert: true,
    accepts_player_withdraw: true,
    accepts_system_insert: true,
    slots,
  };
}

function get_container_slot_count(item: InlineItem): number {
  const cap = Number((item as any)?.container_capacity?.max_slots ?? 0);
  if (Number.isFinite(cap) && cap > 0) return Math.max(1, Math.floor(cap));
  const count = Array.isArray(item?.contents) ? item.contents.length : 0;
  return Math.max(1, count);
}

function assign_container_positions(contents: InlineItem[], slot_count: number): Array<{ item: InlineItem; grid_x: number; grid_y: number }> {
  const { cols, rows } = calculate_grid_dimensions(slot_count);
  const limit = Math.max(1, cols * rows);
  const occupied = new Set<string>();
  const out: Array<{ item: InlineItem; grid_x: number; grid_y: number }> = [];
  const items = Array.isArray(contents) ? contents.filter(Boolean) : [];

  for (const item of items) {
    const gx = Math.floor(Number((item as any)?.grid_x));
    const gy = Math.floor(Number((item as any)?.grid_y));
    const in_bounds = Number.isFinite(gx) && Number.isFinite(gy) && gx >= 0 && gy >= 0 && gx < cols && gy < rows;
    const key = `${gx},${gy}`;
    if (in_bounds && !occupied.has(key)) {
      occupied.add(key);
      out.push({ item, grid_x: gx, grid_y: gy });
      continue;
    }

    for (let slot_index = 0; slot_index < limit; slot_index += 1) {
      const x = slot_index % cols;
      const y = Math.floor(slot_index / cols);
      const fallback_key = `${x},${y}`;
      if (occupied.has(fallback_key)) continue;
      occupied.add(fallback_key);
      out.push({ item, grid_x: x, grid_y: y });
      break;
    }
  }

  return out;
}

function build_container_surface(opts: {
  owner: StorageOwnerRef;
  contributor: StorageContributorRef;
  slot_name: string;
  slot_type: BodySlotType;
  garb_index: number | null;
  item: InlineItem;
}): StorageSurface | null {
  const resolved = resolve_inline_item(String(opts.item?.def_id ?? ""), opts.item);
  if (!resolved || !has_effective_tag(resolved.effective_tags, "CONTAINER")) return null;

  const slot_count = get_container_slot_count(opts.item);
  const placed = assign_container_positions(Array.isArray(opts.item?.contents) ? opts.item.contents : [], slot_count);
  const occupied_by_index = new Map<number, InlineItem>();
  const { cols } = calculate_grid_dimensions(slot_count);
  for (const entry of placed) {
    const slot_index = (entry.grid_y * cols) + entry.grid_x;
    if (!occupied_by_index.has(slot_index)) occupied_by_index.set(slot_index, entry.item);
  }

  const path_suffix = opts.slot_type === "garb" ? `${opts.slot_name}.garb.${opts.garb_index ?? 0}` : `${opts.slot_name}.${opts.slot_type}`;
  const container_id = `body_slots.${path_suffix}`;
  const surface_id = `surface:${opts.contributor.id}:container:${opts.item.id}`;
  const slots: StorageSlot[] = [];
  for (let slot_index = 0; slot_index < slot_count; slot_index += 1) {
    const x = slot_index % cols;
    const y = Math.floor(slot_index / cols);
    const child = occupied_by_index.get(slot_index) ?? null;
    slots.push({
      id: `${surface_id}:${slot_index}`,
      surface_id,
      slot_target_id: build_slot_target_id(container_id, slot_index),
      slot_index,
      grid_x: x,
      grid_y: y,
      slot_kind: "container",
      occupied: !!child,
      is_placeholder: !child,
      item: child ? summarize_item(child) : undefined,
    });
  }

  return {
    id: surface_id,
    surface_target_id: build_surface_target_id(container_id),
    owner: opts.owner,
    contributor: opts.contributor,
    surface_kind: "container",
    display_region: "attached_storage",
    label: resolved.name.toUpperCase(),
    slot_count,
    min_visible_slots: slot_count,
    auto_expand: false,
    accepts_player_insert: true,
    accepts_player_withdraw: true,
    accepts_system_insert: true,
    slots,
  };
}

function get_body_slot_names(body_slots: Record<string, InlineBodySlot>): string[] {
  const preferred = Object.values(STANDARD_BODY_SLOTS);
  const preferred_set = new Set<string>(preferred);
  const extras = Object.keys(body_slots).filter((name) => !preferred_set.has(name)).sort();
  return [...preferred.filter((name) => !!body_slots[name]), ...extras];
}

function build_attached_contributor(item: InlineItem, slot_name: string, slot_type: BodySlotType, garb_index: number | null): StorageContributorRef {
  const resolved = resolve_inline_item(String(item?.def_id ?? ""), item);
  const held = slot_type === "tool" && (slot_name === "hand_left" || slot_name === "hand_right");
  const slot_suffix = slot_type === "garb" ? `${slot_type}.${garb_index ?? 0}` : slot_type;
  return {
    id: `actor.attached.${slot_name}.${slot_suffix}.${String(item?.id ?? "unknown")}`,
    kind: held ? "held_item" : "equipped_item",
    name: resolved?.name ?? String((item as any)?.name ?? item?.def_id ?? "CONTAINER"),
    depth: 1,
    sort_key: `attached:${slot_name}:${slot_suffix}:${resolved?.name ?? item?.def_id ?? ""}`,
  };
}

function maybe_add_container_surface(
  groups: OwnerInventoryGroup[],
  owner: StorageOwnerRef,
  slot_name: string,
  slot_type: BodySlotType,
  garb_index: number | null,
  item: InlineItem | null,
): void {
  if (!item) return;
  const contributor = build_attached_contributor(item, slot_name, slot_type, garb_index);
  const surface = build_container_surface({ owner, contributor, slot_name, slot_type, garb_index, item });
  if (!surface) return;
  groups.push({ contributor, surfaces: [surface] });
}

export function build_actor_owner_inventory_view(actor_id: string, actor: any): OwnerInventoryView {
  return build_character_owner_inventory_view("actor", actor_id, actor);
}

export function build_npc_owner_inventory_view(npc_id: string, npc: any): OwnerInventoryView {
  return build_character_owner_inventory_view("npc", npc_id, npc);
}

function build_character_owner_inventory_view(kind: "actor" | "npc", character_id: string, character: any): OwnerInventoryView {
  const owner: StorageOwnerRef = { kind, id: character_id };
  const owner_name = String(character?.name ?? character_id);
  const body_slots = (character?.body_slots ?? {}) as Record<string, InlineBodySlot>;
  const groups: OwnerInventoryGroup[] = [];

  const slot_names = get_body_slot_names(body_slots);
  for (let i = 0; i < slot_names.length; i += 1) {
    const slot_name = slot_names[i]!;
    const slot = body_slots[slot_name];
    if (!slot) continue;
    const contributor = make_body_slot_contributor(slot_name, i);
    const surfaces: StorageSurface[] = [];
    if (slot_name === "hand_left" || slot_name === "hand_right") {
      surfaces.push(build_single_slot_surface({ owner, contributor, slot_name, slot_kind: "tool", item: slot.tool ?? null }));
    }
    surfaces.push(build_single_slot_surface({ owner, contributor, slot_name, slot_kind: "armor", item: slot.armor ?? null }));
    surfaces.push(build_garb_surface(owner, contributor, slot_name, Array.isArray(slot.garb) ? slot.garb : []));
    groups.push({ contributor, surfaces });

    maybe_add_container_surface(groups, owner, slot_name, "armor", null, slot.armor ?? null);
    if (slot_name === "hand_left" || slot_name === "hand_right") {
      maybe_add_container_surface(groups, owner, slot_name, "tool", null, slot.tool ?? null);
    }
    const garb_items = Array.isArray(slot.garb) ? slot.garb : [];
    for (let garb_index = 0; garb_index < garb_items.length; garb_index += 1) {
      maybe_add_container_surface(groups, owner, slot_name, "garb", garb_index, garb_items[garb_index] ?? null);
    }
  }

  groups.sort((a, b) => a.contributor.sort_key.localeCompare(b.contributor.sort_key));

  return {
    owner,
    owner_name,
    layout_mode: "actor_vertical_grouped",
    groups,
  };
}
