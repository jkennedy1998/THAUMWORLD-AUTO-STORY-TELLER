export type InteractionPoint2D = {
  x: number;
  y: number;
};

export type InteractionPoint3D = {
  x: number;
  y: number;
  z: number;
};

export type ResolvedTargetDomain = 'ui_2d' | 'grid_2d' | 'world_3d' | 'hybrid';

export type ResolvedTargetType =
  | 'painter_cell'
  | 'painter_plane'
  | 'place_tile'
  | 'place_item'
  | 'place_entity'
  | 'inventory_slot'
  | 'equipment_slot'
  | 'text_cell'
  | 'ui_surface'
  | 'custom';

export type ResolvedTargetBase = {
  module_id: string;
  view_id: string;
  domain: ResolvedTargetDomain;
  target_type: ResolvedTargetType;
  target_ref: string;
  screen_position?: InteractionPoint2D | null;
  local_position?: InteractionPoint2D | null;
  world_position?: InteractionPoint3D | null;
  resolution_stage?: string | null;
  resolution_group?: string | null;
  priority?: number;
  accepts_payload_kinds?: readonly string[];
  highlight_kinds?: readonly string[];
  metadata?: Record<string, unknown>;
};

export type PainterCellResolvedTarget = ResolvedTargetBase & {
  target_type: 'painter_cell';
  domain: 'grid_2d' | 'world_3d' | 'hybrid';
  grid_position: InteractionPoint2D;
  world_position: InteractionPoint3D;
};

export type PainterPlaneResolvedTarget = ResolvedTargetBase & {
  target_type: 'painter_plane';
  domain: 'world_3d' | 'hybrid';
  world_position: InteractionPoint3D;
  plane_coordinate: number;
};

export type PlaceTileResolvedTarget = ResolvedTargetBase & {
  target_type: 'place_tile';
  domain: 'grid_2d' | 'world_3d' | 'hybrid';
  tile_position: InteractionPoint2D;
  world_position: InteractionPoint3D;
};

export type PlaceItemResolvedTarget = ResolvedTargetBase & {
  target_type: 'place_item';
  domain: 'world_3d' | 'hybrid';
  item_instance_id: string;
  world_position?: InteractionPoint3D | null;
};

export type PlaceEntityResolvedTarget = ResolvedTargetBase & {
  target_type: 'place_entity';
  domain: 'world_3d' | 'hybrid';
  entity_ref: string;
  entity_type?: 'npc' | 'actor' | 'item' | 'pile' | 'structure' | 'custom';
  world_position?: InteractionPoint3D | null;
};

export type InventorySlotResolvedTarget = ResolvedTargetBase & {
  target_type: 'inventory_slot';
  domain: 'ui_2d' | 'grid_2d';
  container_id: string;
  slot_index: number;
};

export type EquipmentSlotResolvedTarget = ResolvedTargetBase & {
  target_type: 'equipment_slot';
  domain: 'ui_2d' | 'grid_2d';
  slot_name: string;
  slot_type?: string | null;
  garb_index?: number | null;
  container_id?: string | null;
};

export type TextCellResolvedTarget = ResolvedTargetBase & {
  target_type: 'text_cell';
  domain: 'ui_2d' | 'grid_2d';
  text_position: InteractionPoint2D;
  character_index?: number | null;
};

export type UiSurfaceResolvedTarget = ResolvedTargetBase & {
  target_type: 'ui_surface';
  domain: 'ui_2d';
  surface_id: string;
};

export type CustomResolvedTarget = ResolvedTargetBase & {
  target_type: 'custom';
  custom_type: string;
};

export type ResolvedTarget =
  | PainterCellResolvedTarget
  | PainterPlaneResolvedTarget
  | PlaceTileResolvedTarget
  | PlaceItemResolvedTarget
  | PlaceEntityResolvedTarget
  | InventorySlotResolvedTarget
  | EquipmentSlotResolvedTarget
  | TextCellResolvedTarget
  | UiSurfaceResolvedTarget
  | CustomResolvedTarget;

export type OrderedResolvedTargets = {
  primary: ResolvedTarget | null;
  ordered: readonly ResolvedTarget[];
};
