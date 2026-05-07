import type { Canvas, DragEvent, Module, PointerEvent, Rect, Rgb, WheelEvent } from '../types.js';
import type { ModuleBorderConfig } from '../module_borders.js';
import { PANEL_BORDER_PRESETS, draw_module_border } from '../module_borders.js';
import { get_ui_semantic_rgb } from '../runtime/ui_customization_store.js';
import type { GizmoState, ModuleGizmosConfig } from '../module_gizmos.js';
import {
  clear_gizmo_hover_state,
  create_gizmo_state,
  draw_module_gizmos,
  get_resize_edge,
  handle_global_pointer_down_for_gizmos,
  handle_gizmo_click,
  handle_move_drag,
  handle_resize_drag,
  is_in_gizmo_area,
  should_draw_module_chrome,
  update_gizmo_hover_state,
} from '../module_gizmos.js';

type BorderOptions = {
  style?: typeof PANEL_BORDER_PRESETS[keyof typeof PANEL_BORDER_PRESETS]['style'];
  border_rgb?: Rgb;
  weight_index?: number;
  text_rgb?: Rgb;
  markers?: ModuleBorderConfig['markers'] | ((rect: Rect) => ModuleBorderConfig['markers'] | undefined);
  reserve_left_cols?: number;
  divider_at_col?: number;
  divider_mode?: 'none' | 'header_only' | 'full_height';
};

type BackgroundOptions = {
  char?: string;
  rgb?: Rgb;
};

type ResizeOptions = {
  min_width: number;
  min_height: number;
  max_width: number;
  max_height: number;
};

type FloatingPanelCallbacks = {
  draw_content: (c: Canvas, rect: Rect) => void;
  draw_overlay?: (c: Canvas, rect: Rect) => void;
  on_pointer_enter_content?: (e: PointerEvent, rect: Rect) => void;
  on_pointer_down_content?: (e: PointerEvent, rect: Rect) => void;
  on_pointer_move_content?: (e: PointerEvent, rect: Rect) => void;
  on_drag_start_content?: (e: DragEvent, rect: Rect) => void;
  on_drag_move_content?: (e: DragEvent, rect: Rect) => void;
  on_drag_end_content?: (e: DragEvent, rect: Rect) => void;
  on_pointer_up_content?: (rect: Rect) => void;
  on_wheel_content?: (e: WheelEvent, rect: Rect) => void;
  on_pointer_leave_content?: (e: PointerEvent, rect: Rect) => void;
  on_key_down?: (e: KeyboardEvent) => void;
  on_key_up?: (e: KeyboardEvent) => void;
  on_text_input?: (text: string) => void;
  wants_text_capture?: () => boolean;
  on_focus?: () => void;
  on_blur?: () => void;
  on_global_key_down?: (e: KeyboardEvent) => void;
  on_global_key_up?: (e: KeyboardEvent) => void;
};

export type FloatingPanelOptions = FloatingPanelCallbacks & {
  id: string;
  rect: Rect;
  title?: string | (() => string);
  gizmos?: ModuleGizmosConfig;
  background?: BackgroundOptions;
  border?: BorderOptions;
  resize?: ResizeOptions;
  focusable?: boolean;
  is_visible?: () => boolean;
  on_global_pointer_down_content?: (e: PointerEvent, rect: Rect) => void;
};

const NO_GIZMOS: ModuleGizmosConfig = {
  enabled: [],
  can_close: false,
  can_move: false,
  can_save_position: false,
};

function draw_panel_background(c: Canvas, rect: Rect, background: BackgroundOptions | undefined): void {
  c.fill_rect(rect, {
    char: background?.char ?? ' ',
    rgb: background?.rgb ?? get_ui_semantic_rgb('background'),
    style: 'regular',
  });
}

function resolve_border_markers(border: BorderOptions | undefined, rect: Rect): ModuleBorderConfig['markers'] | undefined {
  const markers = border?.markers;
  if (!markers) return undefined;
  return typeof markers === 'function' ? markers(rect) : markers;
}

function resolve_title(title: FloatingPanelOptions['title']): string | undefined {
  if (!title) return undefined;
  return typeof title === 'function' ? title() : title;
}

