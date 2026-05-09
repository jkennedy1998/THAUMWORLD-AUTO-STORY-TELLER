import type { PanInputSource } from './pan_types.js';

export type PanGestureStart = {
  pointer_id: number;
  screen_x: number;
  screen_y: number;
  source: PanInputSource;
};

export type PanGestureMove = {
  pointer_id: number;
  screen_x: number;
  screen_y: number;
  dx: number;
  dy: number;
  source: PanInputSource;
};

export type PanGestureEnd = {
  pointer_id: number;
  source: PanInputSource;
};

export type PanSessionState = {
  active: boolean;
  pointer_id: number | null;
  start_screen_x: number;
  start_screen_y: number;
  last_screen_x: number;
  last_screen_y: number;
};
