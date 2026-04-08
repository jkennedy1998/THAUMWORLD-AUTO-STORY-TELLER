import type { CardinalDirection, ViewDirection } from '../../render_shaders/graphics_contract.js';

export type PlacePrincipalView = 'top' | 'bottom' | 'north' | 'east' | 'south' | 'west';
export type PlaceViewRollQuarterTurn = 0 | 1 | 2 | 3;
export type PlaceSwingDirection = 'left' | 'right' | 'up' | 'down';
export type PlaceRollDirection = 'left' | 'right';

export type PlaceViewState = {
  principal_view: PlacePrincipalView;
  roll_quarter_turn: PlaceViewRollQuarterTurn;
};

type CardinalNeighborMap<T> = Partial<Record<'north' | 'east' | 'south' | 'west', T>>;
export type PlaneNeighborOffset = { dx: number; dy: number; dz: number };

export type SceneProjectionBounds = {
  min_x: number;
  min_y: number;
  min_z: number;
  width: number;
  height: number;
  depth: number;
};

export type WorldPoint3 = { x: number; y: number; z: number };
export type ProjectedPoint = { u: number; v: number; plane: number };
export type ProjectedBounds2 = { min_u: number; max_u: number; min_v: number; max_v: number; width: number; height: number };

type Axis3 = { x: -1 | 0 | 1; y: -1 | 0 | 1; z: -1 | 0 | 1 };

const AXIS_POS_X: Axis3 = { x: 1, y: 0, z: 0 };
const AXIS_NEG_X: Axis3 = { x: -1, y: 0, z: 0 };
const AXIS_POS_Y: Axis3 = { x: 0, y: 1, z: 0 };
const AXIS_NEG_Y: Axis3 = { x: 0, y: -1, z: 0 };
const AXIS_POS_Z: Axis3 = { x: 0, y: 0, z: 1 };
const AXIS_NEG_Z: Axis3 = { x: 0, y: 0, z: -1 };

const BASE_VIEW_BASIS: Record<PlacePrincipalView, { forward: Axis3; up: Axis3; right: Axis3 }> = {
  top: { forward: AXIS_POS_Z, up: AXIS_NEG_Y, right: AXIS_POS_X },
  bottom: { forward: AXIS_NEG_Z, up: AXIS_NEG_Y, right: AXIS_POS_X },
  north: { forward: AXIS_POS_Y, up: AXIS_POS_Z, right: AXIS_POS_X },
  east: { forward: AXIS_POS_X, up: AXIS_POS_Z, right: AXIS_NEG_Y },
  south: { forward: AXIS_NEG_Y, up: AXIS_POS_Z, right: AXIS_NEG_X },
  west: { forward: AXIS_NEG_X, up: AXIS_POS_Z, right: AXIS_POS_Y },
};

const ALL_PRINCIPAL_VIEWS: readonly PlacePrincipalView[] = ['top', 'bottom', 'north', 'east', 'south', 'west'];

export function normalize_place_principal_view(value: unknown): PlacePrincipalView {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'bottom':
    case 'north':
    case 'east':
    case 'south':
    case 'west':
      return String(value).trim().toLowerCase() as PlacePrincipalView;
    case 'top':
    default:
      return 'top';
  }
}

export function normalize_place_view_roll_quarter_turn(value: unknown): PlaceViewRollQuarterTurn {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 0;
  const normalized = ((n % 4) + 4) % 4;
  if (normalized === 1 || normalized === 2 || normalized === 3) return normalized;
  return 0;
}

export function make_place_view_state(principal_view: unknown, roll_quarter_turn: unknown = 0): PlaceViewState {
  return {
    principal_view: normalize_place_principal_view(principal_view),
    roll_quarter_turn: normalize_place_view_roll_quarter_turn(roll_quarter_turn),
  };
}

