import { calculate_grid_dimensions } from "../types/container.js";
import { has_effective_tag, resolve_inline_item } from "../item_storage/resolve.js";
import type { InlineItem } from "../types/inline_item.js";
import type { OwnerInventoryGroup, OwnerInventoryView, StorageSlot, StorageSlotItemSummary, StorageSurface, StorageOwnerRef, StorageContributorRef } from "./types.js";
import { build_slot_target_id, build_surface_target_id } from "./target_ids.js";

type TileSurfaceArgs = {
  owner: StorageOwnerRef;
  contributor: StorageContributorRef;
  surface_id: string;
  container_id: string;
  surface_kind: "container" | "grow";
  label: string;
  slot_count: number;
  contents: InlineItem[];
  accepts_player_insert: boolean;
};

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

function build_tile_surface(args: TileSurfaceArgs): StorageSurface {
  const occupiedByIndex = new Map<number, InlineItem>();
  const slot_count = Math.max(1, args.slot_count);
  const { cols } = calculate_grid_dimensions(slot_count);
  for (const item of args.contents) {
    const gx = Math.max(0, Math.floor(Number((item as any)?.grid_x ?? 0)));
    const gy = Math.max(0, Math.floor(Number((item as any)?.grid_y ?? 0)));
    const idx = (gy * cols) + gx;
    if (!occupiedByIndex.has(idx)) occupiedByIndex.set(idx, item);
  }
  const slots: StorageSlot[] = [];
  for (let slot_index = 0; slot_index < slot_count; slot_index += 1) {
    const x = slot_index % cols;
    const y = Math.floor(slot_index / cols);
    const child = occupiedByIndex.get(slot_index) ?? null;
    slots.push({
      id: `${args.surface_id}:${slot_index}`,
      surface_id: args.surface_id,
      slot_target_id: build_slot_target_id(args.container_id, slot_index),
      slot_index,
      grid_x: x,
      grid_y: y,
      slot_kind: args.surface_kind,
      occupied: !!child,
      is_placeholder: !child,
      item: child ? summarize_item(child) : undefined,
    });
  }
  return {
    id: args.surface_id,
    surface_target_id: build_surface_target_id(args.container_id),
    owner: args.owner,
    contributor: args.contributor,
    surface_kind: args.surface_kind,
    display_region: "main",
    label: args.label,
    slot_count,
    min_visible_slots: slot_count,
    auto_expand: args.surface_kind === "grow",
    accepts_player_insert: args.accepts_player_insert,
    accepts_player_withdraw: true,
    accepts_system_insert: true,
    slots,
  };
}

export function build_tile_owner_inventory_view(args: {
  owner: StorageOwnerRef;
  owner_name: string;
  container?: { contributor_name: string; container_id: string; slot_count: number; contents: InlineItem[] } | null;
  grows?: Array<{ contributor_name: string; container_id: string; slot_count: number; contents: InlineItem[] }>;
}): OwnerInventoryView {
  const groups: OwnerInventoryGroup[] = [];
  if (args.container) {
    const contributor: StorageContributorRef = {
      id: `${args.container.container_id}:contributor`,
      kind: "owner_native",
      name: args.container.contributor_name,
      depth: 0,
      sort_key: `00:${args.container.contributor_name}`,
    };
    groups.push({
      contributor,
      surfaces: [build_tile_surface({
        owner: args.owner,
        contributor,
        surface_id: `surface:${args.container.container_id}:container`,
        container_id: args.container.container_id,
        surface_kind: "container",
        label: "CONTAINER",
        slot_count: args.container.slot_count,
        contents: args.container.contents,
        accepts_player_insert: true,
      })],
    });
  }
  for (let i = 0; i < (args.grows ?? []).length; i += 1) {
    const grow = args.grows![i]!;
    const contributor: StorageContributorRef = {
      id: `${grow.container_id}:contributor`,
      kind: "tag",
      name: grow.contributor_name,
      depth: 0,
      sort_key: `10:${String(i).padStart(3, "0")}:${grow.contributor_name}`,
    };
    groups.push({
      contributor,
      surfaces: [build_tile_surface({
        owner: args.owner,
        contributor,
        surface_id: `surface:${grow.container_id}:grow`,
        container_id: grow.container_id,
        surface_kind: "grow",
        label: "HARVEST",
        slot_count: grow.slot_count,
        contents: grow.contents,
        accepts_player_insert: false,
      })],
    });
  }
  return {
    owner: args.owner,
    owner_name: args.owner_name,
    layout_mode: "owner_vertical_grouped",
    groups,
  };
}
