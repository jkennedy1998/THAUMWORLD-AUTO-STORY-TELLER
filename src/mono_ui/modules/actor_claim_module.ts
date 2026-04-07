import type { Canvas, Module, PointerEvent, Rect } from "../types.js";
import { make_floating_panel_module } from "./floating_panel_module.js";
import { get_color_by_name } from "../colors.js";

export type ActorClaimEntry = {
  actor_ref: string;
  actor_id: string;
  actor_name: string;
  claimed_by_self: boolean;
  claimed_by_other: boolean;
  claimed_by_client_session_id: string | null;
  can_claim: boolean;
};

export type ActorClaimModuleConfig = {
  id: string;
  rect: Rect;
  get_is_visible: () => boolean;
  get_is_blocking: () => boolean;
  get_title: () => string;
  get_guest_label?: () => string | null;
  get_entries: () => ActorClaimEntry[];
  get_selected_actor_ref: () => string | null;
  get_current_actor_ref: () => string | null;
  get_status_lines?: () => string[];
  get_is_loading?: () => boolean;
  get_is_submitting?: () => boolean;
  on_select: (actor_ref: string) => void;
  on_claim_selected: () => void;
  on_create_actor: () => void;
  on_release_current: () => void;
  on_refresh: () => void;
  on_close: () => void;
  on_move?: (rect: Rect) => void;
};

type ButtonHit = "claim" | "create" | "release" | "refresh" | "close";

