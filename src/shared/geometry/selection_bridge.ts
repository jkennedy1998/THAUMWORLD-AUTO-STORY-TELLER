import type { Point2, Voxel3 } from '../coords.js';
import { key_voxel3 } from '../coords.js';
import { rasterize_rect2_to_points } from './shape_rasterize2.js';
import { rasterize_box3_to_voxels } from './shape_rasterize3.js';

export type SelectionBridgeBounds3 = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export type SelectionBitmapLike = {
  width: number;
  height: number;
  cells: boolean[][];
};

function is_world_inside_bounds(world: Voxel3, bounds: SelectionBridgeBounds3): boolean {
  return world.x >= bounds.minX
    && world.x <= bounds.maxX
    && world.y >= bounds.minY
    && world.y <= bounds.maxY
    && world.z >= bounds.minZ
    && world.z <= bounds.maxZ;
}

export function map_plane_points_to_world_cells(
  points: Point2[],
  args: {
    depthMin: number;
    depthMax: number;
    map_point_to_world: (point: Point2, plane: number) => Voxel3 | null;
    bounds?: SelectionBridgeBounds3 | null;
    point_filter?: (point: Point2) => boolean;
  },
): Voxel3[] {
  const out: Voxel3[] = [];
  const seen = new Set<string>();
  const depthMin = Math.min(args.depthMin, args.depthMax);
  const depthMax = Math.max(args.depthMin, args.depthMax);
  for (const point of points) {
    if (args.point_filter && !args.point_filter(point)) continue;
    for (let plane = depthMin; plane <= depthMax; plane += 1) {
      const world = args.map_point_to_world(point, plane);
      if (!world) continue;
      if (args.bounds && !is_world_inside_bounds(world, args.bounds)) continue;
      const key = key_voxel3(world);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x: world.x, y: world.y, z: world.z });
    }
  }
  return out;
}

export function selection_bitmap_to_world_cells(
  bitmap: SelectionBitmapLike,
  args: {
    depthMin: number;
    depthMax: number;
    map_point_to_world: (point: Point2, plane: number) => Voxel3 | null;
    bounds?: SelectionBridgeBounds3 | null;
  },
): Voxel3[] {
  const points: Point2[] = [];
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      if (!bitmap.cells[y]?.[x]) continue;
      points.push({ x, y });
    }
  }
  return map_plane_points_to_world_cells(points, args);
}

export function brush_rect_selection_to_world_cells(
  x: number,
  y: number,
  size: number,
  plane: number,
  args: {
    map_point_to_world: (point: Point2, plane: number) => Voxel3 | null;
    bounds?: SelectionBridgeBounds3 | null;
    point_filter?: (point: Point2) => boolean;
  },
): Voxel3[] {
  const span = Math.max(1, Math.floor(size));
  const offset = Math.floor(span / 2);
  const points = rasterize_rect2_to_points({
    x0: x - offset,
    y0: y - offset,
    x1: x - offset + span - 1,
    y1: y - offset + span - 1,
  }, 'fill');
  return map_plane_points_to_world_cells(points, {
    depthMin: plane,
    depthMax: plane,
    map_point_to_world: args.map_point_to_world,
    bounds: args.bounds,
    point_filter: args.point_filter,
  });
}

export function box_selection_to_world_cells(
  startWorld: Voxel3,
  endWorld: Voxel3,
  args: {
    bounds: SelectionBridgeBounds3;
    axis?: 'x' | 'y' | 'z';
    allDepths?: boolean;
  },
): Voxel3[] {
  let minX = Math.min(startWorld.x, endWorld.x);
  let maxX = Math.max(startWorld.x, endWorld.x);
  let minY = Math.min(startWorld.y, endWorld.y);
  let maxY = Math.max(startWorld.y, endWorld.y);
  let minZ = Math.min(startWorld.z, endWorld.z);
  let maxZ = Math.max(startWorld.z, endWorld.z);
  if (args.allDepths) {
    if (args.axis === 'x') {
      minX = args.bounds.minX;
      maxX = args.bounds.maxX;
    } else if (args.axis === 'y') {
      minY = args.bounds.minY;
      maxY = args.bounds.maxY;
    } else {
      minZ = args.bounds.minZ;
      maxZ = args.bounds.maxZ;
    }
  }
  minX = Math.max(minX, args.bounds.minX);
  maxX = Math.min(maxX, args.bounds.maxX);
  minY = Math.max(minY, args.bounds.minY);
  maxY = Math.min(maxY, args.bounds.maxY);
  minZ = Math.max(minZ, args.bounds.minZ);
  maxZ = Math.min(maxZ, args.bounds.maxZ);
  if (minX > maxX || minY > maxY || minZ > maxZ) return [];
  return rasterize_box3_to_voxels({
    x0: minX,
    y0: minY,
    z0: minZ,
    x1: maxX,
    y1: maxY,
    z1: maxZ,
  }, 'filled');
}
