import type { GraphicsModel, InlineMaterialAssignments, MaterialOptionsBySlot, ViewDirection } from "../render_shaders/graphics_contract.js";

export type StorageOwnerRef =
  | { kind: "actor"; id: string }
  | { kind: "npc"; id: string }
  | { kind: "tile"; place_id: string; x: number; y: number; z: number }
  | { kind: "structure"; place_id: string; structure_id: string }
  | { kind: "item"; owner_kind: "actor" | "npc" | "place"; owner_id: string; item_id: string };

export type StorageContributorKind =
  | "body_slot"
  | "equipped_item"
  | "held_item"
  | "tag"
  | "perk"
  | "owner_native"
  | "custom";

export type StorageSurfaceKind = "tool" | "armor" | "garb" | "container" | "grow" | "custom";

export type StorageDisplayRegion = "body" | "attached_storage" | "main" | "panel";

export type StorageContributorRef = {
  id: string;
  kind: StorageContributorKind;
  name: string;
  depth: number;
  sort_key: string;
};

export type StorageSlotItemSummary = {
  id: string;
  def_id: string;
  name: string;
  qty: number;
  display_char: string;
  display_color: string | null;
  is_container: boolean;
  tags: any[];
  resolved_tag_states?: any[];
  value_mag?: any;
  graphics?: GraphicsModel;
  material_options?: MaterialOptionsBySlot;
  materials?: InlineMaterialAssignments;
  state?: Record<string, unknown>;
  facing?: ViewDirection | string;
};

export type StorageSlot = {
  id: string;
  surface_id: string;
  slot_target_id: string;
  slot_index: number;
  grid_x: number;
  grid_y: number;
  slot_kind: StorageSurfaceKind;
  occupied: boolean;
  is_placeholder?: boolean;
  item?: StorageSlotItemSummary;
};

export type StorageSurface = {
  id: string;
  surface_target_id: string;
  owner: StorageOwnerRef;
  contributor: StorageContributorRef;
  surface_kind: StorageSurfaceKind;
  display_region: StorageDisplayRegion;
  label?: string;
  slot_count: number;
  min_visible_slots?: number;
  auto_expand?: boolean;
  accepts_player_insert: boolean;
  accepts_player_withdraw: boolean;
  accepts_system_insert: boolean;
  accepts_system_withdraw?: boolean;
  slots: StorageSlot[];
};

export type OwnerInventoryGroup = {
  contributor: StorageContributorRef;
  surfaces: StorageSurface[];
};

export type OwnerInventoryView = {
  owner: StorageOwnerRef;
  owner_name: string;
  layout_mode: "actor_vertical_grouped" | "owner_vertical_grouped";
  groups: OwnerInventoryGroup[];
};
