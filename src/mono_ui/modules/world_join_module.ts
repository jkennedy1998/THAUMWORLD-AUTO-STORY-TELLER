import type { Canvas, Module, PointerEvent, Rect } from "../types.js";
import { make_floating_panel_module } from "./floating_panel_module.js";
import { get_color_by_name } from "../colors.js";
import { get_standard_ux_chrome_colors } from "../module_borders.js";

export type JoinableWorldEntry = {
  id: string;
  label: string;
  description?: string;
  local?: boolean;
  online?: boolean;
  source_kind?: 'local' | 'saved_remote';
  host_address?: string;
  saved_host_id?: string;
  last_connected_at?: string;
  last_seen_online_at?: string;
};

export type WorldJoinEditorState = {
  mode: 'hidden' | 'add' | 'rename';
  host: string;
  label: string;
  active_field: 'host' | 'label';
  error?: string | null;
};

export type WorldJoinModuleConfig = {
  id: string;
  rect: Rect;
  get_is_visible: () => boolean;
  get_entries: () => JoinableWorldEntry[];
  get_selected_world_id: () => string | null;
  get_editor_state: () => WorldJoinEditorState;
  get_status_lines?: () => string[];
  on_select_world: (world_id: string) => void;
  on_join_selected: () => void;
  on_begin_add: () => void;
  on_begin_rename_selected: () => void;
  on_forget_selected: () => void;
  on_set_editor_field: (field: 'host' | 'label') => void;
  on_cycle_editor_field: () => void;
  on_submit_editor: () => void;
  on_cancel_editor: () => void;
  on_back: () => void;
  on_refresh: () => void;
  on_editor_host_change: (next_value: string) => void;
  on_editor_label_change: (next_value: string) => void;
  on_move?: (rect: Rect) => void;
};

