export type PanAxis = 'x' | 'y' | 'z';

export type PanAxes = {
  x?: boolean;
  y?: boolean;
  z?: boolean;
};

export type PanSpace = 'screen_pixels' | 'screen_tiles' | 'module_cells' | 'world';

export type PanInputSource = 'drag' | 'wheel' | 'keyboard' | 'programmatic' | 'automation';

export type PanMotionStyle =
  | { kind: 'snap' }
  | { kind: 'smooth'; lerp: number }
  | { kind: 'inertial'; friction: number };

export type PanCapabilities = {
  axes: PanAxes;
  space: PanSpace;
  motion_style: PanMotionStyle;
  can_detach_follow?: boolean;
  persist_key?: string | null;
};

export type PanVector2 = { x: number; y: number };
export type PanVector3 = { x: number; y: number; z: number };

export type PanBounds2 = {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
};

export type PanBounds3 = {
  min_x?: number;
  max_x?: number;
  min_y?: number;
  max_y?: number;
  min_z?: number;
  max_z?: number;
};
