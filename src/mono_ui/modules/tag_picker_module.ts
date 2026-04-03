import type { Canvas, DragEvent, Module, PointerEvent, Rect } from "../types.js";
import { make_floating_panel_module } from "./floating_panel_module.js";
import { get_color_by_name } from "../colors.js";

export type TagPickerDimensionDefinition = {
  id: string;
  label: string;
  default_mag: number;
  min_mag: number | null;
  max_mag: number | null;
  description?: string | null;
  value_up_per_mag?: number;
  value_down_per_mag?: number;
};

export type TagPickerDefinition = {
  name: string;
  base_tag_value_mag: number;
  quantity_dimension_id: string | null;
  dimensions: TagPickerDimensionDefinition[];
};

export type TagPickerField = "name" | "mag" | "meta" | `dim:${string}`;

export type TagPickerDraft = {
  key?: string;
  name: string;
  mag: number;
  dim_mag?: Record<string, number>;
  meta: string[];
  info?: unknown[];
  source?: string;
  expiry?: number;
  scope?: Array<"CHARACTER" | "ITEM" | "TILE" | "TAG">;
};

export type TagPickerModuleConfig = {
  id: string;
  rect: Rect;
  get_is_visible: () => boolean;
  get_title: () => string;
  get_subtitle?: () => string;
  get_tag: () => TagPickerDraft | null;
  get_definition: () => TagPickerDefinition | null;
  get_selected_field: () => TagPickerField;
  get_status_lines?: () => string[];
  on_select_field: (field: TagPickerField) => void;
  on_open_name_picker: () => void;
  on_adjust_mag: (delta: number) => void;
  on_adjust_dimension: (dimension_id: string, delta: number) => void;
  on_update_meta_text: (value: string) => void;
  on_commit_meta: () => void;
  on_remove_tag: () => void;
  on_drag_apply: (x: number, y: number) => void;
  on_close: () => void;
  on_move?: (rect: Rect) => void;
};

type RowHit =
  | { kind: "field"; field: TagPickerField }
  | { kind: "mag_button"; target: "mag"; delta: -1 | 1 }
  | { kind: "dimension_button"; dimension_id: string; delta: -1 | 1 }
  | { kind: "button"; action: "remove" | "close" | "pick" };

