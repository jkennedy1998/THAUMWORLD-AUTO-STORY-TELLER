import type { GridCell } from './types.js';
import type { Grid } from './types.js';
import type { PainterDocumentRuntime } from './painter_document_runtime.js';
import { createVoxelSpace, getVoxel, type CameraConfig, type VoxelLayer, type VoxelSpace } from './voxel_space.js';
import {
  build_visible_plane_coordinates,
  get_principal_view_plane_axis,
  get_projected_bounds_with_roll,
  project_world_point_with_roll,
  sort_plane_coordinates_for_view,
  unproject_plane_point_with_roll,
  type PlaceViewState,
} from '../mono_ui/runtime/place_view_projection.js';

const PAINTER_DEPTH_MARGIN = 2;

export type PainterDisplayProjection = {
  scene: PainterProjectedScene;
  world_bounds: {
    min_x: number;
    min_y: number;
    min_z: number;
    width: number;
    height: number;
    depth: number;
    max_x: number;
    max_y: number;
    max_z: number;
  };
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
  plane_to_slot: ReadonlyMap<number, number>;
};

export type PainterProjectedSlot = {
  z: number;
  world_plane: number;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  cells: GridCell[][];
};

export type PainterProjectedScene = {
  bounds: {
    width: number;
    height: number;
    minZ: number;
    maxZ: number;
    depth: number;
  };
  camera: CameraConfig;
  slots: Map<number, PainterProjectedSlot>;
};

function make_empty_cell(): GridCell {
  return {
    char: ' ',
    graphic: undefined,
    materials: undefined,
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
    graphic: cell.graphic,
    materials: cell.materials,
    rgb: { ...cell.rgb },
    weight_index: cell.weight_index,
    render_index: cell.render_index,
  };
}

function slot_for_plane(plane: number, visible_planes: readonly number[]): number | null {
  const index = visible_planes.findIndex((value) => Math.floor(value) === Math.floor(plane));
  return index >= 0 ? index : null;
}

function build_plane_to_slot_map(visible_planes: readonly number[]): ReadonlyMap<number, number> {
  return new Map(visible_planes.map((plane, index) => [Math.floor(plane), index]));
}

function build_camera_centered_visible_planes(view_state: PlaceViewState, target_world: { x: number; y: number; z: number }, margin: number = PAINTER_DEPTH_MARGIN): number[] {
  const radius = Math.max(0, Math.floor(margin));
  const axis = get_principal_view_plane_axis(view_state.principal_view);
  const targetPlane = axis === 'x'
    ? Math.floor(target_world.x)
    : axis === 'y'
      ? Math.floor(target_world.y)
      : Math.floor(target_world.z);
  const planes = Array.from({ length: radius * 2 + 1 }, (_, index) => targetPlane - radius + index);
  return sort_plane_coordinates_for_view(planes.length > 0 ? planes : [targetPlane], view_state.principal_view);
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
  const requestedPlane = args.anchor_world
    ? Math.floor(project_world_point_with_roll(args.anchor_world, args.view_state).plane)
    : fallback_plane;
  const slot = slot_for_plane(requestedPlane, args.visible_planes);
  const focus_slot = slot ?? Math.max(0, Math.min(Math.max(0, args.visible_planes.length - 1), slot_for_plane(fallback_plane, args.visible_planes) ?? 0));
  return {
    focus_slot,
    focus_world_plane: args.visible_planes[focus_slot] ?? null,
  };
}

