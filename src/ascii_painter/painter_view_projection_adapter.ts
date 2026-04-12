import type { GridCell } from './types.js';
import type { Grid } from './types.js';
import { createVoxelSpace, getOrCreateLayer, getVoxel, setVoxel, type VoxelLayer, type VoxelSpace } from './voxel_space.js';
import {
  build_visible_plane_coordinates,
  get_projected_bounds_with_roll,
  project_world_point_with_roll,
  unproject_plane_point_with_roll,
  type PlaceViewState,
} from '../mono_ui/runtime/place_view_projection.js';

export type PainterDisplayProjection = {
  space: VoxelSpace;
  visible_planes: number[];
  focus_slot: number;
  focus_world_plane: number | null;
  view_state: PlaceViewState;
  target_world: { x: number; y: number; z: number };
  projection_anchor_world: { x: number; y: number; z: number };
  target_projected: { u: number; v: number; plane: number };
  anchor_projected: { u: number; v: number; plane: number };
  content_bounds_by_slot: Array<{ min_x: number; min_y: number; max_x: number; max_y: number } | null>;
  projected_bounds: {
    min_u: number;
    max_u: number;
    min_v: number;
    max_v: number;
    width: number;
    height: number;
  };
};

function make_empty_cell(): GridCell {
  return {
    char: ' ',
    rgb: { r: 0, g: 0, b: 0 },
    weight_index: 1,
  };
}

function make_empty_cells(width: number, height: number): GridCell[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => make_empty_cell()));
}

function clone_cell(cell: GridCell): GridCell {
  return {
    char: cell.char,
    rgb: { ...cell.rgb },
    weight_index: cell.weight_index,
  };
}

function slot_for_plane(plane: number, visible_planes: readonly number[]): number {
  const index = visible_planes.findIndex((value) => Math.floor(value) === Math.floor(plane));
  return index >= 0 ? index : 0;
}

export function get_painter_focus_slot_for_anchor(args: {
  anchor_world?: { x: number; y: number; z: number } | null;
  view_state: PlaceViewState;
  visible_planes: readonly number[];
  fallback_world_plane?: number | null;
}): { focus_slot: number; focus_world_plane: number | null } {
  const fallback_plane = typeof args.fallback_world_plane === 'number'
    ? Math.floor(args.fallback_world_plane)
    : Math.floor(args.visible_planes[0] ?? 0);
  const plane = args.anchor_world
    ? Math.floor(project_world_point_with_roll(args.anchor_world, args.view_state).plane)
    : fallback_plane;
  return {
    focus_slot: Math.max(0, Math.min(Math.max(0, args.visible_planes.length - 1), slot_for_plane(plane, args.visible_planes))),
    focus_world_plane: Number.isFinite(plane) ? plane : null,
  };
}

