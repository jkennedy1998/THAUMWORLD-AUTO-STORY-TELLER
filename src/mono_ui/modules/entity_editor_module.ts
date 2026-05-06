import type { Canvas, Module, PointerEvent, Rect } from "../types.js";
import { make_floating_panel_module } from "./floating_panel_module.js";
import { get_color_by_name } from "../colors.js";
import { tag_key } from "../../tag_system/tag_key.js";
import type { TagInstance } from "../../tag_system/registry.js";
import { get_ui_semantic_rgb } from "../runtime/ui_customization_store.js";

export type EntityEditorField = {
  key: string;
  label: string;
  value: string;
  editable?: boolean;
};

export type EntityEditorModuleConfig = {
  id: string;
  rect: Rect;
  get_is_visible: () => boolean;
  get_title: () => string;
  get_subtitle?: () => string;
  get_fields: () => EntityEditorField[];
  get_tags?: () => TagInstance[];
  get_selected_tag_key?: () => string | null;
  get_status_lines?: () => string[];
  on_update_field: (key: string, value: string) => void;
  on_select_field?: (key: string) => void;
  on_select_tag?: (tag: TagInstance) => void;
  on_add_tag?: () => void;
  on_save: () => Promise<void>;
  on_reload: () => Promise<void>;
  on_close: () => void;
  on_move?: (rect: Rect) => void;
};

type RowHit =
  | { kind: "field"; key: string }
  | { kind: "tag"; index: number }
  | { kind: "add_tag" }
  | { kind: "button"; action: "save" | "reload" | "close" };

export function make_entity_editor_module(opts: EntityEditorModuleConfig): Module {
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

  function get_row_hit_at(y: number): RowHit | null {
    const entry = row_hits.find((row) => row.y === y);
    return entry?.hit ?? null;
  }

  async function trigger_button(action: "save" | "reload" | "close"): Promise<void> {
    if (action === "save") {
      await opts.on_save();
      return;
    }
    if (action === "reload") {
      await opts.on_reload();
      return;
    }
    opts.on_close();
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: opts.get_title,
    is_visible: opts.get_is_visible,
    background: { rgb: get_ui_semantic_rgb('background') },
    resize: { min_width: 28, min_height: 12, max_width: 56, max_height: 28 },
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
      const tags = opts.get_tags?.() ?? [];
      const selected_tag_key = opts.get_selected_tag_key?.() ?? null;
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
        draw_line(c, rect.x0 + 1, y, line, is_active ? get_ui_semantic_rgb('vivid') : get_ui_semantic_rgb('bright'), is_active ? 3 : 2);
        row_hits.push({ y, hit: { kind: "field", key: field.key } });
        y -= 1;
      }

      if (tags.length > 0 || opts.on_add_tag) {
        if (y > rect.y0 + 4) {
          draw_line(c, rect.x0 + 1, y, trim_to_width("tags", inner_width), get_color_by_name("medium_gray").rgb, 3);
          y -= 1;
        }
        for (let i = 0; i < tags.length && y > rect.y0 + 4; i += 1) {
          const tag = tags[i]!;
          const selected = tag_key(tag) === selected_tag_key;
          const prefix = selected ? ">" : " ";
          const line = trim_to_width(`${prefix}${tag.name} ${Math.floor(Number(tag.mag ?? 0) || 0)}`, inner_width);
          draw_line(c, rect.x0 + 1, y, line, selected ? get_ui_semantic_rgb('vivid') : get_ui_semantic_rgb('bright'), selected ? 3 : 2);
          row_hits.push({ y, hit: { kind: "tag", index: i } });
          y -= 1;
        }
        if (opts.on_add_tag && y > rect.y0 + 4) {
          draw_line(c, rect.x0 + 1, y, trim_to_width("+ add tag", inner_width), get_color_by_name("vivid_green").rgb, 5);
          row_hits.push({ y, hit: { kind: "add_tag" } });
          y -= 1;
        }
      }

      const button_y = rect.y0 + 2;
      draw_line(c, rect.x0 + 1, button_y, "[SAVE]", get_color_by_name("vivid_green").rgb, 5);
      draw_line(c, rect.x0 + 10, button_y, "[RELOAD]", get_color_by_name("vivid_blue").rgb, 5);
      draw_line(c, rect.x0 + 21, button_y, "[CLOSE]", get_color_by_name("vivid_red").rgb, 5);
      row_hits.push({ y: button_y, hit: { kind: "button", action: "save" } });

      const status_start_y = button_y - 1;
      for (let i = 0; i < status_lines.length && status_start_y - i > rect.y0; i += 1) {
        draw_line(c, rect.x0 + 1, status_start_y - i, trim_to_width(status_lines[i] ?? "", inner_width), get_color_by_name("medium_gray").rgb, 3);
      }
    },
    on_pointer_down_content(e: PointerEvent, rect: Rect): void {
      const hit = get_row_hit_at(e.y);
      if (!hit) return;
      if (hit.kind === "field") {
        active_field_key = hit.key;
        opts.on_select_field?.(hit.key);
        return;
      }
      if (hit.kind === "tag") {
        const tag = opts.get_tags?.()[hit.index] ?? null;
        if (tag) opts.on_select_tag?.(tag);
        return;
      }
      if (hit.kind === "add_tag") {
        opts.on_add_tag?.();
        return;
      }
      const relative_x = e.x - rect.x0;
      const action = relative_x >= 21 ? "close" : relative_x >= 10 ? "reload" : "save";
      void trigger_button(action);
    },
    wants_text_capture(): boolean {
      if (!active_field_key) return false;
      const current = opts.get_fields().find((field) => field.key === active_field_key);
      return current?.editable !== false;
    },
    on_key_down(e: KeyboardEvent): void {
      const fields = opts.get_fields().filter((field) => field.editable !== false);
      if (e.key === "Escape") {
        active_field_key = null;
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void opts.on_save();
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
