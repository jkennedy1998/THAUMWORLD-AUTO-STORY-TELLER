import type { Canvas, Module, PointerEvent, Rect, Rgb } from '../types.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';
import { find_indexed_color_by_rgb, nearest_indexed_color } from '../colors.js';
import { get_ui_semantic_rgb, get_ui_semantic_role_label, list_ui_semantic_roles, type UiSemanticColorRole } from '../runtime/ui_customization_store.js';

export type CustomizationModuleOptions = {
  id: string;
  rect: Rect;
  get_active_role: () => UiSemanticColorRole;
  get_role_color?: (role: UiSemanticColorRole) => Rgb;
  on_role_select: (role: UiSemanticColorRole) => void;
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

const MIN_WIDTH = 20;
const MAX_WIDTH = 34;
const MIN_HEIGHT = 10;
const MAX_HEIGHT = 22;

function trim_text(value: string, max_len: number): string {
  if (value.length <= max_len) return value;
  return max_len <= 0 ? '' : value.slice(0, max_len);
}

export function make_customization_module(opts: CustomizationModuleOptions): Module {
  const roles = list_ui_semantic_roles();
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };

  function row_y_for_index(rect: Rect, index: number): number {
    return rect.y1 - 3 - index;
  }

  function role_from_y(rect: Rect, y: number): UiSemanticColorRole | null {
    for (let i = 0; i < roles.length; i += 1) {
      if (y === row_y_for_index(rect, i)) return roles[i] ?? null;
    }
    return null;
  }

  function role_color(role: UiSemanticColorRole): Rgb {
    return opts.get_role_color?.(role) ?? get_ui_semantic_rgb(role);
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: 'CUSTOM',
    gizmos: gizmo_config,
    resize: {
      min_width: MIN_WIDTH,
      min_height: MIN_HEIGHT,
      max_width: MAX_WIDTH,
      max_height: MAX_HEIGHT,
    },
    draw_content(c: Canvas, rect: Rect): void {
      const bg = get_ui_semantic_rgb('background');
      const medium = get_ui_semantic_rgb('medium');
      const bright = get_ui_semantic_rgb('bright');
      const vivid = get_ui_semantic_rgb('vivid');
      c.fill_rect(rect, { char: ' ', rgb: bg, style: 'regular', weight_index: 1, render_index: 0 });

      const active_role = opts.get_active_role();
      const max_label_len = Math.max(1, rect.x1 - rect.x0 - 12);
      for (let i = 0; i < roles.length; i += 1) {
        const role = roles[i]!;
        const y = row_y_for_index(rect, i);
        if (y <= rect.y0) break;
        const rgb = role_color(role);
        const indexed = find_indexed_color_by_rgb(rgb) ?? nearest_indexed_color(rgb);
        const is_active = role === active_role;
        c.set(rect.x0 + 1, y, { char: is_active ? '▶' : ' ', rgb: is_active ? vivid : medium, style: 'regular', weight_index: is_active ? 2 : 1, render_index: 6 });
        c.set(rect.x0 + 3, y, { char: '█', rgb, style: 'regular', weight_index: 3, render_index: 6 });
        const label = trim_text(get_ui_semantic_role_label(role), max_label_len);
        for (let j = 0; j < label.length; j += 1) {
          c.set(rect.x0 + 5 + j, y, { char: label[j]!, rgb: is_active ? bright : medium, style: 'regular', weight_index: is_active ? 2 : 1, render_index: 6 });
        }
        const name = trim_text(indexed.name.toUpperCase(), Math.max(0, rect.x1 - (rect.x0 + 5 + max_label_len) - 1));
        for (let j = 0; j < name.length && rect.x1 - name.length + j >= rect.x0 + 5 + label.length + 1; j += 1) {
          c.set(rect.x1 - name.length + j, y, { char: name[j]!, rgb: rgb, style: 'regular', weight_index: 1, render_index: 6 });
        }
      }

      const helper = trim_text('CLICK ROW TO EDIT', Math.max(0, rect.x1 - rect.x0 - 1));
      for (let i = 0; i < helper.length; i += 1) {
        c.set(rect.x0 + 1 + i, rect.y0 + 1, { char: helper[i]!, rgb: bright, style: 'regular', weight_index: 1, render_index: 6 });
      }
    },
    on_pointer_down_content(e: PointerEvent, rect: Rect): void {
      const role = role_from_y(rect, e.y);
      if (role) opts.on_role_select(role);
    },
  });
}
