import { clamp_anchor_to_viewport_px, compute_anchor_relative_mouse_parallax } from './camera_anchor_runtime.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const parallax = compute_anchor_relative_mouse_parallax({
  viewport: { x0: 0, y0: 0, x1: 10, y1: 10 },
  anchor_screen_x: 5,
  anchor_screen_y: 5,
  pointer_x: 10,
  pointer_y: 0,
});
assert(parallax.x === 1, 'parallax should clamp positive X to 1');
assert(parallax.y === -1, 'parallax should clamp negative Y to -1');

const centered = compute_anchor_relative_mouse_parallax({
  viewport: { x0: 2, y0: 4, x1: 12, y1: 14 },
  anchor_screen_x: 7,
  anchor_screen_y: 9,
  pointer_x: 7,
  pointer_y: 9,
});
assert(centered.x === 0 && centered.y === 0, 'anchor-relative parallax should be neutral at the anchor');

const clamped = clamp_anchor_to_viewport_px({ x: -20, y: 50 }, { width: 100, height: 40 });
assert(clamped.x === 0 && clamped.y === 40, 'anchor pivot should clamp into viewport bounds');

const fallback = clamp_anchor_to_viewport_px(null, { width: 80, height: 20 });
assert(fallback.x === 40 && fallback.y === 10, 'null anchor should fall back to viewport center');

console.log('camera_anchor_runtime tests passed');
