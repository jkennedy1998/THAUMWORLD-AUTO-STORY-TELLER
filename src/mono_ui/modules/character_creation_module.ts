import type { Canvas, Module, PointerEvent, Rect } from "../types.js";
import { make_floating_panel_module } from "./floating_panel_module.js";
import { get_color_by_name } from "../colors.js";

export type CharacterCreationField = {
  key: string;
  label: string;
  value: string;
  editable?: boolean;
};

export type CharacterCreationModuleConfig = {
  id: string;
  rect: Rect;
  get_is_visible: () => boolean;
  get_title: () => string;
  get_subtitle?: () => string;
  get_fields: () => CharacterCreationField[];
  get_status_lines?: () => string[];
  on_update_field: (key: string, value: string) => void;
  on_select_field?: (key: string) => void;
  on_create: () => Promise<void>;
  on_reset: () => Promise<void>;
  on_close: () => void;
  on_move?: (rect: Rect) => void;
};

type RowHit =
  | { kind: "field"; key: string }
  | { kind: "button"; action: "create" | "reset" | "close" };

export function make_character_creation_module(opts: CharacterCreationModuleConfig): Module {
  let active_field_key: string | null = null;
  let row_hits: Array<{ y: number; hit: RowHit }> = [];

  function trim_to_width(text: string, width: number): string {
    if (width <= 0) return "";
    if (text.length <= width) return text;
    if (width === 1) return text.charAt(0);
    return `${text.slice(0, width - 1)}~`;
  }

  function draw_line(c: Canvas, x: number, y: number, text: string, rgb = get_color_by_name("off_white").rgb, weight_index = 2): void {
    for (let i = 0; i < text.length; i += 1) {
      c.set(x + i, y, { char: text[i]!, rgb, weight_index, render_index: 6, style: "regular" });
    }
  }

  async function trigger_button(action: "create" | "reset" | "close"): Promise<void> {
    if (action === "create") {
      await opts.on_create();
      return;
    }
    if (action === "reset") {
      await opts.on_reset();
      return;
    }
    opts.on_close();
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: opts.get_title,
    is_visible: opts.get_is_visible,
    background: { rgb: get_color_by_name("off_black").rgb },
    border: {
      border_rgb: get_color_by_name("vivid_green").rgb,
      text_rgb: get_color_by_name("vivid_green").rgb,
    },
    resize: { min_width: 32, min_height: 12, max_width: 60, max_height: 30 },
    gizmos: {
      enabled: ["close", "move", "resize", "seamless"],
      can_close: true,
      can_move: true,
      can_save_position: false,
      on_close: opts.on_close,
      on_move: opts.on_move,
      on_move_end: opts.on_move,
      on_resize: opts.on_move,
      on_resize_end: opts.on_move,
    },
    draw_content(c: Canvas, rect: Rect): void {
      row_hits = [];
      const fields = opts.get_fields();
      const status_lines = opts.get_status_lines?.() ?? [];
      const inner_width = Math.max(1, rect.x1 - rect.x0 - 2);
      let y = rect.y1 - 2;

      const subtitle = opts.get_subtitle?.() ?? "";
      if (subtitle) {
        draw_line(c, rect.x0 + 1, y, trim_to_width(subtitle, inner_width), get_color_by_name("light_gray").rgb, 3);
        y -= 1;
      }

      for (const field of fields) {
        if (y <= rect.y0 + 4) break;
        const is_active = field.key === active_field_key;
        const prefix = is_active ? ">" : " ";
        const edit_mark = field.editable === false ? "-" : ":";
        const line = trim_to_width(`${prefix}${field.label}${edit_mark} ${field.value}`, inner_width);
        draw_line(c, rect.x0 + 1, y, line, is_active ? get_color_by_name("vivid_yellow").rgb : get_color_by_name("off_white").rgb, is_active ? 6 : 4);
        row_hits.push({ y, hit: { kind: "field", key: field.key } });
        y -= 1;
      }

      const button_y = rect.y0 + 2;
      draw_line(c, rect.x0 + 1, button_y, "[CREATE]", get_color_by_name("vivid_green").rgb, 5);
      draw_line(c, rect.x0 + 12, button_y, "[RESET]", get_color_by_name("vivid_blue").rgb, 5);
      draw_line(c, rect.x0 + 22, button_y, "[CANCEL]", get_color_by_name("vivid_red").rgb, 5);
      row_hits.push({ y: button_y, hit: { kind: "button", action: "create" } });

      const status_start_y = button_y - 1;
      for (let i = 0; i < status_lines.length && status_start_y - i > rect.y0; i += 1) {
        draw_line(c, rect.x0 + 1, status_start_y - i, trim_to_width(status_lines[i] ?? "", inner_width), get_color_by_name("medium_gray").rgb, 3);
      }
    },
    on_pointer_down_content(e: PointerEvent, rect: Rect): void {
      const entry = row_hits.find((row) => row.y === e.y);
      const hit = entry?.hit ?? null;
      if (!hit) return;
      if (hit.kind === "field") {
        active_field_key = hit.key;
        opts.on_select_field?.(hit.key);
        return;
      }
      const relative_x = e.x - rect.x0;
      const action = relative_x >= 22 ? "close" : relative_x >= 12 ? "reset" : "create";
      void trigger_button(action);
    },
    on_key_down(e: KeyboardEvent): void {
      const fields = opts.get_fields().filter((field) => field.editable !== false);
      if (e.key === "Escape") {
        active_field_key = null;
        opts.on_close();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void opts.on_create();
        return;
      }
      if (e.key === "Tab" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (fields.length < 1) return;
        const current_index = Math.max(0, fields.findIndex((field) => field.key === active_field_key));
        const delta = e.key === "ArrowUp" ? -1 : 1;
        const next_index = (current_index + delta + fields.length) % fields.length;
        active_field_key = fields[next_index]?.key ?? fields[0]?.key ?? null;
        if (active_field_key) opts.on_select_field?.(active_field_key);
        return;
      }
      if (e.key === "Enter" && active_field_key) {
        e.preventDefault();
        opts.on_select_field?.(active_field_key);
        return;
      }
      if (e.key === "Backspace" && active_field_key) {
        e.preventDefault();
        const current = opts.get_fields().find((field) => field.key === active_field_key);
        if (!current || current.editable === false) return;
        opts.on_update_field(active_field_key, current.value.slice(0, -1));
      }
    },
    on_text_input(text: string): void {
      if (!active_field_key || !text) return;
      const current = opts.get_fields().find((field) => field.key === active_field_key);
      if (!current || current.editable === false) return;
      opts.on_update_field(active_field_key, `${current.value}${text}`);
    },
  });
}
