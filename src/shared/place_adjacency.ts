import type { Place, PlaceConnectorDirection, PlaceRegionBounds } from "../types/place.js";

export type RegionVoxel = { x: number; y: number; z: number };
export type PlaceFace = PlaceConnectorDirection;

export type PlaceFaceAdjacency = {
  place_a_id: string;
  place_b_id: string;
  direction_from_a: PlaceConnectorDirection;
};

export type VolumeBoundaryInfo = {
  on_x_min: boolean;
  on_x_max: boolean;
  on_y_min: boolean;
  on_y_max: boolean;
  on_z_min: boolean;
  on_z_max: boolean;
  boundary_count: number;
  is_face: boolean;
  is_edge: boolean;
  is_corner: boolean;
};

type Size3 = { x: number; y: number; z: number };

type RegionExtents = {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
  min_z: number;
  max_z: number;
};

function clamp_size(v: number, fallback = 1): number {
  return Math.max(1, Math.floor(Number(v) || fallback));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function get_place_region_bounds(place: Place): PlaceRegionBounds {
  const elevation = Math.floor(Number(place.coordinates?.elevation ?? 0)) || 0;
  return place.region_bounds ?? {
    origin: { x: 0, y: 0, z: elevation },
    size: {
      x: clamp_size(place.tile_grid?.width ?? 1),
      y: clamp_size(place.tile_grid?.height ?? 1),
      z: 1,
    },
  };
}

export function get_region_bounds_extents(bounds: PlaceRegionBounds): RegionExtents {
  const sx = clamp_size(bounds.size?.x ?? 1);
  const sy = clamp_size(bounds.size?.y ?? 1);
  const sz = clamp_size(bounds.size?.z ?? 1);
  return {
    min_x: Math.floor(Number(bounds.origin?.x ?? 0)) || 0,
    min_y: Math.floor(Number(bounds.origin?.y ?? 0)) || 0,
    min_z: Math.floor(Number(bounds.origin?.z ?? 0)) || 0,
    max_x: (Math.floor(Number(bounds.origin?.x ?? 0)) || 0) + sx - 1,
    max_y: (Math.floor(Number(bounds.origin?.y ?? 0)) || 0) + sy - 1,
    max_z: (Math.floor(Number(bounds.origin?.z ?? 0)) || 0) + sz - 1,
  };
}

export function get_place_region_extents(place: Place): RegionExtents {
  return get_region_bounds_extents(get_place_region_bounds(place));
}

export function compute_adjacent_place_bounds(source_place: Place, border_tile: RegionVoxel, direction: PlaceConnectorDirection, new_size: Size3): PlaceRegionBounds {
  const source = get_place_region_bounds(source_place);
  const source_size = {
    x: clamp_size(source.size?.x ?? 1),
    y: clamp_size(source.size?.y ?? 1),
    z: clamp_size(source.size?.z ?? 1),
  };
  const size = {
    x: clamp_size(new_size.x ?? 1),
    y: clamp_size(new_size.y ?? 1),
    z: clamp_size(new_size.z ?? 1),
  };
  const anchor_local = {
    x: clamp(Math.floor(Number(border_tile.x ?? 0)) || 0, 0, source_size.x - 1),
    y: clamp(Math.floor(Number(border_tile.y ?? 0)) || 0, 0, source_size.y - 1),
    z: clamp(Math.floor(Number(border_tile.z ?? 0)) || 0, 0, source_size.z - 1),
  };
  const anchor_world = {
    x: source.origin.x + anchor_local.x,
    y: source.origin.y + anchor_local.y,
    z: source.origin.z + anchor_local.z,
  };
  const origin = { x: anchor_world.x, y: anchor_world.y, z: anchor_world.z };
  if (direction === "x+") {
    origin.x = source.origin.x + source_size.x;
    origin.y = anchor_world.y - Math.floor(size.y / 2);
    origin.z = anchor_world.z;
  } else if (direction === "x-") {
    origin.x = source.origin.x - size.x;
    origin.y = anchor_world.y - Math.floor(size.y / 2);
    origin.z = anchor_world.z;
  } else if (direction === "y+") {
    origin.x = anchor_world.x - Math.floor(size.x / 2);
    origin.y = source.origin.y + source_size.y;
    origin.z = anchor_world.z;
  } else if (direction === "y-") {
    origin.x = anchor_world.x - Math.floor(size.x / 2);
    origin.y = source.origin.y - size.y;
    origin.z = anchor_world.z;
  } else if (direction === "z+") {
    origin.x = anchor_world.x - Math.floor(size.x / 2);
    origin.y = anchor_world.y - Math.floor(size.y / 2);
    origin.z = source.origin.z + source_size.z;
  } else if (direction === "z-") {
    origin.x = anchor_world.x - Math.floor(size.x / 2);
    origin.y = anchor_world.y - Math.floor(size.y / 2);
    origin.z = source.origin.z - size.z;
  }
  return { origin, size };
}

function ranges_overlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 <= b1 && b0 <= a1;
}