export function project_painter_display_space(args: {
  source: VoxelSpace;
  view_state: PlaceViewState;
  focus_slot: number;
  target_world: { x: number; y: number; z: number };
  projection_anchor_world: { x: number; y: number; z: number };
  viewport_width: number;
  viewport_height: number;
  center_target_in_view?: boolean;
}): PainterDisplayProjection {
  const source = args.source;
  const bounds = {
    min_x: 0,
    min_y: 0,
    min_z: source.bounds.minZ,
    width: source.bounds.width,
    height: source.bounds.height,
    depth: source.bounds.maxZ - source.bounds.minZ + 1,
  };
  const authored_planes = Array.from(source.layers.keys()).sort((a, b) => a - b);
  const visible_planes = build_visible_plane_coordinates(bounds, authored_planes, args.view_state.principal_view);
  const viewportWidth = Math.max(1, Math.floor(args.viewport_width));
  const viewportHeight = Math.max(1, Math.floor(args.viewport_height));
  const targetProjected = project_world_point_with_roll(args.target_world, args.view_state);
  const projectionAnchorProjected = project_world_point_with_roll(args.projection_anchor_world, args.view_state);
  const centerU = Math.floor(viewportWidth / 2);
  const centerV = Math.floor(viewportHeight / 2);
  const centerTarget = args.center_target_in_view ?? args.source.camera.center_target_in_view ?? false;
  const activeAnchorProjected = centerTarget ? targetProjected : projectionAnchorProjected;
  const naturalBounds = get_projected_bounds_with_roll(bounds, args.view_state);
  const projected_bounds = {
    ...naturalBounds,
    min_u: activeAnchorProjected.u - centerU,
    max_u: activeAnchorProjected.u - centerU + viewportWidth - 1,
    min_v: activeAnchorProjected.v - centerV,
    max_v: activeAnchorProjected.v - centerV + viewportHeight - 1,
    width: viewportWidth,
    height: viewportHeight,
  };
  const display = createVoxelSpace(projected_bounds.width, projected_bounds.height, {
    minZ: 0,
    maxZ: Math.max(0, visible_planes.length - 1),
    defaultZ: 0,
  });
  display.layers.clear();
  display.bounds.minZ = 0;
  display.bounds.maxZ = Math.max(0, visible_planes.length - 1);
  display.bounds.depth = Math.max(1, visible_planes.length);

  const focus_slot = Math.max(0, Math.min(Math.max(0, visible_planes.length - 1), Math.floor(args.focus_slot)));
  const content_bounds_by_slot: Array<{ min_x: number; min_y: number; max_x: number; max_y: number } | null> = Array.from({ length: Math.max(1, visible_planes.length) }, () => null);
  display.camera = {
    ...display.camera,
    ...source.camera,
    mode: 'rotated_ortho',
    euler_rotation: { x: 0, y: 0, z: 0 },
    transition_euler: { x: 0, y: 0, z: 0 },
    focus_plane: focus_slot,
  };

  for (let slot = 0; slot < Math.max(1, visible_planes.length); slot += 1) {
    const world_plane = visible_planes[slot] ?? slot;
    const layer: VoxelLayer = {
      z: slot,
      name: `slot_${slot}_plane_${world_plane}`,
      visible: true,
      opacity: 1,
      locked: true,
      cells: make_empty_cells(projected_bounds.width, projected_bounds.height),
    };
    display.layers.set(slot, layer);
  }

  for (const [worldZ, layer] of source.layers.entries()) {
    if (!layer.visible) continue;
    for (let y = 0; y < source.bounds.height; y += 1) {
      const row = layer.cells[y];
      if (!row) continue;
      for (let x = 0; x < source.bounds.width; x += 1) {
        const cell = row[x] ?? getVoxel(source, x, y, worldZ);
        if (!cell || cell.char === ' ') continue;
        const projected = project_world_point_with_roll({ x, y, z: worldZ }, args.view_state);
        const slot = slot_for_plane(projected.plane, visible_planes);
        const displayLayer = display.layers.get(slot);
        if (!displayLayer) continue;
        const gridX = projected.u - projected_bounds.min_u;
        const gridY = projected.v - projected_bounds.min_v;
        if (gridX < 0 || gridX >= projected_bounds.width || gridY < 0 || gridY >= projected_bounds.height) continue;
        const outRow = displayLayer.cells[gridY];
        if (!outRow) continue;
        outRow[gridX] = clone_cell(cell);
        const existing = content_bounds_by_slot[slot];
        if (!existing) {
          content_bounds_by_slot[slot] = { min_x: gridX, min_y: gridY, max_x: gridX, max_y: gridY };
        } else {
          existing.min_x = Math.min(existing.min_x, gridX);
          existing.min_y = Math.min(existing.min_y, gridY);
          existing.max_x = Math.max(existing.max_x, gridX);
          existing.max_y = Math.max(existing.max_y, gridY);
        }
      }
    }
  }

  return {
    space: display,
    visible_planes,
    focus_slot,
    focus_world_plane: visible_planes[focus_slot] ?? null,
    view_state: args.view_state,
    target_world: { ...args.target_world },
    projection_anchor_world: { ...args.projection_anchor_world },
    target_projected: targetProjected,
    anchor_projected: projectionAnchorProjected,
    content_bounds_by_slot,
    projected_bounds,
  };
}

export function get_painter_projection_focus_content_bounds(projection: PainterDisplayProjection): { min_x: number; min_y: number; max_x: number; max_y: number } | null {
  return projection.content_bounds_by_slot[projection.focus_slot] ?? null;
}