function same_axis(a: Axis3, b: Axis3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function rotate_basis_right(up: Axis3, right: Axis3, turns: PlaceViewRollQuarterTurn): { up: Axis3; right: Axis3 } {
  switch (normalize_place_view_roll_quarter_turn(turns)) {
    case 1:
      return { up: right, right: { x: -up.x as -1 | 0 | 1, y: -up.y as -1 | 0 | 1, z: -up.z as -1 | 0 | 1 } };
    case 2:
      return {
        up: { x: -up.x as -1 | 0 | 1, y: -up.y as -1 | 0 | 1, z: -up.z as -1 | 0 | 1 },
        right: { x: -right.x as -1 | 0 | 1, y: -right.y as -1 | 0 | 1, z: -right.z as -1 | 0 | 1 },
      };
    case 3:
      return { up: { x: -right.x as -1 | 0 | 1, y: -right.y as -1 | 0 | 1, z: -right.z as -1 | 0 | 1 }, right: up };
    case 0:
    default:
      return { up, right };
  }
}

function get_view_basis(state: PlaceViewState): { forward: Axis3; up: Axis3; right: Axis3 } {
  const base = BASE_VIEW_BASIS[state.principal_view];
  const rotated = rotate_basis_right(base.up, base.right, state.roll_quarter_turn);
  return { forward: base.forward, up: rotated.up, right: rotated.right };
}

function axis_to_principal_view(axis: Axis3): PlacePrincipalView {
  if (same_axis(axis, AXIS_POS_Z)) return 'top';
  if (same_axis(axis, AXIS_NEG_Z)) return 'bottom';
  if (same_axis(axis, AXIS_POS_Y)) return 'north';
  if (same_axis(axis, AXIS_POS_X)) return 'east';
  if (same_axis(axis, AXIS_NEG_Y)) return 'south';
  return 'west';
}

function resolve_state_from_basis(forward: Axis3, up: Axis3): PlaceViewState {
  const principal_view = axis_to_principal_view(forward);
  for (const roll of [0, 1, 2, 3] as const) {
    const candidate = make_place_view_state(principal_view, roll);
    if (same_axis(get_view_basis(candidate).up, up)) return candidate;
  }
  return make_place_view_state(principal_view, 0);
}

export function rotate_place_view_roll(state: PlaceViewState, direction: PlaceRollDirection): PlaceViewState {
  const current = make_place_view_state(state.principal_view, state.roll_quarter_turn);
  const delta = direction === 'right' ? 1 : 3;
  return make_place_view_state(current.principal_view, current.roll_quarter_turn + delta);
}

export function swing_place_view(state: PlaceViewState, direction: PlaceSwingDirection): PlaceViewState {
  const basis = get_view_basis(make_place_view_state(state.principal_view, state.roll_quarter_turn));
  switch (direction) {
    case 'left':
      return resolve_state_from_basis({ x: -basis.right.x as -1 | 0 | 1, y: -basis.right.y as -1 | 0 | 1, z: -basis.right.z as -1 | 0 | 1 }, basis.up);
    case 'right':
      return resolve_state_from_basis(basis.right, basis.up);
    case 'up':
      return resolve_state_from_basis(basis.up, { x: -basis.forward.x as -1 | 0 | 1, y: -basis.forward.y as -1 | 0 | 1, z: -basis.forward.z as -1 | 0 | 1 });
    case 'down':
    default:
      return resolve_state_from_basis({ x: -basis.up.x as -1 | 0 | 1, y: -basis.up.y as -1 | 0 | 1, z: -basis.up.z as -1 | 0 | 1 }, basis.forward);
  }
}

function apply_roll_to_uv(u: number, v: number, roll_quarter_turn: PlaceViewRollQuarterTurn): { u: number; v: number } {
  switch (normalize_place_view_roll_quarter_turn(roll_quarter_turn)) {
    case 1: return { u: -v, v: u };
    case 2: return { u: -u, v: -v };
    case 3: return { u: v, v: -u };
    case 0:
    default: return { u, v };
  }
}

function unapply_roll_to_uv(u: number, v: number, roll_quarter_turn: PlaceViewRollQuarterTurn): { u: number; v: number } {
  switch (normalize_place_view_roll_quarter_turn(roll_quarter_turn)) {
    case 1: return { u: v, v: -u };
    case 2: return { u: -u, v: -v };
    case 3: return { u: -v, v: u };
    case 0:
    default: return { u, v };
  }
}

export function get_atlas_view_direction(view: PlacePrincipalView): ViewDirection {
  const normalized = normalize_place_principal_view(view);
  switch (normalized) {
    case 'bottom': return 'down';
    case 'north': return 'north';
    case 'east': return 'east';
    case 'south': return 'south';
    case 'west': return 'west';
    case 'top':
    default:
      return 'up';
  }
}

export function get_principal_view_plane_axis(view: PlacePrincipalView): 'x' | 'y' | 'z' {
  switch (normalize_place_principal_view(view)) {
    case 'east':
    case 'west':
      return 'x';
    case 'north':
    case 'south':
      return 'y';
    case 'top':
    case 'bottom':
    default:
      return 'z';
  }
}

export function sort_plane_coordinates_for_view(coords: readonly number[], view: PlacePrincipalView): number[] {
  const sorted = [...coords].sort((a, b) => a - b);
  switch (normalize_place_principal_view(view)) {
    case 'bottom':
    case 'south':
    case 'west':
      return sorted.reverse();
    case 'top':
    case 'north':
    case 'east':
    default:
      return sorted;
  }
}

export function project_world_point(point: WorldPoint3, view: PlacePrincipalView): ProjectedPoint {
  return project_world_point_with_roll(point, make_place_view_state(view, 0));
}

export function project_world_point_with_roll(point: WorldPoint3, state: PlaceViewState): ProjectedPoint {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  const z = Math.floor(point.z);
  let projected: ProjectedPoint;
  switch (normalize_place_principal_view(state.principal_view)) {
    case 'bottom':
      projected = { u: x, v: y, plane: z };
      break;
    case 'north':
      projected = { u: x, v: -z, plane: y };
      break;
    case 'south':
      projected = { u: -x, v: -z, plane: y };
      break;
    case 'east':
      projected = { u: -y, v: -z, plane: x };
      break;
    case 'west':
      projected = { u: y, v: -z, plane: x };
      break;
    case 'top':
    default:
      projected = { u: x, v: y, plane: z };
      break;
  }
  const rolled = apply_roll_to_uv(projected.u, projected.v, state.roll_quarter_turn);
  return { u: rolled.u, v: rolled.v, plane: projected.plane };
}

export function unproject_plane_point(point: { u: number; v: number; plane: number }, view: PlacePrincipalView): WorldPoint3 {
  return unproject_plane_point_with_roll(point, make_place_view_state(view, 0));
}

export function unproject_plane_point_with_roll(point: { u: number; v: number; plane: number }, state: PlaceViewState): WorldPoint3 {
  const unrolled = unapply_roll_to_uv(point.u, point.v, state.roll_quarter_turn);
  const u = Math.floor(unrolled.u);
  const v = Math.floor(unrolled.v);
  const plane = Math.floor(point.plane);
  switch (normalize_place_principal_view(state.principal_view)) {
    case 'bottom':
      return { x: u, y: v, z: plane };
    case 'north':
      return { x: u, y: plane, z: -v };
    case 'south':
      return { x: -u, y: plane, z: -v };
    case 'east':
      return { x: plane, y: -u, z: -v };
    case 'west':
      return { x: plane, y: u, z: -v };
    case 'top':
    default:
      return { x: u, y: v, z: plane };
  }
}

export function get_projected_bounds(bounds: SceneProjectionBounds, view: PlacePrincipalView): ProjectedBounds2 {
  return get_projected_bounds_with_roll(bounds, make_place_view_state(view, 0));
}

export function get_projected_bounds_with_roll(bounds: SceneProjectionBounds, state: PlaceViewState): ProjectedBounds2 {
  const corners: WorldPoint3[] = [
    { x: bounds.min_x, y: bounds.min_y, z: bounds.min_z },
    { x: bounds.min_x + bounds.width - 1, y: bounds.min_y, z: bounds.min_z },
    { x: bounds.min_x, y: bounds.min_y + bounds.height - 1, z: bounds.min_z },
    { x: bounds.min_x + bounds.width - 1, y: bounds.min_y + bounds.height - 1, z: bounds.min_z },
    { x: bounds.min_x, y: bounds.min_y, z: bounds.min_z + bounds.depth - 1 },
    { x: bounds.min_x + bounds.width - 1, y: bounds.min_y, z: bounds.min_z + bounds.depth - 1 },
    { x: bounds.min_x, y: bounds.min_y + bounds.height - 1, z: bounds.min_z + bounds.depth - 1 },
    { x: bounds.min_x + bounds.width - 1, y: bounds.min_y + bounds.height - 1, z: bounds.min_z + bounds.depth - 1 },
  ];
  let min_u = Number.POSITIVE_INFINITY;
  let max_u = Number.NEGATIVE_INFINITY;
  let min_v = Number.POSITIVE_INFINITY;
  let max_v = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    const projected = project_world_point_with_roll(corner, state);
    min_u = Math.min(min_u, projected.u);
    max_u = Math.max(max_u, projected.u);
    min_v = Math.min(min_v, projected.v);
    max_v = Math.max(max_v, projected.v);
  }
  return {
    min_u: Number.isFinite(min_u) ? min_u : 0,
    max_u: Number.isFinite(max_u) ? max_u : 0,
    min_v: Number.isFinite(min_v) ? min_v : 0,
    max_v: Number.isFinite(max_v) ? max_v : 0,
    width: Number.isFinite(min_u) && Number.isFinite(max_u) ? (max_u - min_u + 1) : 1,
    height: Number.isFinite(min_v) && Number.isFinite(max_v) ? (max_v - min_v + 1) : 1,
  };
}

