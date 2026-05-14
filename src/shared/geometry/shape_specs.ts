import type { Size3, Voxel3 } from '../coords.js';

export type ShapeRenderMode2 = 'edge' | 'fill';
export type ShapeRenderMode3 = 'filled' | 'surfaces' | 'wireframe';

export type SignedAxis3 = -1 | 0 | 1;

export type AxisVector3 = {
  x: SignedAxis3;
  y: SignedAxis3;
  z: SignedAxis3;
};

export type OrthoBasis3 = {
  right: AxisVector3;
  up: AxisVector3;
  forward: AxisVector3;
};

export type VolumePrimitiveKind = 'box' | 'sphere' | 'cylinder' | 'cone';

export type Line2Spec = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type Rect2Spec = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type Polygon2Spec = {
  points: Array<{ x: number; y: number }>;
};

export type Line3Spec = {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
};

export type Box3Spec = {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
};

export type Box3SessionSpec = {
  anchor: Voxel3;
  size: Size3;
  basis?: OrthoBasis3;
};

export type Sphere3SessionSpec = {
  anchor: Voxel3;
  size: Size3;
  basis?: OrthoBasis3;
  u_segments?: number;
  v_segments?: number;
};

export type Cylinder3SessionSpec = {
  anchor: Voxel3;
  size: Size3;
  basis?: OrthoBasis3;
  radial_segments?: number;
};

export type Cone3SessionSpec = {
  anchor: Voxel3;
  size: Size3;
  basis?: OrthoBasis3;
  radial_segments?: number;
};
