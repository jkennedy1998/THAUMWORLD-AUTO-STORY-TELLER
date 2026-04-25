import type { SlotType } from '../../equipment/body_slot_resolver.js';
import type {
  EquipmentSlotResolvedTarget,
  InventorySlotResolvedTarget,
  PlaceTileResolvedTarget,
} from './interaction_target_runtime.js';

export function build_place_tile_target(args: {
  module_id: string;
  view_id: string;
  place_id: string;
  tile_x: number;
  tile_y: number;
  world_z: number;
  accepts_payload_kinds?: readonly string[];
}): PlaceTileResolvedTarget {
  return {
    module_id: args.module_id,
    view_id: args.view_id,
    domain: 'hybrid',
    target_type: 'place_tile',
    target_ref: `${args.place_id}:${args.tile_x}:${args.tile_y}:${args.world_z}`,
    local_position: { x: args.tile_x, y: args.tile_y },
    world_position: { x: args.tile_x, y: args.tile_y, z: args.world_z },
    tile_position: { x: args.tile_x, y: args.tile_y },
    priority: 0,
    accepts_payload_kinds: args.accepts_payload_kinds ?? ['item', 'entity', 'custom'],
    highlight_kinds: ['drop_target', 'place_tile'],
  };
}

export function build_inventory_slot_target(args: {
  module_id: string;
  view_id: string;
  container_id: string;
  slot_index: number;
  target_ref: string;
  grid_x?: number | null;
  grid_y?: number | null;
  accepts_payload_kinds?: readonly string[];
}): InventorySlotResolvedTarget {
  return {
    module_id: args.module_id,
    view_id: args.view_id,
    domain: 'grid_2d',
    target_type: 'inventory_slot',
    target_ref: args.target_ref,
    container_id: args.container_id,
    slot_index: args.slot_index,
    local_position: (typeof args.grid_x === 'number' && typeof args.grid_y === 'number') ? { x: args.grid_x, y: args.grid_y } : null,
    accepts_payload_kinds: args.accepts_payload_kinds ?? ['item'],
    highlight_kinds: ['inventory_slot', 'drop_target'],
    priority: 0,
  };
}

export function build_equipment_slot_target(args: {
  module_id: string;
  view_id: string;
  slot_name: string;
  slot_type: SlotType;
  garb_index?: number | null;
  container_id?: string | null;
}): EquipmentSlotResolvedTarget {
  const target_ref = args.slot_type === 'garb' && args.garb_index !== null && args.garb_index !== undefined
    ? `${args.slot_name}.${args.slot_type}.${args.garb_index}`
    : `${args.slot_name}.${args.slot_type}`;
  return {
    module_id: args.module_id,
    view_id: args.view_id,
    domain: 'ui_2d',
    target_type: 'equipment_slot',
    target_ref,
    slot_name: args.slot_name,
    slot_type: args.slot_type,
    garb_index: args.garb_index ?? null,
    container_id: args.container_id ?? null,
    accepts_payload_kinds: ['item'],
    highlight_kinds: ['equipment_slot', 'drop_target'],
    priority: 0,
  };
}
