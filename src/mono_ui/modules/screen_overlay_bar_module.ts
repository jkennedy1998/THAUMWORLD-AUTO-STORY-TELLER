import type { Canvas, Module, PointerEvent, Rect } from '../types.js';
import { get_color_by_name } from '../colors.js';
import { draw_module_border, PANEL_BORDER_PRESETS } from '../module_borders.js';

type OverlayButton = {
  id: string;
  label: string | (() => string);
  width?: number;
  shortcut?: string;
  shortcut_ctrl?: boolean;
  onPress: () => void | Promise<void>;
  is_active?: () => boolean;
};

type OverlayTab = {
  id: string;
  label: string | (() => string);
  width?: number;
  items?: OverlayButton[] | (() => OverlayButton[]);
  is_visible?: () => boolean;
};

type OverlayBarOptions = {
  id: string;
  title?: string;
  get_screen_size: () => { width: number; height: number };
  get_insets?: () => { left?: number; right?: number; top?: number; bottom?: number };
  anchor?: 'bottom' | 'top';
  buttons: () => OverlayButton[];
  tabs?: () => OverlayTab[];
  get_status_text?: () => string;
  get_is_visible?: () => boolean;
  get_is_expanded?: () => boolean;
  set_is_expanded?: (expanded: boolean) => void;
  default_expanded?: boolean;
  collapsed_height?: number;
  expanded_height?: number;
  inset_left?: number;
  inset_right?: number;
  inset_top?: number;
  inset_bottom?: number;
};

const ANIMATION_MS = 140;
const HANDLE_WIDTH = 1;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function ease_out_cubic(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), 3);
}

function resolve_label(label: OverlayButton['label']): string {
  return typeof label === 'function' ? label() : label;
}

