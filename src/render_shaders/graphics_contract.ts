export type ViewDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
export type CardinalDirection = 'north' | 'east' | 'south' | 'west';

export type GraphicId = string;

export type StateMatch = {
  path: string;
  equals?: string | number | boolean;
  in?: Array<string | number | boolean>;
};

export type InlineMaterialAssignments = Partial<Record<1 | 2 | 3, string>>;

export type GraphicOverrideRule =
  | {
      kind: 'state';
      when_state: StateMatch[];
      graphic_id?: GraphicId;
      material_slots?: InlineMaterialAssignments;
      set_weight?: 0 | 1 | 2 | 3;
    }
  | {
      kind: 'tags';
      when_tags_all?: string[];
      when_tags_any?: string[];
      when_tags_none?: string[];
      graphic_id?: GraphicId;
      material_slots?: InlineMaterialAssignments;
      set_weight?: 0 | 1 | 2 | 3;
      add_weight?: -3 | -2 | -1 | 0 | 1 | 2 | 3;
    };

export type GraphicsModel = {
  base_graphic_id: GraphicId;
  default_weight: 0 | 1 | 2 | 3;
  views?: Partial<Record<ViewDirection, {
    graphic_id?: GraphicId;
    same_as?: ViewDirection;
  }>>;
  material_slots?: InlineMaterialAssignments;
  overrides?: GraphicOverrideRule[];
  connectivity?: TileConnectivityModel;
};

export type TileConnectivityVariant =
  | 'isolated'
  | 'end_cap_n'
  | 'end_cap_e'
  | 'end_cap_s'
  | 'end_cap_w'
  | 'straight_horizontal'
  | 'straight_vertical'
  | 'corner_ne'
  | 'corner_se'
  | 'corner_sw'
  | 'corner_nw'
  | 't_missing_n'
  | 't_missing_e'
  | 't_missing_s'
  | 't_missing_w'
  | 'center'
  | 'cross';

export type TileConnectivityModel = {
  family: string;
  mode: 'cardinal_4';
  connect_tile_ids?: string[];
  variant_graphic_ids?: Partial<Record<TileConnectivityVariant, GraphicId>>;
};

export type MaterialOptionsBySlot = {
  defaults?: InlineMaterialAssignments;
  allowed?: Partial<Record<1 | 2 | 3, string[]>>;
};

export type GroupRenderContext = {
  group_id: string;
  group_kind: 'structure' | 'character';
  main_tile?: { x: number; y: number; z?: number };
  facing?: ViewDirection;
  shared_state?: Record<string, unknown>;
  part_role?: string;
};

export type RenderGraphicRef = {
  graphic_id: GraphicId;
  view_direction: ViewDirection;
  facing?: ViewDirection;
  weight_index: 0 | 1 | 2 | 3;
  variant?: string;
  frame?: string;
};

export type EffectiveRenderState = {
  graphic_id: GraphicId;
  weight: 0 | 1 | 2 | 3;
  material_slots: InlineMaterialAssignments;
  view_direction: ViewDirection;
  facing?: ViewDirection;
  part_role?: string;
};

export function make_text_graphic_id(char: string): GraphicId {
  const ch = String(char ?? ' ').charAt(0) || ' ';
  return `text_${ch}`;
}