export function project_world_to_painter_display_cell(args: {
  projection: PainterDisplayProjection;
  world: { x: number; y: number; z: number };
}): { slot: number; x: number; y: number } | null {
  const projected = project_world_point_with_roll(args.world, args.projection.view_state);
  const slot = args.projection.plane_to_slot.get(Math.floor(projected.plane));
  if (slot === undefined) return null;
  const x = projected.u - args.projection.projected_bounds.min_u;
  const y = projected.v - args.projection.projected_bounds.min_v;
  if (x < 0 || x >= args.projection.projected_bounds.width || y < 0 || y >= args.projection.projected_bounds.height) return null;
  return { slot, x, y };
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
  const plane_to_slot = build_plane_to_slot_map(visible_planes);
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
        if (!cell) continue;
        const has_text = typeof cell.char === 'string' && cell.char !== ' ';
        const has_graphic = !!cell.graphic;
        if (!has_text && !has_graphic) continue;
        const displayCell = project_world_to_painter_display_cell({
          projection: {
            scene: projected_scene_from_voxel_space(display),
            world_bounds: {
              ...bounds,
              max_x: bounds.min_x + bounds.width - 1,
              max_y: bounds.min_y + bounds.height - 1,
              max_z: bounds.min_z + bounds.depth - 1,
            },
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
            plane_to_slot,
          },
          world: { x, y, z: worldZ },
        });
        if (!displayCell) continue;
        const displayLayer = display.layers.get(displayCell.slot);
        if (!displayLayer) continue;
        const outRow = displayLayer.cells[displayCell.y];
        if (!outRow) continue;
        outRow[displayCell.x] = clone_cell(cell);
        const existing = content_bounds_by_slot[displayCell.slot];
        if (!existing) {
          content_bounds_by_slot[displayCell.slot] = { min_x: displayCell.x, min_y: displayCell.y, max_x: displayCell.x, max_y: displayCell.y };
        } else {
          existing.min_x = Math.min(existing.min_x, displayCell.x);
          existing.min_y = Math.min(existing.min_y, displayCell.y);
          existing.max_x = Math.max(existing.max_x, displayCell.x);
          existing.max_y = Math.max(existing.max_y, displayCell.y);
        }
      }
    }
  }

  return {
    scene: projected_scene_from_voxel_space(display),
    world_bounds: {
      ...bounds,
      max_x: bounds.min_x + bounds.width - 1,
      max_y: bounds.min_y + bounds.height - 1,
      max_z: bounds.min_z + bounds.depth - 1,
    },
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
    plane_to_slot,
  };
}

export function project_painter_runtime_display_space(args: {
  runtime: PainterDocumentRuntime;
  view_state: PlaceViewState;
  focus_slot: number;
  target_world: { x: number; y: number; z: number };
  projection_anchor_world: { x: number; y: number; z: number };
  viewport_width: number;
  viewport_height: number;
  center_target_in_view?: boolean;
  render_distance_planes?: number;
}): PainterDisplayProjection {
  const runtime = args.runtime;
  const bounds = {
    min_x: runtime.document.bounds.minX,
    min_y: runtime.document.bounds.minY,
    min_z: runtime.document.bounds.minZ,
    width: runtime.document.bounds.width,
    height: runtime.document.bounds.height,
    depth: runtime.document.bounds.maxZ - runtime.document.bounds.minZ + 1,
  };
  const visible_planes = build_camera_centered_visible_planes(args.view_state, args.target_world, args.render_distance_planes ?? PAINTER_DEPTH_MARGIN);
  const viewportWidth = Math.max(1, Math.floor(args.viewport_width));
  const viewportHeight = Math.max(1, Math.floor(args.viewport_height));
  const targetProjected = project_world_point_with_roll(args.target_world, args.view_state);
  const projectionAnchorProjected = project_world_point_with_roll(args.projection_anchor_world, args.view_state);
  const centerU = Math.floor(viewportWidth / 2);
  const centerV = Math.floor(viewportHeight / 2);
  const centerTarget = args.center_target_in_view ?? runtime.document.camera?.center_target_in_view ?? false;
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
  const slots = new Map<number, PainterProjectedSlot>();
  const camera: CameraConfig = {
    ...createVoxelSpace(1, 1, { defaultZ: 0 }).camera,
    ...(runtime.document.camera ?? {}),
    mode: 'rotated_ortho',
    euler_rotation: { x: 0, y: 0, z: 0 },
    transition_euler: { x: 0, y: 0, z: 0 },
    focus_plane: Math.max(0, Math.min(Math.max(0, visible_planes.length - 1), Math.floor(args.focus_slot))),
  };

  const focus_slot = Math.max(0, Math.min(Math.max(0, visible_planes.length - 1), Math.floor(args.focus_slot)));
  const plane_to_slot = build_plane_to_slot_map(visible_planes);
  const content_bounds_by_slot: Array<{ min_x: number; min_y: number; max_x: number; max_y: number } | null> = Array.from({ length: Math.max(1, visible_planes.length) }, () => null);
  camera.focus_plane = focus_slot;

  for (let slot = 0; slot < Math.max(1, visible_planes.length); slot += 1) {
    const world_plane = visible_planes[slot] ?? slot;
    const layer: PainterProjectedSlot = {
      z: slot,
      world_plane,
      name: `slot_${slot}_plane_${world_plane}`,
      visible: true,
      opacity: 1,
      locked: true,
      cells: make_empty_cells(projected_bounds.width, projected_bounds.height),
    };
    slots.set(slot, layer);
  }

  for (const resolved of runtime.resolved_visible_index.values()) {
    const displayCell = project_world_to_painter_display_cell({
      projection: {
        scene: {
          bounds: {
            width: projected_bounds.width,
            height: projected_bounds.height,
            minZ: 0,
            maxZ: Math.max(0, visible_planes.length - 1),
            depth: Math.max(1, visible_planes.length),
          },
          camera,
          slots,
        },
        world_bounds: {
          ...bounds,
          max_x: bounds.min_x + bounds.width - 1,
          max_y: bounds.min_y + bounds.height - 1,
          max_z: bounds.min_z + bounds.depth - 1,
        },
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
        plane_to_slot,
      },
      world: { x: resolved.x, y: resolved.y, z: resolved.z },
    });
    if (!displayCell) continue;
    const displayLayer = slots.get(displayCell.slot);
    if (!displayLayer) continue;
    const outRow = displayLayer.cells[displayCell.y];
    if (!outRow) continue;
    outRow[displayCell.x] = clone_cell(resolved.cell);
    const existing = content_bounds_by_slot[displayCell.slot];
    if (!existing) {
      content_bounds_by_slot[displayCell.slot] = { min_x: displayCell.x, min_y: displayCell.y, max_x: displayCell.x, max_y: displayCell.y };
    } else {
      existing.min_x = Math.min(existing.min_x, displayCell.x);
      existing.min_y = Math.min(existing.min_y, displayCell.y);
      existing.max_x = Math.max(existing.max_x, displayCell.x);
      existing.max_y = Math.max(existing.max_y, displayCell.y);
    }
  }

  return {
    scene: {
      bounds: {
        width: projected_bounds.width,
        height: projected_bounds.height,
        minZ: 0,
        maxZ: Math.max(0, visible_planes.length - 1),
        depth: Math.max(1, visible_planes.length),
      },
      camera,
      slots,
    },
    world_bounds: {
      ...bounds,
      max_x: bounds.min_x + bounds.width - 1,
      max_y: bounds.min_y + bounds.height - 1,
      max_z: bounds.min_z + bounds.depth - 1,
    },
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
    plane_to_slot,
  };
}

