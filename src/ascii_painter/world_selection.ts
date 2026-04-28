import type { GridCell } from './types.js';
import type { PlaceViewState } from '../mono_ui/runtime/place_view_projection.js';

export type WorldCellKey = `${number},${number},${number}`;

export type WorldSelection = {
  cells: Set<WorldCellKey>;
};

export type WorldCopyData = {
  anchor: { x: number; y: number; z: number };
  source_view: PlaceViewState;
  cells: Array<{
    dx: number;
    dy: number;
    dz: number;
    cell: GridCell | null;
  }>;
};

const WORLD_COPY_PREFIX = 'THAUM3D:';

function cloneCell(cell: GridCell | null): GridCell | null {
  if (!cell) return null;
  return {
    char: cell.char,
    rgb: { ...cell.rgb },
    weight_index: cell.weight_index,
  };
}

export function make_world_cell_key(x: number, y: number, z: number): WorldCellKey {
  return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
}

export function parse_world_cell_key(key: WorldCellKey): { x: number; y: number; z: number } {
  const [x, y, z] = key.split(',').map((value) => Number.parseInt(value, 10));
  return { x: x || 0, y: y || 0, z: z || 0 };
}

export function create_world_selection(): WorldSelection {
  return { cells: new Set<WorldCellKey>() };
}

export function clone_world_selection(selection: WorldSelection): WorldSelection {
  return { cells: new Set(selection.cells) };
}

export function clear_world_selection(selection: WorldSelection): void {
  selection.cells.clear();
}

export function has_world_selection(selection: WorldSelection): boolean {
  return selection.cells.size > 0;
}

export function set_world_selected(selection: WorldSelection, x: number, y: number, z: number, selected: boolean): void {
  const key = make_world_cell_key(x, y, z);
  if (selected) selection.cells.add(key);
  else selection.cells.delete(key);
}

export function is_world_selected(selection: WorldSelection, x: number, y: number, z: number): boolean {
  return selection.cells.has(make_world_cell_key(x, y, z));
}

export function get_world_selection_bounds(selection: WorldSelection): { min_x: number; min_y: number; min_z: number; max_x: number; max_y: number; max_z: number } | null {
  if (selection.cells.size < 1) return null;
  let min_x = Number.POSITIVE_INFINITY;
  let min_y = Number.POSITIVE_INFINITY;
  let min_z = Number.POSITIVE_INFINITY;
  let max_x = Number.NEGATIVE_INFINITY;
  let max_y = Number.NEGATIVE_INFINITY;
  let max_z = Number.NEGATIVE_INFINITY;
  for (const key of selection.cells) {
    const point = parse_world_cell_key(key);
    min_x = Math.min(min_x, point.x);
    min_y = Math.min(min_y, point.y);
    min_z = Math.min(min_z, point.z);
    max_x = Math.max(max_x, point.x);
    max_y = Math.max(max_y, point.y);
    max_z = Math.max(max_z, point.z);
  }
  return { min_x, min_y, min_z, max_x, max_y, max_z };
}

export function apply_world_selection_mode(current: WorldSelection, incoming: WorldSelection, mode: 'replace' | 'additive' | 'subtract' | 'intersect'): void {
  if (mode === 'replace') {
    current.cells = new Set(incoming.cells);
    return;
  }
  if (mode === 'additive') {
    for (const key of incoming.cells) current.cells.add(key);
    return;
  }
  if (mode === 'subtract') {
    for (const key of incoming.cells) current.cells.delete(key);
    return;
  }
  const next = new Set<WorldCellKey>();
  for (const key of incoming.cells) {
    if (current.cells.has(key)) next.add(key);
  }
  current.cells = next;
}

export function encode_world_copy_data(data: WorldCopyData): string {
  return `${WORLD_COPY_PREFIX}${JSON.stringify(data)}`;
}

export function decode_world_copy_data(encoded: string): WorldCopyData | null {
  if (!encoded.startsWith(WORLD_COPY_PREFIX)) return null;
  try {
    const parsed = JSON.parse(encoded.slice(WORLD_COPY_PREFIX.length));
    if (!parsed || !parsed.anchor || !Array.isArray(parsed.cells)) return null;
    return parsed as WorldCopyData;
  } catch {
    return null;
  }
}
