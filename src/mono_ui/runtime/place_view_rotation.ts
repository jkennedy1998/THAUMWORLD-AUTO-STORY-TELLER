export type PlaceMatrixViewDirection = 'north' | 'east' | 'south' | 'west';

export type SceneRotationBounds = {
  min_x: number;
  min_y: number;
  width: number;
  height: number;
};

export type ScenePoint = {
  x: number;
  y: number;
};

export function normalize_place_matrix_view_direction(value: unknown): PlaceMatrixViewDirection {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'east':
    case 'south':
    case 'west':
      return String(value).trim().toLowerCase() as PlaceMatrixViewDirection;
    case 'north':
    default:
      return 'north';
  }
}

export function rotate_place_matrix_view_direction(current: PlaceMatrixViewDirection, step: 'left' | 'right'): PlaceMatrixViewDirection {
  const dirs: readonly PlaceMatrixViewDirection[] = ['north', 'east', 'south', 'west'];
  const idx = dirs.indexOf(normalize_place_matrix_view_direction(current));
  const next = step === 'right'
    ? (idx + 1) % dirs.length
    : (idx + dirs.length - 1) % dirs.length;
  return dirs[next] ?? 'north';
}

export function get_rotated_scene_dimensions(bounds: SceneRotationBounds, view_direction: PlaceMatrixViewDirection): { width: number; height: number } {
  const normalized = normalize_place_matrix_view_direction(view_direction);
  if (normalized === 'east' || normalized === 'west') {
    return { width: bounds.height, height: bounds.width };
  }
  return { width: bounds.width, height: bounds.height };
}

export function rotate_scene_point_for_view(point: ScenePoint, bounds: SceneRotationBounds, view_direction: PlaceMatrixViewDirection): ScenePoint {
  const dir = normalize_place_matrix_view_direction(view_direction);
  const rx = Math.floor(point.x) - bounds.min_x;
  const ry = Math.floor(point.y) - bounds.min_y;
  switch (dir) {
    case 'east':
      return {
        x: bounds.min_x + (bounds.height - 1 - ry),
        y: bounds.min_y + rx,
      };
    case 'south':
      return {
        x: bounds.min_x + (bounds.width - 1 - rx),
        y: bounds.min_y + (bounds.height - 1 - ry),
      };
    case 'west':
      return {
        x: bounds.min_x + ry,
        y: bounds.min_y + (bounds.width - 1 - rx),
      };
    case 'north':
    default:
      return { x: bounds.min_x + rx, y: bounds.min_y + ry };
  }
}

export function unrotate_scene_point_from_view(point: ScenePoint, bounds: SceneRotationBounds, view_direction: PlaceMatrixViewDirection): ScenePoint {
  const dir = normalize_place_matrix_view_direction(view_direction);
  const vx = Math.floor(point.x) - bounds.min_x;
  const vy = Math.floor(point.y) - bounds.min_y;
  switch (dir) {
    case 'east':
      return {
        x: bounds.min_x + vy,
        y: bounds.min_y + (bounds.height - 1 - vx),
      };
    case 'south':
      return {
        x: bounds.min_x + (bounds.width - 1 - vx),
        y: bounds.min_y + (bounds.height - 1 - vy),
      };
    case 'west':
      return {
        x: bounds.min_x + (bounds.width - 1 - vy),
        y: bounds.min_y + vx,
      };
    case 'north':
    default:
      return { x: bounds.min_x + vx, y: bounds.min_y + vy };
  }
}

export function rotate_cardinal_neighbors_for_view<T>(neighbors: Partial<Record<'north' | 'east' | 'south' | 'west', T>>, view_direction: PlaceMatrixViewDirection): Partial<Record<'north' | 'east' | 'south' | 'west', T>> {
  const dir = normalize_place_matrix_view_direction(view_direction);
  switch (dir) {
    case 'east':
      return {
        north: neighbors.west,
        east: neighbors.north,
        south: neighbors.east,
        west: neighbors.south,
      };
    case 'south':
      return {
        north: neighbors.south,
        east: neighbors.west,
        south: neighbors.north,
        west: neighbors.east,
      };
    case 'west':
      return {
        north: neighbors.east,
        east: neighbors.south,
        south: neighbors.west,
        west: neighbors.north,
      };
    case 'north':
    default:
      return { ...neighbors };
  }
}