export function make_world_join_module(opts: WorldJoinModuleConfig): Module {
  let row_hits: Array<{ y: number; world_id: string }> = [];
  let button_hits: Array<{ x0: number; x1: number; y: number; action: 'join' | 'refresh' | 'add' | 'edit' | 'forget' | 'back' | 'save' | 'cancel' | 'field_host' | 'field_label' }> = [];

  function trim_end(text: string, width: number): string {
    if (text.length <= width) return text;
    return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}~`;
  }

  function draw_line(c: Canvas, x: number, y: number, text: string, rgb = get_standard_ux_chrome_colors().text_rgb, weight_index = 2): void {
    for (let i = 0; i < text.length; i += 1) {
      c.set(x + i, y, { char: text[i]!, rgb, weight_index, render_index: 6, style: "regular" });
    }
  }

  function trim(text: string, width: number): string {
    if (text.length <= width) return text;
    return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}~`;
  }

  function draw_button(c: Canvas, x: number, y: number, label: string, rgb: { r: number; g: number; b: number }, action: 'join' | 'refresh' | 'add' | 'edit' | 'forget' | 'back' | 'save' | 'cancel' | 'field_host' | 'field_label'): number {
    draw_line(c, x, y, label, rgb, 5);
    button_hits.push({ x0: x, x1: x + label.length - 1, y, action });
    return x + label.length + 1;
  }

  function commit_editor_change(action: 'host' | 'label', key: KeyboardEvent): void {
    const editor = opts.get_editor_state();
    const current = action === 'host' ? editor.host : editor.label;
    let next = current;
    if (key.key === 'Backspace') {
      next = current.slice(0, Math.max(0, current.length - 1));
      key.preventDefault();
    } else if (key.key === 'Delete') {
      next = '';
      key.preventDefault();
    } else {
      return;
    }
    if (action === 'host') opts.on_editor_host_change(next);
    else opts.on_editor_label_change(next);
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: "JOIN WORLD",
    is_visible: opts.get_is_visible,
    
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
      const { accent_rgb, muted_rgb, text_rgb } = get_standard_ux_chrome_colors();
      const entries = opts.get_entries();
      const selected = opts.get_selected_world_id();
      const editor = opts.get_editor_state();
      const innerWidth = Math.max(1, rect.x1 - rect.x0 - 2);
      let y = rect.y1 - 3;
      const list_floor_y = editor.mode === 'hidden' ? rect.y0 + 4 : rect.y0 + 8;
      for (const entry of entries) {
        if (y <= list_floor_y) break;
        const prefix = entry.id === selected ? ">" : " ";
        const online = entry.online !== false;
        const sourceGlyph = entry.local ? 'L' : 'W';
        const onlineGlyph = online ? '+' : '-';
        const addressSuffix = !entry.local && entry.host_address ? ` @ ${entry.host_address}` : '';
        const line = trim(`${prefix}[${sourceGlyph}${onlineGlyph}] ${entry.label}${addressSuffix}`, innerWidth);
        const rgb = entry.local
          ? get_color_by_name('vivid_green').rgb
          : online
            ? accent_rgb
            : muted_rgb;
        draw_line(c, rect.x0 + 1, y, line, rgb, entry.id === selected ? 3 : 2);
        row_hits.push({ y, world_id: entry.id });
        y -= 1;
      }
      const buttonY = rect.y0 + 2;
      const join = "[JOIN]";
      const refresh = "[REFRESH]";
      const add = '[ADD]';
      const edit = '[RENAME]';
      const forget = '[FORGET]';
      const back = "[BACK]";
      let buttonX = rect.x0 + 1;
      buttonX = draw_button(c, buttonX, buttonY, join, accent_rgb, 'join');
      buttonX = draw_button(c, buttonX, buttonY, refresh, text_rgb, 'refresh');
      buttonX = draw_button(c, buttonX, buttonY, add, text_rgb, 'add');
      buttonX = draw_button(c, buttonX, buttonY, edit, text_rgb, 'edit');
      buttonX = draw_button(c, buttonX, buttonY, forget, get_color_by_name('vivid_red').rgb, 'forget');
      draw_button(c, buttonX, buttonY, back, muted_rgb, 'back');
      const status = opts.get_status_lines?.() ?? [];
      const selectedEntry = entries.find((entry) => entry.id === selected) ?? null;
      if (selectedEntry?.description) {
        draw_line(c, rect.x0 + 1, rect.y0 + 3, trim(selectedEntry.description, innerWidth), get_color_by_name("light_gray").rgb, 3);
      }
      for (let i = 0; i < status.length && rect.y0 + 4 + i < list_floor_y; i += 1) {
        draw_line(c, rect.x0 + 1, rect.y0 + 4 + i, trim(status[i] ?? "", innerWidth), muted_rgb, 3);
      }
      if (editor.mode !== 'hidden') {
        const editorTitle = editor.mode === 'add' ? 'ADD WI-FI HOST' : 'RENAME WI-FI HOST';
        draw_line(c, rect.x0 + 1, rect.y0 + 6, trim_end(editorTitle, innerWidth), accent_rgb, 5);
        const hostPrefix = editor.active_field === 'host' ? '>host: ' : ' host: ';
        const labelPrefix = editor.active_field === 'label' ? '>name: ' : ' name: ';
        const hostValue = trim_end(editor.host || (editor.mode === 'add' ? '192.168.1.50:8787' : ''), Math.max(1, innerWidth - hostPrefix.length));
        const labelValue = trim_end(editor.label || 'My Host', Math.max(1, innerWidth - labelPrefix.length));
        draw_line(c, rect.x0 + 1, rect.y0 + 5, trim_end(`${hostPrefix}${hostValue}`, innerWidth), text_rgb, 2);
        draw_line(c, rect.x0 + 1, rect.y0 + 4, trim_end(`${labelPrefix}${labelValue}`, innerWidth), text_rgb, 2);
        button_hits.push({ x0: rect.x0 + 1, x1: rect.x0 + 1 + trim_end(`${hostPrefix}${hostValue}`, innerWidth).length - 1, y: rect.y0 + 5, action: 'field_host' });
        button_hits.push({ x0: rect.x0 + 1, x1: rect.x0 + 1 + trim_end(`${labelPrefix}${labelValue}`, innerWidth).length - 1, y: rect.y0 + 4, action: 'field_label' });
        const saveLabel = '[SAVE]';
        const cancelLabel = '[CANCEL]';
        draw_button(c, rect.x0 + 1, rect.y0 + 3, saveLabel, get_color_by_name('vivid_green').rgb, 'save');
        draw_button(c, rect.x0 + 10, rect.y0 + 3, cancelLabel, get_color_by_name('vivid_red').rgb, 'cancel');
        const helper = editor.mode === 'add'
          ? 'host or host:port, tab switches field'
          : 'rename saved host, esc cancels';
        draw_line(c, rect.x0 + 1, rect.y0 + 7, trim_end(helper, innerWidth), muted_rgb, 3);
        if (editor.error) {
          draw_line(c, rect.x0 + 1, rect.y0 + 8, trim_end(editor.error, innerWidth), get_color_by_name('vivid_red').rgb, 3);
        }
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const button = button_hits.find((entry) => entry.y === e.y && e.x >= entry.x0 && e.x <= entry.x1);
      if (button) {
        if (button.action === "join") opts.on_join_selected();
        else if (button.action === "refresh") opts.on_refresh();
        else if (button.action === 'add') opts.on_begin_add();
        else if (button.action === 'edit') opts.on_begin_rename_selected();
        else if (button.action === 'forget') opts.on_forget_selected();
        else if (button.action === 'save') opts.on_submit_editor();
        else if (button.action === 'cancel') opts.on_cancel_editor();
        else if (button.action === 'field_host') opts.on_set_editor_field('host');
        else if (button.action === 'field_label') opts.on_set_editor_field('label');
        else opts.on_back();
        return;
      }
      const row = row_hits.find((entry) => entry.y === e.y);
      if (row) opts.on_select_world(row.world_id);
    },
    on_key_down(e: KeyboardEvent): void {
      const editor = opts.get_editor_state();
      if (editor.mode !== 'hidden') {
        if (e.key === 'Escape') {
          e.preventDefault();
          opts.on_cancel_editor();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          opts.on_submit_editor();
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          opts.on_cycle_editor_field();
          return;
        }
        commit_editor_change(editor.active_field, e);
        return;
      }
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
        return;
      }
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        opts.on_begin_add();
        return;
      }
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        opts.on_forget_selected();
        return;
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        opts.on_begin_rename_selected();
      }
    },
    on_text_input(text: string): void {
      const editor = opts.get_editor_state();
      if (editor.mode === 'hidden') return;
      if (editor.active_field === 'host') opts.on_editor_host_change(editor.host + text);
      else opts.on_editor_label_change(editor.label + text);
    },
    wants_text_capture(): boolean {
      return opts.get_editor_state().mode !== 'hidden';
    },
  });
}
