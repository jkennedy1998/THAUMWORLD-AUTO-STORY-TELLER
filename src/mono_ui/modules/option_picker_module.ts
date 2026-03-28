import type { Canvas, Module, PointerEvent, Rect } from "../types.js";
import { make_floating_panel_module } from "./floating_panel_module.js";
import { get_color_by_name } from "../colors.js";

export type OptionPickerEntry = {
  value: string;
  label: string;
  description?: string;
};

export type OptionPickerModuleConfig = {
  id: string;
  rect: Rect;
  get_is_visible: () => boolean;
  get_title: () => string;
  get_options: () => OptionPickerEntry[];
  get_selected_value: () => string | null;
  get_status_lines?: () => string[];
  on_select: (value: string) => void;
  on_close: () => void;
  on_move?: (rect: Rect) => void;
};

export function make_option_picker_module(opts: OptionPickerModuleConfig): Module {
  let cursor = 0;
  let visible_start = 0;

  function trim_to_width(text: string, width: number): string {
    if (width <= 0) return "";
    if (text.length <= width) return text;
    if (width === 1) return text.charAt(0);
    return `${text.slice(0, width - 1)}~`;
  }

  function draw_line(c: Canvas, x: number, y: number, text: string, rgb = get_color_by_name("off_white").rgb, weight_index = 4): void {
    for (let i = 0; i < text.length; i += 1) {
      c.set(x + i, y, { char: text[i]!, rgb, weight_index, render_index: 6, style: "regular" });
    }
  }

  function sync_cursor(): void {
    const options = opts.get_options();
    if (options.length < 1) {
      cursor = 0;
      visible_start = 0;
      return;
    }
    const selected_value = opts.get_selected_value();
    const selected_index = selected_value ? options.findIndex((option) => option.value === selected_value) : -1;
    if (selected_index >= 0) cursor = selected_index;
    cursor = Math.max(0, Math.min(options.length - 1, cursor));
  }

  function select_cursor(): void {
    const options = opts.get_options();
    const picked = options[cursor];
    if (!picked) return;
    opts.on_select(picked.value);
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: opts.get_title,
    is_visible: opts.get_is_visible,
    background: { rgb: get_color_by_name("off_black").rgb },
    border: {
      border_rgb: get_color_by_name("vivid_blue").rgb,
      text_rgb: get_color_by_name("vivid_blue").rgb,
    },
    resize: { min_width: 22, min_height: 10, max_width: 42, max_height: 30 },
    gizmos: {
      enabled: ["close", "move", "seamless"],
      can_close: true,
      can_move: true,
      can_save_position: false,
      on_close: opts.on_close,
      on_move: opts.on_move,
      on_move_end: opts.on_move,
    },
    draw_content(c: Canvas, rect: Rect): void {
      sync_cursor();
      const options = opts.get_options();
      const status_lines = opts.get_status_lines?.() ?? [];
      const inner_width = Math.max(1, rect.x1 - rect.x0 - 2);
      const list_height = Math.max(1, rect.y1 - rect.y0 - 5);
      if (cursor < visible_start) visible_start = cursor;
      if (cursor >= visible_start + list_height) visible_start = cursor - list_height + 1;
      visible_start = Math.max(0, Math.min(visible_start, Math.max(0, options.length - list_height)));

      for (let row = 0; row < list_height; row += 1) {
        const option = options[visible_start + row];
        const y = rect.y1 - 2 - row;
        if (y <= rect.y0 + 2) break;
        if (!option) continue;
        const is_cursor = visible_start + row === cursor;
        const is_selected = opts.get_selected_value() === option.value;
        const prefix = is_cursor ? ">" : is_selected ? "*" : " ";
        const line = trim_to_width(`${prefix}${option.label}`, inner_width);
        draw_line(c, rect.x0 + 1, y, line, is_cursor ? get_color_by_name("vivid_yellow").rgb : is_selected ? get_color_by_name("vivid_green").rgb : get_color_by_name("off_white").rgb, is_cursor ? 6 : 4);
      }

      const footer_y = rect.y0 + 2;
      const current = options[cursor] ?? null;
      const footer = current?.description ? current.description : current?.value ?? "no options";
      draw_line(c, rect.x0 + 1, footer_y, trim_to_width(footer, inner_width), get_color_by_name("medium_gray").rgb, 3);
      for (let i = 0; i < status_lines.length && footer_y - 1 - i > rect.y0; i += 1) {
        draw_line(c, rect.x0 + 1, footer_y - 1 - i, trim_to_width(status_lines[i] ?? "", inner_width), get_color_by_name("medium_gray").rgb, 3);
      }
    },
    on_pointer_down_content(e: PointerEvent, rect: Rect): void {
      const options = opts.get_options();
      const list_height = Math.max(1, rect.y1 - rect.y0 - 5);
      const row = rect.y1 - 2 - e.y;
      if (row < 0 || row >= list_height) return;
      const index = visible_start + row;
      if (index < 0 || index >= options.length) return;
      cursor = index;
      select_cursor();
    },
    on_key_down(e: KeyboardEvent): void {
      sync_cursor();
      const options = opts.get_options();
      if (e.key === "Escape") {
        opts.on_close();
        return;
      }
      if (options.length < 1) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        cursor = Math.min(options.length - 1, cursor + 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        cursor = Math.max(0, cursor - 1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        select_cursor();
      }
    },
  });
}
