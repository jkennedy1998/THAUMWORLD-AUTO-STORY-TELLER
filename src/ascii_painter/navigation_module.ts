import type { Module, Canvas, Rect, PointerEvent } from '../mono_ui/types.js';
import { get_color_by_name } from '../mono_ui/colors.js';
import { make_floating_panel_module } from '../mono_ui/modules/floating_panel_module.js';
import type { ModuleGizmosConfig } from '../mono_ui/module_gizmos.js';

export type NavigationModuleOptions = {
  id: string;
  rect: Rect;
  title?: string;
  get_focus_world_plane: () => number | null;
  get_focus_slot: () => number;
  get_visible_planes: () => number[];
  on_action: (action: 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right' | 'depth_prev' | 'depth_next') => void;
  on_move?: (new_rect: Rect) => void;
  on_resize?: (new_rect: Rect) => void;
  onClose?: () => void;
};

const MIN_WIDTH = 26;
const MAX_WIDTH = 42;
const MIN_HEIGHT = 10;
const MAX_HEIGHT = 18;

function draw_text(c: Canvas, x: number, y: number, text: string, rgb: { r: number; g: number; b: number }, weight_index: number = 0): void {
  for (let i = 0; i < text.length; i += 1) {
    c.set(x + i, y, { char: text[i]!, rgb, weight_index, render_index: 10 });
  }
}

export function make_navigation_module(opts: NavigationModuleOptions): Module {
  let rect = opts.rect;
  const buttonHitboxes: Array<{ id: string; x0: number; y0: number; x1: number; y1: number }> = [];
  const pressedButtons = new Set<string>();
  const borderColor = get_color_by_name('medium_gray').rgb;
  const textColor = get_color_by_name('off_white').rgb;
  const labelColor = get_color_by_name('pale_gray').rgb;
  const accentColor = get_color_by_name('vivid_cyan').rgb;
  const valueColor = get_color_by_name('vivid_yellow').rgb;

  const gizmos: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.onClose,
    on_move: opts.on_move,
  };

  function set_button_hitbox(id: string, x0: number, y0: number, x1: number, y1: number): void {
    buttonHitboxes.push({ id, x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
  }

  function find_button_hitbox(x: number, y: number) {
    for (let i = buttonHitboxes.length - 1; i >= 0; i -= 1) {
      const hit = buttonHitboxes[i]!;
      if (x >= hit.x0 && x <= hit.x1 && y >= hit.y0 && y <= hit.y1) return hit;
    }
    return null;
  }

  function draw_button(c: Canvas, id: string, x: number, y: number, label: string): void {
    const active = pressedButtons.has(id);
    const color = active ? accentColor : textColor;
    const text = `[${label}]`;
    draw_text(c, x, y, text, color, active ? 1 : 0);
    set_button_hitbox(id, x, y, x + text.length - 1, y);
  }

  return make_floating_panel_module({
    id: opts.id,
    rect,
    title: opts.title ?? 'Navigation',
    gizmos,
    resize: { min_width: MIN_WIDTH, min_height: MIN_HEIGHT, max_width: MAX_WIDTH, max_height: MAX_HEIGHT },
    draw_content(c: Canvas, next_rect: Rect): void {
      rect = next_rect;
      buttonHitboxes.length = 0;
      const width = rect.x1 - rect.x0 + 1;
      const focusPlane = opts.get_focus_world_plane();
      const focusSlot = opts.get_focus_slot();
      const visiblePlanes = opts.get_visible_planes();
      const depthText = `DEPTH ${focusPlane ?? '-'}  SLOT ${focusSlot + 1}/${Math.max(1, visiblePlanes.length)}`;
      const rangeText = visiblePlanes.length > 0 ? `RANGE ${Math.min(...visiblePlanes)}..${Math.max(...visiblePlanes)}` : 'RANGE -';
      draw_text(c, rect.x0 + 2, rect.y1 - 2, depthText.slice(0, Math.max(0, width - 4)), valueColor, 1);
      draw_text(c, rect.x0 + 2, rect.y1 - 3, rangeText.slice(0, Math.max(0, width - 4)), labelColor, 0);

      const row1 = rect.y1 - 5;
      const row2 = rect.y1 - 6;
      const row3 = rect.y1 - 7;
      draw_text(c, rect.x0 + 2, row1, 'DEPTH', labelColor, 0);
      draw_button(c, 'depth_prev', rect.x0 + 10, row1, '<<');
      draw_button(c, 'depth_next', rect.x0 + 16, row1, '>>');

      draw_text(c, rect.x0 + 2, row2, 'SWING', labelColor, 0);
      draw_button(c, 'swing_left', rect.x0 + 10, row2, 'SL');
      draw_button(c, 'swing_right', rect.x0 + 16, row2, 'SR');
      draw_button(c, 'swing_up', rect.x0 + 22, row2, 'SU');
      draw_button(c, 'swing_down', rect.x0 + 28, row2, 'SD');

      draw_text(c, rect.x0 + 2, row3, 'ROLL', labelColor, 0);
      draw_button(c, 'roll_left', rect.x0 + 10, row3, 'RL');
      draw_button(c, 'roll_right', rect.x0 + 16, row3, 'RR');

      for (let x = rect.x0 + 1; x < rect.x1; x += 1) {
        c.set(x, rect.y1 - 4, { char: '─', rgb: borderColor, weight_index: 1, render_index: 10 });
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const hit = find_button_hitbox(e.x, e.y);
      if (!hit) return;
      pressedButtons.add(hit.id);
      switch (hit.id) {
        case 'depth_prev':
          opts.on_action('depth_prev');
          break;
        case 'depth_next':
          opts.on_action('depth_next');
          break;
        case 'swing_left':
        case 'swing_right':
        case 'swing_up':
        case 'swing_down':
        case 'roll_left':
        case 'roll_right':
          opts.on_action(hit.id);
          break;
      }
      setTimeout(() => pressedButtons.delete(hit.id), 120);
    },
  });
}
