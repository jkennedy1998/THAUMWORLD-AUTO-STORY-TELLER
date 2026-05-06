import type { Canvas, Rect } from '../types.js';
import { get_ui_semantic_rgb } from '../runtime/ui_customization_store.js';

export type CanvasNavViewAction = 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right';
export type CanvasNavButtonId = 'nav_toggle' | CanvasNavViewAction | 'depth_prev' | 'depth_next' | 'pan_placeholder';

export function get_canvas_nav_toggle_position(rect: Rect, top_left_gizmo_count: number): { x: number; y: number } {
  return { x: rect.x0 + 1 + (top_left_gizmo_count * 2), y: rect.y1 - 1 };
}

export function get_canvas_nav_cluster_buttons(rect: Rect, show_cluster: boolean): Array<{ id: CanvasNavButtonId; x: number; y: number; char: string }> {
  if (!show_cluster) return [];
  const start_x = rect.x1 - 4;
  const start_y = rect.y1 - 2;
  return [
    { id: 'roll_left', x: start_x, y: start_y, char: 'r' },
    { id: 'swing_up', x: start_x + 1, y: start_y, char: '↑' },
    { id: 'roll_right', x: start_x + 2, y: start_y, char: 'R' },
    { id: 'swing_left', x: start_x, y: start_y - 1, char: '←' },
    { id: 'pan_placeholder', x: start_x + 1, y: start_y - 1, char: '·' },
    { id: 'swing_right', x: start_x + 2, y: start_y - 1, char: '→' },
    { id: 'depth_prev', x: start_x, y: start_y - 2, char: '-' },
    { id: 'swing_down', x: start_x + 1, y: start_y - 2, char: '↓' },
    { id: 'depth_next', x: start_x + 2, y: start_y - 2, char: '+' },
  ];
}

export function get_canvas_nav_hit(rect: Rect, show_cluster: boolean, top_left_gizmo_count: number, x: number, y: number): CanvasNavButtonId | null {
  const toggle = get_canvas_nav_toggle_position(rect, top_left_gizmo_count);
  if (x === toggle.x && y === toggle.y) return 'nav_toggle';
  const hit = get_canvas_nav_cluster_buttons(rect, show_cluster).find((button) => button.x === x && button.y === y);
  return hit?.id ?? null;
}

export function get_canvas_nav_reserved_left_x(rect: Rect, show_cluster: boolean): number {
  if (!show_cluster) return rect.x1;
  return rect.x1 - 5;
}

export function draw_canvas_nav_cluster(c: Canvas, args: {
  rect: Rect;
  show_cluster: boolean;
  top_left_gizmo_count: number;
  hovered_button: CanvasNavButtonId | null;
  pressed_button: CanvasNavButtonId | null;
  render_index?: number;
}): void {
  const render_index = args.render_index ?? 1003;
  const nav_toggle = get_canvas_nav_toggle_position(args.rect, args.top_left_gizmo_count);
  c.set(nav_toggle.x, nav_toggle.y, {
    char: '>',
    rgb: get_ui_semantic_rgb('bright'),
    style: 'regular',
    weight_index: args.pressed_button === 'nav_toggle' ? 3 : 2,
    render_index,
  });
  for (const button of get_canvas_nav_cluster_buttons(args.rect, args.show_cluster)) {
    const pressed = args.pressed_button === button.id;
    const hovered = args.hovered_button === button.id;
    c.set(button.x, button.y, {
      char: button.char,
      rgb: pressed ? get_ui_semantic_rgb('vivid') : get_ui_semantic_rgb('bright'),
      style: 'regular',
      weight_index: pressed || hovered ? 1 : 0,
      render_index,
    });
  }
}