export function make_tag_picker_module(opts: TagPickerModuleConfig): Module {
  let row_hits: Array<{ y: number; x0: number; x1: number; hit: RowHit }> = [];
  let drag_enabled = false;

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

  function register_hit(y: number, x0: number, x1: number, hit: RowHit): void {
    row_hits.push({ y, x0, x1, hit });
  }

  function get_hit(x: number, y: number): RowHit | null {
    const entry = row_hits.find((row) => row.y === y && x >= row.x0 && x <= row.x1);
    return entry?.hit ?? null;
  }

  function get_field_order(definition: TagPickerDefinition | null): TagPickerField[] {
    const dims = (definition?.dimensions ?? []).map((dimension) => `dim:${dimension.id}` as TagPickerField);
    return ["name", ...dims, "meta"];
  }

  function adjust_selected_numeric(delta: number): void {
    const selected = opts.get_selected_field();
    if (selected === "mag") {
      opts.on_adjust_mag(delta);
      return;
    }
    if (selected.startsWith("dim:")) {
      opts.on_adjust_dimension(selected.slice(4), delta);
    }
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: opts.get_title,
    is_visible: opts.get_is_visible,
    background: { rgb: get_color_by_name("off_black").rgb },
    border: {
      border_rgb: get_color_by_name("vivid_cyan").rgb,
      text_rgb: get_color_by_name("vivid_cyan").rgb,
    },
    resize: { min_width: 30, min_height: 12, max_width: 60, max_height: 32 },
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
      const tag = opts.get_tag();
      const definition = opts.get_definition();
      const status_lines = opts.get_status_lines?.() ?? [];
      const selected_field = opts.get_selected_field();
      const inner_width = Math.max(1, rect.x1 - rect.x0 - 2);
      const value_col_x = rect.x0 + 1;
      const status_reserved_rows = Math.min(2, Math.max(0, status_lines.length));
      const button_y = rect.y0 + 2;
      const status_start_y = button_y + 2;
      const content_bottom_y = status_start_y + status_reserved_rows + 1;
      let y = rect.y1 - 2;

      const subtitle = opts.get_subtitle?.() ?? "";
      if (subtitle) {
        draw_line(c, rect.x0 + 1, y, trim_to_width(subtitle, inner_width), get_color_by_name("light_gray").rgb, 3);
        y -= 1;
      }

      if (!tag) {
        draw_line(c, rect.x0 + 1, y, trim_to_width("select a tag on a character", inner_width), get_color_by_name("medium_gray").rgb, 3);
      } else {
        const nameLine = `${selected_field === "name" ? ">" : " "}name: ${tag.name || "(pick tag)"}`;
        draw_line(c, value_col_x, y, trim_to_width(nameLine, inner_width - 7), selected_field === "name" ? get_color_by_name("vivid_yellow").rgb : get_color_by_name("off_white").rgb, selected_field === "name" ? 6 : 4);
        draw_line(c, rect.x1 - 6, y, "[PICK]", get_color_by_name("vivid_blue").rgb, 5);
        register_hit(y, value_col_x, rect.x1 - 8, { kind: "field", field: "name" });
        register_hit(y, rect.x1 - 6, rect.x1 - 1, { kind: "button", action: "pick" });
        y -= 1;

        const dimensions = definition?.dimensions ?? [];
        if (dimensions.length > 0 && y >= content_bottom_y) {
          draw_line(c, value_col_x, y, trim_to_width("dims", inner_width), get_color_by_name("medium_gray").rgb, 3);
          y -= 1;
        }
        for (const dimension of dimensions) {
          if (y < content_bottom_y) break;
          const field = `dim:${dimension.id}` as TagPickerField;
          const dimValue = Math.floor(Number(tag.dim_mag?.[dimension.id] ?? dimension.default_mag) || 0);
          const prefix = selected_field === field ? ">" : " ";
          const line = `${prefix}${dimension.label}: ${dimValue}`;
          draw_line(c, value_col_x, y, trim_to_width(line, inner_width - 10), selected_field === field ? get_color_by_name("vivid_yellow").rgb : get_color_by_name("off_white").rgb, selected_field === field ? 6 : 4);
          draw_line(c, rect.x1 - 10, y, "[-]", get_color_by_name("vivid_red").rgb, 5);
          draw_line(c, rect.x1 - 5, y, "[+]", get_color_by_name("vivid_green").rgb, 5);
          register_hit(y, value_col_x, rect.x1 - 12, { kind: "field", field });
          register_hit(y, rect.x1 - 10, rect.x1 - 8, { kind: "dimension_button", dimension_id: dimension.id, delta: -1 });
          register_hit(y, rect.x1 - 5, rect.x1 - 3, { kind: "dimension_button", dimension_id: dimension.id, delta: 1 });
          y -= 1;
        }

        if (y >= content_bottom_y) {
          const metaText = tag.meta.join(",");
          const metaLine = `${selected_field === "meta" ? ">" : " "}meta: ${metaText || "-"}`;
          draw_line(c, value_col_x, y, trim_to_width(metaLine, inner_width), selected_field === "meta" ? get_color_by_name("vivid_yellow").rgb : get_color_by_name("off_white").rgb, selected_field === "meta" ? 6 : 4);
          register_hit(y, value_col_x, rect.x1 - 1, { kind: "field", field: "meta" });
          y -= 1;
        }

        if (y >= content_bottom_y) {
          draw_line(c, value_col_x, y, trim_to_width("drag from here onto a tag row", inner_width), get_color_by_name("medium_gray").rgb, 3);
        }
      }

      draw_line(c, rect.x0 + 1, button_y, "[REMOVE]", get_color_by_name("vivid_red").rgb, 5);
      draw_line(c, rect.x0 + 12, button_y, "[CLOSE]", get_color_by_name("light_gray").rgb, 4);
      register_hit(button_y, rect.x0 + 1, rect.x0 + 8, { kind: "button", action: "remove" });
      register_hit(button_y, rect.x0 + 12, rect.x0 + 18, { kind: "button", action: "close" });

      for (let i = 0; i < status_reserved_rows; i += 1) {
        const line_y = status_start_y + i;
        draw_line(c, rect.x0 + 1, line_y, trim_to_width(status_lines[i] ?? "", inner_width), get_color_by_name("medium_gray").rgb, 3);
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const hit = get_hit(e.x, e.y);
      drag_enabled = !!opts.get_tag() && !hit;
      if (!hit) return;
      if (hit.kind === "field") {
        opts.on_select_field(hit.field);
        if (hit.field === "name") opts.on_open_name_picker();
        return;
      }
        if (hit.kind === "mag_button") {
        opts.on_select_field(hit.target);
        opts.on_adjust_mag(hit.delta);
        return;
      }
      if (hit.kind === "dimension_button") {
        opts.on_select_field(`dim:${hit.dimension_id}`);
        opts.on_adjust_dimension(hit.dimension_id, hit.delta);
        return;
      }
      if (hit.action === "remove") {
        opts.on_remove_tag();
        return;
      }
      if (hit.action === "pick") {
        opts.on_select_field("name");
        opts.on_open_name_picker();
        return;
      }
      opts.on_close();
    },
    on_drag_start_content(): void {
      drag_enabled = !!opts.get_tag() && drag_enabled;
    },
    on_drag_end_content(e: DragEvent): void {
      if (!drag_enabled || !opts.get_tag()) return;
      drag_enabled = false;
      opts.on_drag_apply(e.x, e.y);
    },
    on_key_down(e: KeyboardEvent): void {
      const tag = opts.get_tag();
      const definition = opts.get_definition();
      if (!tag) return;
      if (e.key === "Escape") {
        opts.on_close();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const order = get_field_order(definition);
        const current = order.indexOf(opts.get_selected_field());
        opts.on_select_field(order[(current + order.length - 1) % order.length] ?? "name");
        return;
      }
      if (e.key === "ArrowDown" || e.key === "Tab") {
        e.preventDefault();
        const order = get_field_order(definition);
        const current = order.indexOf(opts.get_selected_field());
        opts.on_select_field(order[(current + 1) % order.length] ?? "name");
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        adjust_selected_numeric(-1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        adjust_selected_numeric(1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (opts.get_selected_field() === "name") {
          opts.on_open_name_picker();
          return;
        }
        if (opts.get_selected_field() === "meta") {
          opts.on_commit_meta();
        }
      }
      if (e.key === "Backspace" && opts.get_selected_field() === "meta") {
        e.preventDefault();
        opts.on_update_meta_text(tag.meta.join(",").slice(0, -1));
      }
    },
    on_text_input(text: string): void {
      const tag = opts.get_tag();
      if (!tag || opts.get_selected_field() !== "meta" || !text) return;
      opts.on_update_meta_text(`${tag.meta.join(",")}${text}`);
    },
  });
}
