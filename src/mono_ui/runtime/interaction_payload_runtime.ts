export type DragPayloadKind = 'item' | 'selection' | 'painter_tool' | 'entity' | 'ui' | 'custom';

export type DragPayloadBase = {
  payload_kind: DragPayloadKind;
  source_module_id: string;
  source_view_id: string;
  compatibility_tags?: readonly string[];
  preview_metadata?: Record<string, unknown>;
};

export type ItemDragPayload = DragPayloadBase & {
  payload_kind: 'item';
  item_instance_id: string;
  container_id?: string | null;
  slot_index?: number | null;
};

export type SelectionDragPayload = DragPayloadBase & {
  payload_kind: 'selection';
  selection_kind: string;
  selection_ref?: string | null;
};

export type PainterToolDragPayload = DragPayloadBase & {
  payload_kind: 'painter_tool';
  tool_id: string;
  tool_mode?: string | null;
};

export type EntityDragPayload = DragPayloadBase & {
  payload_kind: 'entity';
  entity_ref: string;
  entity_type?: string | null;
};

export type UiDragPayload = DragPayloadBase & {
  payload_kind: 'ui';
  source_target_id: string;
};

export type CustomDragPayload = DragPayloadBase & {
  payload_kind: 'custom';
  custom_kind: string;
  body: Record<string, unknown>;
};

export type DragPayload =
  | ItemDragPayload
  | SelectionDragPayload
  | PainterToolDragPayload
  | EntityDragPayload
  | UiDragPayload
  | CustomDragPayload;