export function region_bounds_overlap(a: PlaceRegionBounds, b: PlaceRegionBounds): boolean {
  const aa = get_region_bounds_extents(a);
  const bb = get_region_bounds_extents(b);
  return ranges_overlap(aa.min_x, aa.max_x, bb.min_x, bb.max_x)
    && ranges_overlap(aa.min_y, aa.max_y, bb.min_y, bb.max_y)
    && ranges_overlap(aa.min_z, aa.max_z, bb.min_z, bb.max_z);
}

export function get_places_face_adjacency(place_a: Place, place_b: Place): PlaceFaceAdjacency | null {
  const a = get_place_region_extents(place_a);
  const b = get_place_region_extents(place_b);
  if (region_bounds_overlap(get_place_region_bounds(place_a), get_place_region_bounds(place_b))) return null;
  if (a.max_x + 1 === b.min_x && ranges_overlap(a.min_y, a.max_y, b.min_y, b.max_y) && ranges_overlap(a.min_z, a.max_z, b.min_z, b.max_z)) {
    return { place_a_id: place_a.id, place_b_id: place_b.id, direction_from_a: "x+" };
  }
  if (a.min_x === b.max_x + 1 && ranges_overlap(a.min_y, a.max_y, b.min_y, b.max_y) && ranges_overlap(a.min_z, a.max_z, b.min_z, b.max_z)) {
    return { place_a_id: place_a.id, place_b_id: place_b.id, direction_from_a: "x-" };
  }
  if (a.max_y + 1 === b.min_y && ranges_overlap(a.min_x, a.max_x, b.min_x, b.max_x) && ranges_overlap(a.min_z, a.max_z, b.min_z, b.max_z)) {
    return { place_a_id: place_a.id, place_b_id: place_b.id, direction_from_a: "y+" };
  }
  if (a.min_y === b.max_y + 1 && ranges_overlap(a.min_x, a.max_x, b.min_x, b.max_x) && ranges_overlap(a.min_z, a.max_z, b.min_z, b.max_z)) {
    return { place_a_id: place_a.id, place_b_id: place_b.id, direction_from_a: "y-" };
  }
  if (a.max_z + 1 === b.min_z && ranges_overlap(a.min_x, a.max_x, b.min_x, b.max_x) && ranges_overlap(a.min_y, a.max_y, b.min_y, b.max_y)) {
    return { place_a_id: place_a.id, place_b_id: place_b.id, direction_from_a: "z+" };
  }
  if (a.min_z === b.max_z + 1 && ranges_overlap(a.min_x, a.max_x, b.min_x, b.max_x) && ranges_overlap(a.min_y, a.max_y, b.min_y, b.max_y)) {
    return { place_a_id: place_a.id, place_b_id: place_b.id, direction_from_a: "z-" };
  }
  return null;
}

export function build_place_adjacency_map(places: Place[]): Map<string, Set<string>> {
  const neighbors = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (!a || !b || a === b) return;
    if (!neighbors.has(a)) neighbors.set(a, new Set<string>());
    neighbors.get(a)!.add(b);
  };
  for (let i = 0; i < places.length; i += 1) {
    for (let j = i + 1; j < places.length; j += 1) {
      const adjacency = get_places_face_adjacency(places[i]!, places[j]!);
      if (!adjacency) continue;
      link(adjacency.place_a_id, adjacency.place_b_id);
      link(adjacency.place_b_id, adjacency.place_a_id);
    }
  }
  return neighbors;
}

export function find_overlapping_place_pairs(places: Place[]): Array<{ place_a_id: string; place_b_id: string; bounds_a: PlaceRegionBounds; bounds_b: PlaceRegionBounds }> {
  const overlaps: Array<{ place_a_id: string; place_b_id: string; bounds_a: PlaceRegionBounds; bounds_b: PlaceRegionBounds }> = [];
  for (let i = 0; i < places.length; i += 1) {
    for (let j = i + 1; j < places.length; j += 1) {
      const a = places[i]!;
      const b = places[j]!;
      const bounds_a = get_place_region_bounds(a);
      const bounds_b = get_place_region_bounds(b);
      if (!region_bounds_overlap(bounds_a, bounds_b)) continue;
      overlaps.push({ place_a_id: a.id, place_b_id: b.id, bounds_a, bounds_b });
    }
  }
  return overlaps;
}

