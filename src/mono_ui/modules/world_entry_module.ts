import type { Canvas, Module, PointerEvent, Rect } from "../types.js";
import { make_floating_panel_module } from "./floating_panel_module.js";
import { get_standard_ux_chrome_colors } from "../module_borders.js";
import {
  begin_plain_text_control_frame,
  clear_plain_text_control_interaction,
  create_plain_text_control_state,
  press_plain_text_control,
  release_hovered_plain_text_control,
  update_plain_text_hover,
} from "../ux/plain_text_controls.js";
import { draw_text_command } from "../ux/plain_text_interactables.js";

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
  const text_controls = create_plain_text_control_state();

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
      begin_plain_text_control_frame(text_controls);
      const { accent_rgb, muted_rgb } = get_standard_ux_chrome_colors();
      const status_lines = opts.get_status_lines?.() ?? [];
      draw_text_command(c, {
        id: 'launch',
        label: '[LAUNCH WORLD]',
        x: rect.x0 + 2,
        y: rect.y1 - 3,
        state: text_controls,
        idle_role: 'custom',
        hover_role: 'bright',
        pressed_role: 'vivid',
        custom_idle_rgb: accent_rgb,
        base_weight_index: 4,
        pressed_weight_index: 5,
        render_index: 6,
      });
      draw_text_command(c, {
        id: 'join',
        label: '[JOIN WORLD]',
        x: rect.x0 + 2,
        y: rect.y1 - 5,
        state: text_controls,
        idle_role: 'custom',
        hover_role: 'bright',
        pressed_role: 'vivid',
        custom_idle_rgb: accent_rgb,
        base_weight_index: 3,
        pressed_weight_index: 4,
        render_index: 6,
      });
      for (let i = 0; i < status_lines.length && rect.y0 + 2 + i < rect.y1 - 6; i += 1) {
        draw_line(c, rect.x0 + 2, rect.y0 + 2 + i, status_lines[i] ?? "", muted_rgb, 3);
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      press_plain_text_control(text_controls, e.x, e.y);
    },
    on_pointer_move_content(e: PointerEvent): void {
      update_plain_text_hover(text_controls, e.x, e.y);
    },
    on_pointer_up_content(): void {
      const hit = release_hovered_plain_text_control(text_controls);
      if (hit === 'launch') opts.on_launch_world();
      else if (hit === 'join') opts.on_join_world();
    },
    on_pointer_leave_content(): void {
      clear_plain_text_control_interaction(text_controls);
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
