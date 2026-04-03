import type { Canvas, Module, PointerEvent, Rect } from "../types.js";
import { make_floating_panel_module } from "./floating_panel_module.js";
import { get_color_by_name } from "../colors.js";

export type JoinableWorldEntry = {
  id: string;
  label: string;
  description?: string;
  local?: boolean;
};

export type WorldJoinModuleConfig = {
  id: string;
  rect: Rect;
  get_is_visible: () => boolean;
  get_entries: () => JoinableWorldEntry[];
  get_selected_world_id: () => string | null;
  get_status_lines?: () => string[];
  on_select_world: (world_id: string) => void;
  on_join_selected: () => void;
  on_back: () => void;
  on_refresh: () => void;
  on_move?: (rect: Rect) => void;
};

export function make_world_join_module(opts: WorldJoinModuleConfig): Module {
  let row_hits: Array<{ y: number; world_id: string }> = [];
  let button_hits: Array<{ x0: number; x1: number; y: number; action: "join" | "refresh" | "back" }> = [];

  function draw_line(c: Canvas, x: number, y: number, text: string, rgb = get_color_by_name("off_white").rgb, weight_index = 4): void {
    for (let i = 0; i < text.length; i += 1) {
      c.set(x + i, y, { char: text[i]!, rgb, weight_index, render_index: 6, style: "regular" });
    }
  }

  function trim(text: string, width: number): string {
    if (text.length <= width) return text;
    return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}~`;
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: "JOIN WORLD",
    is_visible: opts.get_is_visible,
    background: { rgb: get_color_by_name("off_black").rgb },
    border: {
      border_rgb: get_color_by_name("vivid_cyan").rgb,
      text_rgb: get_color_by_name("vivid_cyan").rgb,
    },
    resize: { min_width: 32, min_height: 12, max_width: 54, max_height: 30 },
    gizmos: {
      enabled: ["move", "seamless"],
      can_close: false,
      can_move: true,
      can_save_position: false,
      on_move: opts.on_move,
      on_move_end: opts.on_move,
    },
    draw_content(c: Canvas, rect: Rect): void {
      row_hits = [];
      button_hits = [];
      const entries = opts.get_entries();
      const selected = opts.get_selected_world_id();
      const innerWidth = Math.max(1, rect.x1 - rect.x0 - 2);
      let y = rect.y1 - 3;
      for (const entry of entries) {
        if (y <= rect.y0 + 4) break;
        const prefix = entry.id === selected ? ">" : " ";
        draw_line(c, rect.x0 + 1, y, trim(`${prefix}${entry.label}`, innerWidth), entry.local ? get_color_by_name("vivid_green").rgb : get_color_by_name("off_white").rgb, entry.id === selected ? 6 : 4);
        row_hits.push({ y, world_id: entry.id });
        y -= 1;
      }
      const buttonY = rect.y0 + 2;
      const join = "[JOIN]";
      const refresh = "[REFRESH]";
      const back = "[BACK]";
      draw_line(c, rect.x0 + 1, buttonY, join, get_color_by_name("vivid_green").rgb, 5);
      draw_line(c, rect.x0 + 10, buttonY, refresh, get_color_by_name("vivid_blue").rgb, 5);
      draw_line(c, rect.x0 + 22, buttonY, back, get_color_by_name("vivid_red").rgb, 5);
      button_hits.push({ x0: rect.x0 + 1, x1: rect.x0 + 1 + join.length - 1, y: buttonY, action: "join" });
      button_hits.push({ x0: rect.x0 + 10, x1: rect.x0 + 10 + refresh.length - 1, y: buttonY, action: "refresh" });
      button_hits.push({ x0: rect.x0 + 22, x1: rect.x0 + 22 + back.length - 1, y: buttonY, action: "back" });
      const status = opts.get_status_lines?.() ?? [];
      const selectedEntry = entries.find((entry) => entry.id === selected) ?? null;
      if (selectedEntry?.description) {
        draw_line(c, rect.x0 + 1, rect.y0 + 3, trim(selectedEntry.description, innerWidth), get_color_by_name("light_gray").rgb, 3);
      }
      for (let i = 0; i < status.length && rect.y0 + 4 + i < rect.y1 - 5; i += 1) {
        draw_line(c, rect.x0 + 1, rect.y0 + 4 + i, trim(status[i] ?? "", innerWidth), get_color_by_name("medium_gray").rgb, 3);
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const button = button_hits.find((entry) => entry.y === e.y && e.x >= entry.x0 && e.x <= entry.x1);
      if (button) {
        if (button.action === "join") opts.on_join_selected();
        else if (button.action === "refresh") opts.on_refresh();
        else opts.on_back();
        return;
      }
      const row = row_hits.find((entry) => entry.y === e.y);
      if (row) opts.on_select_world(row.world_id);
    },
    on_key_down(e: KeyboardEvent): void {
      if (e.key === "Enter") {
        e.preventDefault();
        opts.on_join_selected();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        opts.on_back();
        return;
      }
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        opts.on_refresh();
      }
    },
  });
}