export function local_voxel_to_region_voxel(place: Place, local: RegionVoxel): RegionVoxel {
  const bounds = get_place_region_bounds(place);
  return {
    x: (Math.floor(Number(bounds.origin.x ?? 0)) || 0) + (Math.floor(Number(local.x ?? 0)) || 0),
    y: (Math.floor(Number(bounds.origin.y ?? 0)) || 0) + (Math.floor(Number(local.y ?? 0)) || 0),
    z: (Math.floor(Number(bounds.origin.z ?? 0)) || 0) + (Math.floor(Number(local.z ?? 0)) || 0),
  };
}

export function region_voxel_to_local_voxel(place: Place, region: RegionVoxel): RegionVoxel {
  const bounds = get_place_region_bounds(place);
  return {
    x: (Math.floor(Number(region.x ?? 0)) || 0) - (Math.floor(Number(bounds.origin.x ?? 0)) || 0),
    y: (Math.floor(Number(region.y ?? 0)) || 0) - (Math.floor(Number(bounds.origin.y ?? 0)) || 0),
    z: (Math.floor(Number(region.z ?? 0)) || 0) - (Math.floor(Number(bounds.origin.z ?? 0)) || 0),
  };
}

export function is_local_voxel_inside_place(place: Place, local: RegionVoxel): boolean {
  const bounds = get_place_region_bounds(place);
  const lx = Math.floor(Number(local.x ?? 0)) || 0;
  const ly = Math.floor(Number(local.y ?? 0)) || 0;
  const lz = Math.floor(Number(local.z ?? 0)) || 0;
  return lx >= 0 && lx < clamp_size(bounds.size?.x ?? 1)
    && ly >= 0 && ly < clamp_size(bounds.size?.y ?? 1)
    && lz >= 0 && lz < clamp_size(bounds.size?.z ?? 1);
}

export function is_region_voxel_inside_place(place: Place, region: RegionVoxel): boolean {
  return is_local_voxel_inside_place(place, region_voxel_to_local_voxel(place, region));
}

export function get_local_volume_boundary_info(size: Size3, local: RegionVoxel): VolumeBoundaryInfo | null {
  const sx = clamp_size(size.x ?? 1);
  const sy = clamp_size(size.y ?? 1);
  const sz = clamp_size(size.z ?? 1);
  const lx = Math.floor(Number(local.x ?? 0)) || 0;
  const ly = Math.floor(Number(local.y ?? 0)) || 0;
  const lz = Math.floor(Number(local.z ?? 0)) || 0;
  if (lx < 0 || lx >= sx || ly < 0 || ly >= sy || lz < 0 || lz >= sz) return null;
  const on_x_min = lx === 0;
  const on_x_max = lx === sx - 1;
  const on_y_min = ly === 0;
  const on_y_max = ly === sy - 1;
  const on_z_min = lz === 0;
  const on_z_max = lz === sz - 1;
  const boundary_count = (on_x_min ? 1 : 0) + (on_x_max ? 1 : 0)
    + (on_y_min ? 1 : 0) + (on_y_max ? 1 : 0)
    + (on_z_min ? 1 : 0) + (on_z_max ? 1 : 0);
  if (boundary_count < 1) return null;
  return {
    on_x_min,
    on_x_max,
    on_y_min,
    on_y_max,
    on_z_min,
    on_z_max,
    boundary_count,
    is_face: boundary_count >= 1,
    is_edge: boundary_count >= 2,
    is_corner: boundary_count >= 3,
  };
}

export function get_place_region_boundary_info(place: Place, region: RegionVoxel): VolumeBoundaryInfo | null {
  const bounds = get_place_region_bounds(place);
  return get_local_volume_boundary_info(bounds.size, region_voxel_to_local_voxel(place, region));
}

export function detect_place_resize_face(place: Place, local: RegionVoxel): PlaceFace | null {
  const info = get_local_volume_boundary_info(get_place_region_bounds(place).size, local);
  if (!info) return null;
  if (info.on_x_min) return "x-";
  if (info.on_x_max) return "x+";
  if (info.on_y_min) return "y-";
  if (info.on_y_max) return "y+";
  if (info.on_z_min) return "z-";
  if (info.on_z_max) return "z+";
  return null;
}

export function find_place_containing_region_voxel(places: Place[], region: RegionVoxel, exclude_place_id?: string): Place | null {
  for (const place of places) {
    if (!place || (exclude_place_id && place.id === exclude_place_id)) continue;
    if (is_region_voxel_inside_place(place, region)) return place;
  }
  return null;
}