export function build_visible_plane_coordinates(bounds: SceneProjectionBounds, authored_planes: readonly number[], view: PlacePrincipalView): number[] {
  switch (get_principal_view_plane_axis(view)) {
    case 'x': {
      const coords: number[] = [];
      for (let x = bounds.min_x; x < bounds.min_x + bounds.width; x += 1) coords.push(x);
      return sort_plane_coordinates_for_view(coords, view);
    }
    case 'y': {
      const coords: number[] = [];
      for (let y = bounds.min_y; y < bounds.min_y + bounds.height; y += 1) coords.push(y);
      return sort_plane_coordinates_for_view(coords, view);
    }
    case 'z':
    default:
      return sort_plane_coordinates_for_view(authored_planes, view);
  }
}

export function rotate_cardinal_neighbors_for_view<T>(neighbors: CardinalNeighborMap<T>, view: PlacePrincipalView): CardinalNeighborMap<T> {
  return rotate_cardinal_neighbors_for_view_state(neighbors, make_place_view_state(view, 0));
}

export function get_plane_cardinal_neighbor_offsets_for_view_state(state: PlaceViewState): Partial<Record<CardinalDirection, PlaneNeighborOffset>> {
  const out: Partial<Record<CardinalDirection, PlaneNeighborOffset>> = {};
  const origin = project_world_point_with_roll({ x: 0, y: 0, z: 0 }, state);
  const samples: readonly PlaneNeighborOffset[] = [
    { dx: 1, dy: 0, dz: 0 },
    { dx: -1, dy: 0, dz: 0 },
    { dx: 0, dy: 1, dz: 0 },
    { dx: 0, dy: -1, dz: 0 },
    { dx: 0, dy: 0, dz: 1 },
    { dx: 0, dy: 0, dz: -1 },
  ];

  for (const sample of samples) {
    const projected = project_world_point_with_roll({ x: sample.dx, y: sample.dy, z: sample.dz }, state);
    if (projected.plane !== origin.plane) continue;
    const du = projected.u - origin.u;
    const dv = projected.v - origin.v;
    if (Math.abs(du) + Math.abs(dv) !== 1) continue;
    if (du === 0 && dv === -1) out.north = sample;
    else if (du === 1 && dv === 0) out.east = sample;
    else if (du === 0 && dv === 1) out.south = sample;
    else if (du === -1 && dv === 0) out.west = sample;
  }

  return out;
}

