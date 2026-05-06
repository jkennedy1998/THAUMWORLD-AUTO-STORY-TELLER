import type { Canvas, Module, PointerEvent, Rect } from "../types.js";
import { make_floating_panel_module } from "./floating_panel_module.js";
import { get_standard_ux_chrome_colors } from "../module_borders.js";

export type WorldEntryModuleConfig = {
  id: string;
  rect: Rect;
  get_is_visible: () => boolean;
  get_status_lines?: () => string[];
  on_launch_world: () => void;
  on_join_world: () => void;
  on_move?: (rect: Rect) => void;
};

export function make_world_entry_module(opts: WorldEntryModuleConfig): Module {
  type Button = "launch" | "join";
  let button_hits: Array<{ x0: number; x1: number; y: number; action: Button }> = [];

  function draw_line(c: Canvas, x: number, y: number, text: string, rgb = get_standard_ux_chrome_colors().text_rgb, weight_index = 2): void {
    for (let i = 0; i < text.length; i += 1) {
      c.set(x + i, y, { char: text[i]!, rgb, weight_index, render_index: 6, style: "regular" });
    }
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: "WORLD MENU",
    is_visible: opts.get_is_visible,
    
    resize: { min_width: 26, min_height: 10, max_width: 46, max_height: 24 },
    gizmos: {
      enabled: ["move", "seamless"],
      can_close: false,
      can_move: true,
      can_save_position: false,
      on_move: opts.on_move,
      on_move_end: opts.on_move,
    },
    draw_content(c: Canvas, rect: Rect): void {
      button_hits = [];
      const { accent_rgb, muted_rgb } = get_standard_ux_chrome_colors();
      const status_lines = opts.get_status_lines?.() ?? [];
      const launch = "[LAUNCH WORLD]";
      const join = "[JOIN WORLD]";
      draw_line(c, rect.x0 + 2, rect.y1 - 3, launch, accent_rgb, 5);
      draw_line(c, rect.x0 + 2, rect.y1 - 5, join, accent_rgb, 4);
      button_hits.push({ x0: rect.x0 + 2, x1: rect.x0 + 2 + launch.length - 1, y: rect.y1 - 3, action: "launch" });
      button_hits.push({ x0: rect.x0 + 2, x1: rect.x0 + 2 + join.length - 1, y: rect.y1 - 5, action: "join" });
      for (let i = 0; i < status_lines.length && rect.y0 + 2 + i < rect.y1 - 6; i += 1) {
        draw_line(c, rect.x0 + 2, rect.y0 + 2 + i, status_lines[i] ?? "", muted_rgb, 3);
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const hit = button_hits.find((entry) => entry.y === e.y && e.x >= entry.x0 && e.x <= entry.x1);
      if (!hit) return;
      if (hit.action === "launch") opts.on_launch_world();
      else opts.on_join_world();
    },
    on_key_down(e: KeyboardEvent): void {
      if (e.key === "Enter") {
        e.preventDefault();
        opts.on_launch_world();
        return;
      }
      if (e.key.toLowerCase() === "j") {
        e.preventDefault();
        opts.on_join_world();
      }
    },
  });
}