export function get_painter_world_content_bounds_center(source: VoxelSpace): { x: number; y: number; z: number } {
  let min_x = Number.POSITIVE_INFINITY;
  let min_y = Number.POSITIVE_INFINITY;
  let min_z = Number.POSITIVE_INFINITY;
  let max_x = Number.NEGATIVE_INFINITY;
  let max_y = Number.NEGATIVE_INFINITY;
  let max_z = Number.NEGATIVE_INFINITY;
  for (const [worldZ, layer] of source.layers.entries()) {
    if (!layer?.visible) continue;
    for (let y = 0; y < source.bounds.height; y += 1) {
      const row = layer.cells[y];
      if (!row) continue;
      for (let x = 0; x < source.bounds.width; x += 1) {
        const cell = row[x] ?? getVoxel(source, x, y, worldZ);
        if (!cell || cell.char === ' ') continue;
        min_x = Math.min(min_x, x);
        min_y = Math.min(min_y, y);
        min_z = Math.min(min_z, worldZ);
        max_x = Math.max(max_x, x);
        max_y = Math.max(max_y, y);
        max_z = Math.max(max_z, worldZ);
      }
    }
  }
  if (!Number.isFinite(min_x) || !Number.isFinite(min_y) || !Number.isFinite(min_z) || !Number.isFinite(max_x) || !Number.isFinite(max_y) || !Number.isFinite(max_z)) {
    return {
      x: Math.floor((source.bounds.width - 1) / 2),
      y: Math.floor((source.bounds.height - 1) / 2),
      z: Math.floor((source.bounds.minZ + source.bounds.maxZ) / 2),
    };
  }
  return {
    x: Math.floor((min_x + max_x) / 2),
    y: Math.floor((min_y + max_y) / 2),
    z: Math.floor((min_z + max_z) / 2),
  };
}

export function sync_grid_to_painter_projection(grid: Grid, projection: PainterDisplayProjection): void {
  const layer = projection.space.layers.get(projection.focus_slot) ?? projection.space.layers.get(0);
  grid.width = projection.projected_bounds.width;
  grid.height = projection.projected_bounds.height;
  grid.cells = layer ? layer.cells : make_empty_cells(grid.width, grid.height);
}

export function painter_projection_grid_point_to_world(args: {
  projection: PainterDisplayProjection;
  x: number;
  y: number;
}): { x: number; y: number; z: number } | null {
  const plane = args.projection.focus_world_plane;
  if (plane === null || plane === undefined) return null;
  const x = Math.floor(args.x);
  const y = Math.floor(args.y);
  if (x < 0 || x >= args.projection.projected_bounds.width || y < 0 || y >= args.projection.projected_bounds.height) return null;
  return unproject_plane_point_with_roll({
    u: x + args.projection.projected_bounds.min_u,
    v: y + args.projection.projected_bounds.min_v,
    plane,
  }, args.projection.view_state);
}

export function painter_projection_world_to_grid_point(args: {
  projection: PainterDisplayProjection;
  world: { x: number; y: number; z: number };
}): { x: number; y: number } | null {
  const projected = project_world_point_with_roll(args.world, args.projection.view_state);
  if (projected.plane !== args.projection.focus_world_plane) return null;
  const x = projected.u - args.projection.projected_bounds.min_u;
  const y = projected.v - args.projection.projected_bounds.min_v;
  if (x < 0 || x >= args.projection.projected_bounds.width || y < 0 || y >= args.projection.projected_bounds.height) return null;
  return { x, y };
}

export function commit_grid_to_painter_world(args: {
  source: VoxelSpace;
  grid: Grid;
  projection: PainterDisplayProjection;
}): void {
  const plane = args.projection.focus_world_plane;
  if (plane === null || plane === undefined) return;
  for (let gridY = 0; gridY < args.grid.height; gridY += 1) {
    const row = args.grid.cells[gridY];
    if (!row) continue;
    for (let gridX = 0; gridX < args.grid.width; gridX += 1) {
      const cell = row[gridX] ?? make_empty_cell();
      const world = unproject_plane_point_with_roll({
        u: gridX + args.projection.projected_bounds.min_u,
        v: gridY + args.projection.projected_bounds.min_v,
        plane,
      }, args.projection.view_state);
      if (world.z < args.source.bounds.minZ || world.z > args.source.bounds.maxZ) continue;
      getOrCreateLayer(args.source, world.z);
      setVoxel(args.source, world.x, world.y, world.z, clone_cell(cell));
    }
  }
}