export function get_painter_projection_focus_content_bounds(projection: PainterDisplayProjection): { min_x: number; min_y: number; max_x: number; max_y: number } | null {
  return projection.content_bounds_by_slot[projection.focus_slot] ?? null;
}

export function projected_scene_from_voxel_space(source: VoxelSpace): PainterProjectedScene {
  const slots = new Map<number, PainterProjectedSlot>();
  for (const [z, layer] of source.layers.entries()) {
    slots.set(z, {
      z: layer.z,
      world_plane: z,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      locked: layer.locked,
      cells: layer.cells.map((row) => row.map((cell) => clone_cell(cell))),
    });
  }
  return {
    bounds: {
      width: source.bounds.width,
      height: source.bounds.height,
      minZ: source.bounds.minZ,
      maxZ: source.bounds.maxZ,
      depth: source.bounds.depth,
    },
    camera: {
      ...source.camera,
      calibration: { ...source.camera.calibration },
      euler_rotation: { ...source.camera.euler_rotation },
      transition_euler: source.camera.transition_euler ? { ...source.camera.transition_euler } : undefined,
      visual_pivot_px: source.camera.visual_pivot_px ? { ...source.camera.visual_pivot_px } : undefined,
    },
    slots,
  };
}

export function clone_projected_scene(scene: PainterProjectedScene): PainterProjectedScene {
  return {
    bounds: { ...scene.bounds },
    camera: {
      ...scene.camera,
      calibration: { ...scene.camera.calibration },
      euler_rotation: { ...scene.camera.euler_rotation },
      transition_euler: scene.camera.transition_euler ? { ...scene.camera.transition_euler } : undefined,
      visual_pivot_px: scene.camera.visual_pivot_px ? { ...scene.camera.visual_pivot_px } : undefined,
    },
    slots: new Map(Array.from(scene.slots.entries(), ([z, slot]) => [z, {
      z: slot.z,
      world_plane: slot.world_plane,
      name: slot.name,
      visible: slot.visible,
      opacity: slot.opacity,
      locked: slot.locked,
      cells: slot.cells.map((row) => row.map((cell) => clone_cell(cell))),
    }])),
  };
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
  const layer = projection.scene.slots.get(projection.focus_slot) ?? projection.scene.slots.get(0);
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
  grid: Grid;
  projection: PainterDisplayProjection;
}): void {
  // The painter now applies authored cell mutations through runtime-aware callbacks.
  // The projected grid remains a view-only surface and no longer writes back via VoxelSpace.
  void args;
}