export function rotate_cardinal_neighbors_for_view_state<T>(neighbors: CardinalNeighborMap<T>, state: PlaceViewState): CardinalNeighborMap<T> {
  const out: CardinalNeighborMap<T> = {};
  const origin = project_world_point_with_roll({ x: 0, y: 0, z: 0 }, state);
  const samples: Array<{ world: 'north' | 'east' | 'south' | 'west'; x: number; y: number; z: number; value: T | undefined }> = [
    { world: 'north', x: 0, y: -1, z: 0, value: neighbors.north },
    { world: 'east', x: 1, y: 0, z: 0, value: neighbors.east },
    { world: 'south', x: 0, y: 1, z: 0, value: neighbors.south },
    { world: 'west', x: -1, y: 0, z: 0, value: neighbors.west },
  ];

  for (const sample of samples) {
    if (sample.value === undefined) continue;
    const projected = project_world_point_with_roll({ x: sample.x, y: sample.y, z: sample.z }, state);
    if (projected.plane !== origin.plane) continue;
    const du = projected.u - origin.u;
    const dv = projected.v - origin.v;
    if (du === 0 && dv === -1) out.north = sample.value;
    else if (du === 1 && dv === 0) out.east = sample.value;
    else if (du === 0 && dv === 1) out.south = sample.value;
    else if (du === -1 && dv === 0) out.west = sample.value;
  }

  return out;
}
