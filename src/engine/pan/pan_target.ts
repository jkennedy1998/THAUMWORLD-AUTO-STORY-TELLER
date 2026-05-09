import type { PanCapabilities } from './pan_types.js';

export type PanTargetKind = 'viewport' | 'module_2d' | 'camera_3d' | 'scroll_1d';

export interface IPanTargetAdapter {
  getKind(): PanTargetKind;
  getCapabilities(): PanCapabilities;

  beginGesture?(): void;
  endGesture?(): void;
  cancelGesture?(): void;

  applyScreenDelta?(dx: number, dy: number): void;
  applyAxisDelta?(delta: Partial<{ x: number; y: number; z: number }>): void;

  clamp?(): void;
  persist?(): void;
}
