export type Point2 = {
  x: number;
  y: number;
};

export type Voxel3 = {
  x: number;
  y: number;
  z: number;
};

export type Size2 = {
  x: number;
  y: number;
};

export type Size3 = {
  x: number;
  y: number;
  z: number;
};

export type Bounds2 = {
  origin: Point2;
  size: Size2;
};

export type Bounds3 = {
  origin: Voxel3;
  size: Size3;
};

export type PlaneAxis = 'x' | 'y' | 'z';
export type PlaneId = 'xy' | 'yz' | 'xz';

export type PlanePoint = {
  u: number;
  v: number;
};

export type PlaneRect = {
  min_u: number;
  max_u: number;
  min_v: number;
  max_v: number;
};

export type PlaneVoxel = {
  plane: PlaneId;
  depth: number;
  u: number;
  v: number;
};

export type WorldVoxel = Voxel3;
export type LocalVoxel = Voxel3;
export type WorldPoint = Point2;
export type TilePoint = Point2;

export function point2(x: number, y: number): Point2 {
  return { x, y };
}

export function voxel3(x: number, y: number, z: number): Voxel3 {
  return { x, y, z };
}

export function size2(x: number, y: number): Size2 {
  return { x, y };
}

export function size3(x: number, y: number, z: number): Size3 {
  return { x, y, z };
}

export function trunc_point2(point: Point2): Point2 {
  return { x: Math.trunc(point.x), y: Math.trunc(point.y) };
}

export function trunc_voxel3(voxel: Voxel3): Voxel3 {
  return { x: Math.trunc(voxel.x), y: Math.trunc(voxel.y), z: Math.trunc(voxel.z) };
}

export function key_point2(point: Point2): string {
  const p = trunc_point2(point);
  return `${p.x},${p.y}`;
}

export function key_voxel3(voxel: Voxel3): string {
  const v = trunc_voxel3(voxel);
  return `${v.x},${v.y},${v.z}`;
}