export function make_actor_claim_module(opts: ActorClaimModuleConfig): Module {
  let cursor = 0;
  let visible_start = 0;
  let row_hits: Array<{ y: number; actor_ref: string }> = [];
  let button_hits: Array<{ x0: number; x1: number; y: number; action: ButtonHit }> = [];

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

  function get_entries(): ActorClaimEntry[] {
    return opts.get_entries();
  }

  function sync_cursor(): void {
    const entries = get_entries();
    if (entries.length < 1) {
      cursor = 0;
      visible_start = 0;
      return;
    }
    const selected_ref = opts.get_selected_actor_ref();
    const selected_index = selected_ref ? entries.findIndex((entry) => entry.actor_ref === selected_ref) : -1;
    if (selected_index >= 0) cursor = selected_index;
    cursor = Math.max(0, Math.min(entries.length - 1, cursor));
  }

  function get_selected_entry(): ActorClaimEntry | null {
    const entries = get_entries();
    return entries[cursor] ?? null;
  }

  function trigger_button(action: ButtonHit): void {
    if (action === "claim") {
      opts.on_claim_selected();
      return;
    }
    if (action === "release") {
      opts.on_release_current();
      return;
    }
    if (action === "create") {
      opts.on_create_actor();
      return;
    }
    if (action === "refresh") {
      opts.on_refresh();
      return;
    }
    if (!opts.get_is_blocking()) {
      opts.on_close();
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
    resize: { min_width: 32, min_height: 12, max_width: 54, max_height: 30 },
    gizmos: {
      enabled: ["move", "close", "seamless"],
      can_close: true,
      can_move: true,
      can_save_position: false,
      on_close: () => { if (!opts.get_is_blocking()) opts.on_close(); },
      on_move: opts.on_move,
      on_move_end: opts.on_move,
    },
    draw_content(c: Canvas, rect: Rect): void {
      sync_cursor();
      row_hits = [];
      button_hits = [];
      const entries = get_entries();
      const current_ref = opts.get_current_actor_ref();
      const selected = get_selected_entry();
      const status_lines = opts.get_status_lines?.() ?? [];
      const guest_label = opts.get_guest_label?.() ?? null;
      const inner_width = Math.max(1, rect.x1 - rect.x0 - 2);
      const list_top_y = rect.y1 - 4;
      const footer_y = rect.y0 + 2;
      const button_y = rect.y0 + 4;
      const list_bottom_y = button_y + 1;
      const list_height = Math.max(1, list_top_y - list_bottom_y + 1);

      if (cursor < visible_start) visible_start = cursor;
      if (cursor >= visible_start + list_height) visible_start = cursor - list_height + 1;
      visible_start = Math.max(0, Math.min(visible_start, Math.max(0, entries.length - list_height)));

      const loading = opts.get_is_loading?.() === true;
      const submitting = opts.get_is_submitting?.() === true;
      const current_summary = current_ref ? `Current: ${current_ref}` : "Current: none";
      draw_line(c, rect.x0 + 1, rect.y1 - 2, trim_to_width(current_summary, inner_width), current_ref ? get_color_by_name("vivid_green").rgb : get_color_by_name("pale_orange").rgb, 4);
      if (guest_label) {
        draw_line(c, rect.x0 + 1, rect.y1 - 3, trim_to_width(guest_label, inner_width), get_color_by_name("medium_gray").rgb, 3);
      }

      for (let row = 0; row < list_height; row += 1) {
        const entry = entries[visible_start + row];
        const y = list_top_y - row;
        if (y <= list_bottom_y - 1) break;
        if (!entry) continue;
        const is_cursor = visible_start + row === cursor;
        const state = entry.claimed_by_self ? "YOU" : entry.claimed_by_other ? "LOCK" : "OPEN";
        const prefix = is_cursor ? ">" : " ";
        const line = trim_to_width(`${prefix}${entry.actor_name} [${state}]`, inner_width);
        const rgb = entry.claimed_by_self
          ? get_color_by_name("vivid_green").rgb
          : entry.claimed_by_other
            ? get_color_by_name("medium_gray").rgb
            : is_cursor
              ? get_color_by_name("vivid_yellow").rgb
              : get_color_by_name("off_white").rgb;
        draw_line(c, rect.x0 + 1, y, line, rgb, is_cursor ? 6 : 4);
        row_hits.push({ y, actor_ref: entry.actor_ref });
      }

      const button_specs: Array<{ action: ButtonHit; label: string; enabled: boolean }> = [
        { action: "claim", label: submitting ? "[CLAIMING]" : "[CLAIM]", enabled: !!selected?.can_claim && !submitting && !loading },
        { action: "create", label: "[CREATE]", enabled: !submitting && !loading },
        { action: "release", label: submitting ? "[RELEASING]" : "[RELEASE]", enabled: !!current_ref && !submitting && !loading },
        { action: "refresh", label: loading ? "[LOADING]" : "[REFRESH]", enabled: !submitting },
        { action: "close", label: "[CLOSE]", enabled: !opts.get_is_blocking() },
      ];
      let x = rect.x0 + 1;
      for (const button of button_specs) {
        const text = button.enabled ? button.label : button.label.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
        draw_line(c, x, button_y, trim_to_width(text, Math.max(1, rect.x1 - x)), button.enabled ? get_color_by_name("vivid_blue").rgb : get_color_by_name("dark_gray").rgb, 4);
        button_hits.push({ x0: x, x1: x + text.length - 1, y: button_y, action: button.action });
        x += text.length + 1;
      }

      const footer = selected
        ? selected.claimed_by_other
          ? `${selected.actor_ref} - claimed elsewhere`
          : selected.claimed_by_self
            ? `${selected.actor_ref} - currently yours`
            : `${selected.actor_ref} - available`
        : (entries.length > 0 ? "select an actor" : "no claimable actors");
      draw_line(c, rect.x0 + 1, footer_y, trim_to_width(footer, inner_width), get_color_by_name("medium_gray").rgb, 3);
      for (let i = 0; i < status_lines.length && footer_y - 1 - i > rect.y0; i += 1) {
        draw_line(c, rect.x0 + 1, footer_y - 1 - i, trim_to_width(status_lines[i] ?? "", inner_width), get_color_by_name("medium_gray").rgb, 3);
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const button = button_hits.find((hit) => hit.y === e.y && e.x >= hit.x0 && e.x <= hit.x1);
      if (button) {
        trigger_button(button.action);
        return;
      }
      const row = row_hits.find((hit) => hit.y === e.y);
      if (!row) return;
      opts.on_select(row.actor_ref);
    },
    on_key_down(e: KeyboardEvent): void {
      sync_cursor();
      const entries = get_entries();
      if (e.key === "Escape") {
        if (!opts.get_is_blocking()) opts.on_close();
        return;
      }
      if (entries.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          cursor = Math.min(entries.length - 1, cursor + 1);
          const next = get_selected_entry();
          if (next) opts.on_select(next.actor_ref);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          cursor = Math.max(0, cursor - 1);
          const next = get_selected_entry();
          if (next) opts.on_select(next.actor_ref);
          return;
        }
      }
      if (e.key === "Enter") {
        e.preventDefault();
        opts.on_claim_selected();
        return;
      }
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        opts.on_release_current();
        return;
      }
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        opts.on_refresh();
      }
    },
  });
}