export function make_screen_overlay_bar_module(opts: OverlayBarOptions): Module {
  let expanded = opts.default_expanded ?? true;
  let active_tab_id: string | null | undefined = undefined;
  let anim_from = expanded ? 1 : 0;
  let anim_to = expanded ? 1 : 0;
  let anim_started_at = Date.now();
  let runtime_pan_x = 0;
  let runtime_pan_y = 0;

  const collapsed_height = Math.max(3, opts.collapsed_height ?? 3);
  const expanded_height = Math.max(collapsed_height, opts.expanded_height ?? 5);
  function get_insets(): { left: number; right: number; top: number; bottom: number } {
    const dynamic = opts.get_insets?.() ?? {};
    return {
      left: Math.max(0, dynamic.left ?? opts.inset_left ?? 2),
      right: Math.max(0, dynamic.right ?? opts.inset_right ?? 2),
      top: Math.max(0, dynamic.top ?? opts.inset_top ?? 1),
      bottom: Math.max(0, dynamic.bottom ?? opts.inset_bottom ?? 1),
    };
  }

  function get_target_expanded(): boolean {
    return opts.get_is_expanded ? opts.get_is_expanded() : expanded;
  }

  function set_expanded(next: boolean): void {
    const current_progress = get_progress();
    anim_from = current_progress;
    anim_to = next ? 1 : 0;
    anim_started_at = Date.now();
    expanded = next;
    opts.set_is_expanded?.(next);
  }

  function get_progress(): number {
    const target = get_target_expanded();
    if (target !== expanded) {
      set_expanded(target);
    }
    if (anim_from === anim_to) {
      return anim_to;
    }
    const elapsed = Date.now() - anim_started_at;
    const t = clamp01(elapsed / ANIMATION_MS);
    const eased = ease_out_cubic(t);
    const progress = anim_from + ((anim_to - anim_from) * eased);
    if (t >= 1) {
      anim_from = anim_to;
    }
    return progress;
  }

  function get_rect(): Rect {
    const { width, height } = opts.get_screen_size();
    const insets = get_insets();
    const progress = get_progress();
    const current_height = collapsed_height + Math.round((expanded_height - collapsed_height) * progress);
    if ((opts.anchor ?? 'bottom') === 'top') {
      return {
        x0: insets.left - runtime_pan_x,
        y0: (height - current_height - insets.top) + runtime_pan_y,
        x1: (width - 1 - insets.right) - runtime_pan_x,
        y1: (height - 1 - insets.top) + runtime_pan_y,
      };
    }
    return {
      x0: insets.left - runtime_pan_x,
      y0: insets.bottom + runtime_pan_y,
      x1: (width - 1 - insets.right) - runtime_pan_x,
      y1: (insets.bottom + current_height - 1) + runtime_pan_y,
    };
  }

  function get_tabs(): OverlayTab[] {
    const tabs = opts.tabs?.() ?? [];
    return tabs.filter((tab) => tab.is_visible ? tab.is_visible() : true);
  }

  function get_active_tab(): OverlayTab | null {
    const tabs = get_tabs();
    if (tabs.length < 1) {
      active_tab_id = null;
      return null;
    }
    if (active_tab_id === undefined) {
      active_tab_id = tabs[0]?.id ?? null;
    }
    if (active_tab_id === null) return null;
    if (!tabs.some((tab) => tab.id === active_tab_id)) {
      active_tab_id = tabs[0]?.id ?? null;
    }
    return tabs.find((tab) => tab.id === active_tab_id) ?? null;
  }

  function get_tab_items(tab: OverlayTab | null): OverlayButton[] {
    if (!tab?.items) return [];
    return typeof tab.items === 'function' ? tab.items() : tab.items;
  }

  function get_handle_bounds(rect: Rect): { x0: number; x1: number; y: number } {
    const x0 = rect.x0 + Math.floor(((rect.x1 - rect.x0 + 1) - HANDLE_WIDTH) / 2);
    const handle_y = (opts.anchor ?? 'bottom') === 'top'
      ? rect.y0 + 1
      : rect.y1 - 1;
    return { x0, x1: x0 + HANDLE_WIDTH - 1, y: handle_y };
  }

  function get_visible_content_rows(rect: Rect): number {
    return Math.max(1, rect.y1 - rect.y0 - 1);
  }

  function get_button_row_y(rect: Rect): number | null {
    if (get_visible_content_rows(rect) < 2) return null;
    return (opts.anchor ?? 'bottom') === 'top'
      ? rect.y1 - 1
      : rect.y0 + 1;
  }

  function get_status_row_y(rect: Rect): number | null {
    if (get_visible_content_rows(rect) < 3) return null;
    return (opts.anchor ?? 'bottom') === 'top'
      ? rect.y1 - 2
      : rect.y0 + 2;
  }

  function get_tab_row_y(rect: Rect): number | null {
    return get_status_row_y(rect);
  }

  function get_button_layout(rect: Rect): Array<{ button: OverlayButton; x0: number; x1: number }> {
    const buttons = get_tab_items(get_active_tab());
    const layout: Array<{ button: OverlayButton; x0: number; x1: number }> = [];
    let x = rect.x0 + 2;
    for (const button of buttons) {
      const label = resolve_label(button.label);
      const width = button.width ?? Math.max(4, label.length);
      if (x + width > rect.x1 - 1) break;
      layout.push({ button, x0: x, x1: x + width - 1 });
      x += width + 2;
    }
    return layout;
  }

  function get_tab_layout(rect: Rect): Array<{ tab: OverlayTab; x0: number; x1: number }> {
    const layout: Array<{ tab: OverlayTab; x0: number; x1: number }> = [];
    let x = rect.x0 + 2;
    for (const tab of get_tabs()) {
      const label = resolve_label(tab.label);
      const width = tab.width ?? Math.max(5, label.length);
      if (x + width > rect.x1 - 1) break;
      layout.push({ tab, x0: x, x1: x + width - 1 });
      x += width + 2;
    }
    return layout;
  }

  function press_button(button: OverlayButton): void {
    try {
      const result = button.onPress();
      void result;
    } catch {
      // ignore
    }
  }

  function toggle_tab(tab_id: string): void {
    active_tab_id = active_tab_id === tab_id ? null : tab_id;
  }

  return {
    id: opts.id,
    get rect() { return get_rect(); },
    Focusable: true,
    setRuntimePanOffset(x_tiles: number, y_tiles: number): void {
      runtime_pan_x = x_tiles;
      runtime_pan_y = y_tiles;
    },

    Draw(c: Canvas): void {
      if (opts.get_is_visible && !opts.get_is_visible()) return;
      const rect = get_rect();
      const border_rgb = get_color_by_name('medium_gray').rgb;
      const bg_rgb = get_color_by_name('off_black').rgb;
      const text_rgb = get_color_by_name('off_white').rgb;
      const accent_rgb = get_color_by_name('vivid_yellow').rgb;
      const handle = get_handle_bounds(rect);

      c.fill_rect(rect, { char: ' ', rgb: bg_rgb, style: 'regular', weight_index: 1 });
      draw_module_border(c, {
        rect,
        style: PANEL_BORDER_PRESETS.default_double.style,
        border_rgb,
        weight_index: PANEL_BORDER_PRESETS.default_double.weight_index,
      });

      c.set(handle.x0, handle.y, {
        char: get_target_expanded() ? 'v' : '^',
        rgb: accent_rgb,
        style: 'regular',
        weight_index: 3,
        render_index: 7,
      });

      const tab_y = get_tab_row_y(rect);
      if (tab_y !== null) {
        for (const entry of get_tab_layout(rect)) {
          const label = resolve_label(entry.tab.label);
          const color = entry.tab.id === active_tab_id ? accent_rgb : text_rgb;
          for (let i = 0; i < label.length && entry.x0 + i <= entry.x1; i++) {
            c.set(entry.x0 + i, tab_y, {
              char: label[i]!,
              rgb: color,
              style: 'regular',
              weight_index: entry.tab.id === active_tab_id ? 3 : 2,
              render_index: 6,
            });
          }
        }
      }

      const button_y = get_button_row_y(rect);
      if (button_y !== null) {
        for (const entry of get_button_layout(rect)) {
          const label = resolve_label(entry.button.label);
          const color = entry.button.is_active?.() ? accent_rgb : text_rgb;
          for (let i = 0; i < label.length && entry.x0 + i <= entry.x1; i++) {
            c.set(entry.x0 + i, button_y, {
              char: label[i]!,
              rgb: color,
              style: 'regular',
              weight_index: entry.button.is_active?.() ? 3 : 2,
              render_index: 6,
            });
          }
        }

        if (get_button_layout(rect).length < 1) {
          const status_text = opts.get_status_text?.();
          if (status_text) {
            for (let i = 0; i < status_text.length && rect.x0 + 2 + i < rect.x1; i++) {
              c.set(rect.x0 + 2 + i, button_y, {
                char: status_text[i]!,
                rgb: text_rgb,
                style: 'regular',
                weight_index: 2,
                render_index: 6,
              });
            }
          }
        }
      }
    },

    OnPointerDown(e: PointerEvent): void {
      if (opts.get_is_visible && !opts.get_is_visible()) return;
      if (e.button !== 0) return;
      const rect = get_rect();
      const handle = get_handle_bounds(rect);
      if (e.y === handle.y && e.x >= handle.x0 && e.x <= handle.x1) {
        set_expanded(!get_target_expanded());
        return;
      }
      const tab_y = get_tab_row_y(rect);
      if (tab_y !== null && e.y === tab_y) {
        for (const entry of get_tab_layout(rect)) {
          if (e.x >= entry.x0 && e.x <= entry.x1) {
            toggle_tab(entry.tab.id);
            return;
          }
        }
      }
      const button_y = get_button_row_y(rect);
      if (button_y === null || e.y !== button_y) return;
      for (const entry of get_button_layout(rect)) {
        if (e.x >= entry.x0 && e.x <= entry.x1) {
          press_button(entry.button);
          return;
        }
      }
    },

    OnGlobalKeyDown(e: KeyboardEvent): void {
      if (opts.get_is_visible && !opts.get_is_visible()) return;
      const key = e.key.toUpperCase();
      for (const button of opts.buttons()) {
        if (!button.shortcut) continue;
        if (button.shortcut.toUpperCase() !== key) continue;
        if ((button.shortcut_ctrl ?? false) && !(e.ctrlKey || e.metaKey)) continue;
        if (!(button.shortcut_ctrl ?? false) && (e.ctrlKey || e.metaKey)) continue;
        e.preventDefault();
        press_button(button);
        return;
      }
    },
  };
}
