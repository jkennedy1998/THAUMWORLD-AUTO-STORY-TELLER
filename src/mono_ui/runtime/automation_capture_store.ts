import type {
  ToolAssistedInputsMovementTrace,
  ToolAssistedInputsPainterCell,
  ToolAssistedInputsPainterInteractionAnchor,
  ToolAssistedInputsPainterToolState,
  ToolAssistedInputsTile,
  ToolAssistedInputsVisibleStep,
} from './automation_interfaces.js';

export function create_tool_assisted_inputs_capture_store(): {
  reset: () => void;
  set_tile: (slot: string, tile: ToolAssistedInputsTile) => void;
  get_tile: (slot: string) => ToolAssistedInputsTile | null;
  list_tile_slots: () => string[];
  set_movement_trace: (slot: string, trace: ToolAssistedInputsMovementTrace) => void;
  get_movement_trace: (slot: string) => ToolAssistedInputsMovementTrace | null;
  list_movement_trace_slots: () => string[];
  set_visible_step: (slot: string, step: ToolAssistedInputsVisibleStep) => void;
  get_visible_step: (slot: string) => ToolAssistedInputsVisibleStep | null;
  list_visible_step_slots: () => string[];
  set_painter_tool_state: (slot: string, state: ToolAssistedInputsPainterToolState) => void;
  get_painter_tool_state: (slot: string) => ToolAssistedInputsPainterToolState | null;
  list_painter_tool_state_slots: () => string[];
  set_painter_anchor: (slot: string, anchor: ToolAssistedInputsPainterInteractionAnchor) => void;
  get_painter_anchor: (slot: string) => ToolAssistedInputsPainterInteractionAnchor | null;
  list_painter_anchor_slots: () => string[];
  set_painter_cell: (slot: string, cell: ToolAssistedInputsPainterCell | null) => void;
  get_painter_cell: (slot: string) => ToolAssistedInputsPainterCell | null;
  list_painter_cell_slots: () => string[];
} {
  let tiles: Record<string, ToolAssistedInputsTile> = {};
  let movement_traces: Record<string, ToolAssistedInputsMovementTrace> = {};
  let visible_steps: Record<string, ToolAssistedInputsVisibleStep> = {};
  let painter_tool_states: Record<string, ToolAssistedInputsPainterToolState> = {};
  let painter_anchors: Record<string, ToolAssistedInputsPainterInteractionAnchor> = {};
  let painter_cells: Record<string, ToolAssistedInputsPainterCell | null> = {};
  return {
    reset(): void {
      tiles = {};
      movement_traces = {};
      visible_steps = {};
      painter_tool_states = {};
      painter_anchors = {};
      painter_cells = {};
    },
    set_tile(slot, tile): void { tiles[slot] = tile; },
    get_tile(slot): ToolAssistedInputsTile | null { return tiles[slot] ?? null; },
    list_tile_slots(): string[] { return Object.keys(tiles); },
    set_movement_trace(slot, trace): void { movement_traces[slot] = trace; },
    get_movement_trace(slot): ToolAssistedInputsMovementTrace | null { return movement_traces[slot] ?? null; },
    list_movement_trace_slots(): string[] { return Object.keys(movement_traces); },
    set_visible_step(slot, step): void { visible_steps[slot] = step; },
    get_visible_step(slot): ToolAssistedInputsVisibleStep | null { return visible_steps[slot] ?? null; },
    list_visible_step_slots(): string[] { return Object.keys(visible_steps); },
    set_painter_tool_state(slot, state): void { painter_tool_states[slot] = state; },
    get_painter_tool_state(slot): ToolAssistedInputsPainterToolState | null { return painter_tool_states[slot] ?? null; },
    list_painter_tool_state_slots(): string[] { return Object.keys(painter_tool_states); },
    set_painter_anchor(slot, anchor): void { painter_anchors[slot] = anchor; },
    get_painter_anchor(slot): ToolAssistedInputsPainterInteractionAnchor | null { return painter_anchors[slot] ?? null; },
    list_painter_anchor_slots(): string[] { return Object.keys(painter_anchors); },
    set_painter_cell(slot, cell): void { painter_cells[slot] = cell; },
    get_painter_cell(slot): ToolAssistedInputsPainterCell | null { return painter_cells[slot] ?? null; },
    list_painter_cell_slots(): string[] { return Object.keys(painter_cells); },
  };
}
