import { calculate_grid_dimensions } from "../types/container.js";
import { has_effective_tag, resolve_inline_item } from "../item_storage/resolve.js";
import type { InlineItem } from "../types/inline_item.js";
import type {
  OwnerInventoryView,
  StorageContributorKind,
  StorageContributorRef,
  StorageDisplayRegion,
  StorageOwnerRef,
  StorageSlot,
  StorageSlotItemSummary,
  StorageSurface,
} from "./types.js";
import { build_slot_target_id, build_surface_target_id } from "./target_ids.js";

type NormalizedEntry = {
  item: InlineItem;
  grid_x: number;
  grid_y: number;
};

type BuildContainerOwnerViewArgs = {
  owner: StorageOwnerRef;
  owner_name: string;
  contributor_id: string;
  contributor_kind: StorageContributorKind;
  contributor_name: string;
  contributor_depth: number;
  contributor_sort_key: string;
  surface_id: string;
  container_id: string;
  surface_label?: string;
  display_region?: StorageDisplayRegion;
  normalized_contents: NormalizedEntry[];
  slot_count: number;
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

export function build_container_owner_inventory_view(args: BuildContainerOwnerViewArgs): OwnerInventoryView {
  const contributor: StorageContributorRef = {
    id: args.contributor_id,
    kind: args.contributor_kind,
    name: args.contributor_name,
    depth: args.contributor_depth,
    sort_key: args.contributor_sort_key,
  };

  const occupiedByIndex = new Map<number, InlineItem>();
  const { cols } = calculate_grid_dimensions(Math.max(1, args.slot_count));
  for (const entry of args.normalized_contents) {
    const slot_index = (entry.grid_y * cols) + entry.grid_x;
    if (!occupiedByIndex.has(slot_index)) occupiedByIndex.set(slot_index, entry.item);
  }

  const slots: StorageSlot[] = [];
  for (let slot_index = 0; slot_index < args.slot_count; slot_index += 1) {
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
      slot_kind: "container",
      occupied: !!child,
      is_placeholder: !child,
      item: child ? summarize_item(child) : undefined,
    });
  }

  const surface: StorageSurface = {
    id: args.surface_id,
    surface_target_id: build_surface_target_id(args.container_id),
    owner: args.owner,
    contributor,
    surface_kind: "container",
    display_region: args.display_region ?? "main",
    label: args.surface_label ?? "CONTAINER",
    slot_count: args.slot_count,
    min_visible_slots: args.slot_count,
    auto_expand: false,
    accepts_player_insert: true,
    accepts_player_withdraw: true,
    accepts_system_insert: true,
    slots,
  };

  return {
    owner: args.owner,
    owner_name: args.owner_name,
    layout_mode: "owner_vertical_grouped",
    groups: [{ contributor, surfaces: [surface] }],
  };
}