export function make_floating_panel_module(opts: FloatingPanelOptions): Module {
  let rect = opts.rect;
  const gizmos = opts.gizmos ?? NO_GIZMOS;
  const gizmo_state: GizmoState = create_gizmo_state();

  return {
    id: opts.id,
    get rect() { return rect; },
    set rect(next_rect) { rect = next_rect; },
    Focusable: opts.focusable ?? true,

    Draw(c: Canvas): void {
      if (opts.is_visible && !opts.is_visible()) return;
      const title = resolve_title(opts.title);
      const draw_chrome = should_draw_module_chrome(gizmos, gizmo_state);
      draw_panel_background(c, rect, opts.background);
      opts.draw_content(c, rect);
      if (draw_chrome) {
        draw_module_border(c, {
          rect,
          style: opts.border?.style ?? PANEL_BORDER_PRESETS.default_double.style,
          border_rgb: opts.border?.border_rgb ?? get_ui_semantic_rgb('dimmest'),
          weight_index: opts.border?.weight_index ?? PANEL_BORDER_PRESETS.default_double.weight_index,
          markers: resolve_border_markers(opts.border, rect),
          header: title ? {
            text: title,
            text_rgb: opts.border?.text_rgb ?? get_ui_semantic_rgb('medium'),
            reserve_left_cols: opts.border?.reserve_left_cols ?? (2 + ((gizmos.enabled?.length ?? 0) * 2)),
            divider_at_col: opts.border?.divider_at_col,
            divider_mode: opts.border?.divider_mode,
          } : undefined,
        });
        draw_module_gizmos(c, rect, gizmos, gizmo_state);
        opts.draw_overlay?.(c, rect);
      }
    },

    OnPointerEnter(e: PointerEvent): void {
      update_gizmo_hover_state(e.x, e.y, rect, gizmos, gizmo_state);
      opts.on_pointer_enter_content?.(e, rect);
    },

    OnGlobalPointerDown(e: PointerEvent): void {
      if (opts.is_visible && !opts.is_visible()) return;
      handle_global_pointer_down_for_gizmos(e, rect, gizmos, gizmo_state);
      opts.on_global_pointer_down_content?.(e, rect);
    },

    OnPointerDown(e: PointerEvent): void {
      if (opts.is_visible && !opts.is_visible()) return;
      update_gizmo_hover_state(e.x, e.y, rect, gizmos, gizmo_state);
      if (is_in_gizmo_area(e.x, e.y, rect, gizmos)) {
        const gizmo = handle_gizmo_click(e.x, e.y, rect, gizmos, gizmo_state);
        if (gizmo === 'move' || gizmo === 'resize') {
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
          gizmo_state.original_rect = { ...rect };
        }
        return;
      }

      if (gizmo_state.is_resize_mode) {
        const edge = get_resize_edge(e.x, e.y, rect);
        if (edge) {
          gizmo_state.resize_edge = edge;
          gizmo_state.is_dragging_resize = true;
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
          gizmo_state.original_rect = { ...rect };
          return;
        }
      }

      if (gizmo_state.is_move_mode) {
        gizmo_state.move_start_x = e.x;
        gizmo_state.move_start_y = e.y;
        if (!gizmo_state.original_rect) gizmo_state.original_rect = { ...rect };
        return;
      }

      opts.on_pointer_down_content?.(e, rect);
    },

    OnPointerMove(e: PointerEvent): void {
      if (opts.is_visible && !opts.is_visible()) return;
      update_gizmo_hover_state(e.x, e.y, rect, gizmos, gizmo_state);
      if (gizmo_state.is_resize_mode && !gizmo_state.is_dragging_resize) {
        gizmo_state.resize_edge = get_resize_edge(e.x, e.y, rect);
      }
      opts.on_pointer_move_content?.(e, rect);
    },

    OnDragStart(e: DragEvent): void {
      if (opts.is_visible && !opts.is_visible()) return;
      if (gizmo_state.is_move_mode || gizmo_state.is_resize_mode) {
        gizmo_state.move_start_x = e.start_x;
        gizmo_state.move_start_y = e.start_y;
        if (!gizmo_state.original_rect) gizmo_state.original_rect = { ...rect };
        return;
      }
      opts.on_drag_start_content?.(e, rect);
    },

    OnDragMove(e: DragEvent): void {
      if (opts.is_visible && !opts.is_visible()) return;
      if (gizmo_state.is_move_mode && gizmo_state.original_rect) {
        const next_rect = handle_move_drag(e.x, e.y, gizmo_state, gizmo_state.original_rect, gizmos.on_move);
        
        if (next_rect) rect = next_rect;
        return;
      }

      if (opts.resize && gizmo_state.is_resize_mode && gizmo_state.is_dragging_resize && gizmo_state.original_rect) {
        const next_rect = handle_resize_drag(
          e.x,
          e.y,
          gizmo_state,
          gizmo_state.original_rect,
          opts.resize.min_width,
          opts.resize.min_height,
          opts.resize.max_width,
          opts.resize.max_height,
          gizmos.on_resize ?? gizmos.on_move,
        );
        if (next_rect) rect = next_rect;
        return;
      }

      opts.on_drag_move_content?.(e, rect);
    },

    OnDragEnd(e: DragEvent): void {
      if (opts.is_visible && !opts.is_visible()) return;
      opts.on_drag_end_content?.(e, rect);

      if (gizmo_state.is_dragging_resize) {
        gizmo_state.is_dragging_resize = false;
        gizmo_state.resize_edge = null;
        gizmos.on_resize_end?.(rect);
        if (gizmos.on_resize) gizmos.on_resize(rect);
        else gizmos.on_move?.(rect);
      }

      if (gizmo_state.is_move_mode) {
        gizmos.on_move_end?.(rect);
      }
    },

    OnPointerUp(): void {
      if (opts.is_visible && !opts.is_visible()) return;
      opts.on_pointer_up_content?.(rect);

      if (gizmo_state.is_move_mode) {
        gizmo_state.is_move_mode = false;
        gizmos.on_move_end?.(rect);
        gizmos.on_move?.(rect);
      }

      if (gizmo_state.is_dragging_resize) {
        gizmo_state.is_dragging_resize = false;
        gizmo_state.resize_edge = null;
        gizmos.on_resize_end?.(rect);
        if (gizmos.on_resize) gizmos.on_resize(rect);
        else gizmos.on_move?.(rect);
      }
    },

    OnPointerLeave(e: PointerEvent): void {
      if (opts.is_visible && !opts.is_visible()) return;
      clear_gizmo_hover_state(gizmo_state);
      opts.on_pointer_leave_content?.(e, rect);
    },

    OnWheel(e: WheelEvent): void {
      if (opts.is_visible && !opts.is_visible()) return;
      opts.on_wheel_content?.(e, rect);
    },

    OnKeyDown(e: KeyboardEvent): void {
      if (opts.is_visible && !opts.is_visible()) return;
      opts.on_key_down?.(e);
    },

    OnKeyUp(e: KeyboardEvent): void {
      if (opts.is_visible && !opts.is_visible()) return;
      opts.on_key_up?.(e);
    },

    OnTextInput(text: string): void {
      if (opts.is_visible && !opts.is_visible()) return;
      opts.on_text_input?.(text);
    },

    WantsTextCapture(): boolean {
      if (opts.is_visible && !opts.is_visible()) return false;
      return opts.wants_text_capture?.() ?? false;
    },

    OnGlobalKeyDown(e: KeyboardEvent): void {
      if (opts.is_visible && !opts.is_visible()) return;
      opts.on_global_key_down?.(e);
    },

    OnGlobalKeyUp(e: KeyboardEvent): void {
      if (opts.is_visible && !opts.is_visible()) return;
      opts.on_global_key_up?.(e);
    },

    OnFocus(): void {
      if (opts.is_visible && !opts.is_visible()) return;
      opts.on_focus?.();
    },

    OnBlur(): void {
      if (opts.is_visible && !opts.is_visible()) return;
      opts.on_blur?.();
    },
  };
}
