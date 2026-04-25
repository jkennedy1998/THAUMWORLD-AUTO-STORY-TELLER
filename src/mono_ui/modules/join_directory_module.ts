import type { Canvas, Module, PointerEvent, Rect } from '../types.js';
import { make_floating_panel_module } from './floating_panel_module.js';
import { get_color_by_name } from '../colors.js';
import type { JoinMenuEditorState } from '../../engine_launch/join_menu_types.js';
import type { EngineConnectionEntry, EngineConnectionProbeResult } from '../../engine_multiplayer/connection_types.js';

export type JoinDirectoryModuleConfig = {
  id: string;
  rect: Rect;
  title?: string;
  get_is_visible: () => boolean;
  get_connections: () => readonly EngineConnectionEntry[];
  get_probes_by_connection_id: () => Record<string, EngineConnectionProbeResult>;
  get_selected_connection_id: () => string | null;
  get_editor_state: () => JoinMenuEditorState;
  get_status_lines?: () => string[];
  on_select_connection: (connection_id: string) => void;
  on_join_selected: () => void;
  on_begin_add: () => void;
  on_begin_rename_selected: () => void;
  on_begin_edit_host_selected: () => void;
  on_forget_selected: () => void;
  on_set_editor_field: (field: 'name' | 'host') => void;
  on_cycle_editor_field: () => void;
  on_submit_editor: () => void;
  on_cancel_editor: () => void;
  on_back: () => void;
  on_refresh: () => void;
  on_editor_name_change: (next_value: string) => void;
  on_editor_host_change: (next_value: string) => void;
  on_move?: (rect: Rect) => void;
};

type ButtonAction = 'join' | 'refresh' | 'add' | 'rename' | 'edit_host' | 'forget' | 'back' | 'save' | 'cancel' | 'field_name' | 'field_host';

function trim_end(text: string, width: number): string {
  if (text.length <= width) return text;
  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}~`;
}

function draw_line(c: Canvas, x: number, y: number, text: string, rgb = get_color_by_name('off_white').rgb, weight_index = 2): void {
  for (let i = 0; i < text.length; i += 1) {
    c.set(x + i, y, { char: text[i]!, rgb, weight_index, render_index: 6, style: 'regular' });
  }
}

function probe_detail(probe: EngineConnectionProbeResult | undefined): string {
  if (!probe) return 'status unknown';
  if (probe.status === 'online') {
    if (probe.painter_display_name) return `painting ${probe.painter_display_name}`;
    if (probe.world_label) return `world ${probe.world_label}`;
    return probe.status_message || 'online';
  }
  return probe.status_message || probe.status;
}

export function make_join_directory_module(opts: JoinDirectoryModuleConfig): Module {
  let row_hits: Array<{ y0: number; y1: number; connection_id: string }> = [];
  let button_hits: Array<{ x0: number; x1: number; y: number; action: ButtonAction }> = [];

  function draw_button(c: Canvas, x: number, y: number, label: string, rgb: { r: number; g: number; b: number }, action: ButtonAction): number {
    draw_line(c, x, y, label, rgb, 5);
    button_hits.push({ x0: x, x1: x + label.length - 1, y, action });
    return x + label.length + 1;
  }

  function commit_editor_change(field: 'name' | 'host', key: KeyboardEvent): void {
    const editor = opts.get_editor_state();
    const current = field === 'name' ? editor.draft_name : editor.draft_host;
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
    if (field === 'name') opts.on_editor_name_change(next);
    else opts.on_editor_host_change(next);
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: opts.title ?? 'JOIN DIRECTORY',
    is_visible: opts.get_is_visible,
    background: { rgb: get_color_by_name('off_black').rgb },
    border: {
      border_rgb: get_color_by_name('vivid_cyan').rgb,
      text_rgb: get_color_by_name('vivid_cyan').rgb,
    },
    resize: { min_width: 46, min_height: 18, max_width: 84, max_height: 36 },
    gizmos: {
      enabled: ['move', 'seamless'],
      can_close: false,
      can_move: true,
      can_save_position: false,
      on_move: opts.on_move,
      on_move_end: opts.on_move,
    },
    draw_content(c: Canvas, rect: Rect): void {
      row_hits = [];
      button_hits = [];
      const connections = opts.get_connections();
      const probes = opts.get_probes_by_connection_id();
      const selected = opts.get_selected_connection_id();
      const editor = opts.get_editor_state();
      const innerWidth = Math.max(1, rect.x1 - rect.x0 - 2);
      const buttonY = rect.y0 + 2;
      let buttonX = rect.x0 + 1;
      buttonX = draw_button(c, buttonX, buttonY, '[JOIN]', get_color_by_name('vivid_green').rgb, 'join');
      buttonX = draw_button(c, buttonX, buttonY, '[REFRESH]', get_color_by_name('vivid_blue').rgb, 'refresh');
      buttonX = draw_button(c, buttonX, buttonY, '[ADD CONNECTION]', get_color_by_name('vivid_cyan').rgb, 'add');
      buttonX = draw_button(c, buttonX, buttonY, '[RENAME]', get_color_by_name('vivid_yellow').rgb, 'rename');
      buttonX = draw_button(c, buttonX, buttonY, '[EDIT HOST]', get_color_by_name('light_blue').rgb, 'edit_host');
      buttonX = draw_button(c, buttonX, buttonY, '[FORGET]', get_color_by_name('vivid_red').rgb, 'forget');
      draw_button(c, buttonX, buttonY, '[BACK]', get_color_by_name('vivid_red').rgb, 'back');

      const statusLines = opts.get_status_lines?.() ?? [];
      const editorTop = editor.mode === 'hidden' ? rect.y0 + 5 : rect.y0 + 9;
      for (let i = 0; i < statusLines.length && rect.y0 + 4 + i < editorTop; i += 1) {
        draw_line(c, rect.x0 + 1, rect.y0 + 4 + i, trim_end(statusLines[i] ?? '', innerWidth), get_color_by_name('medium_gray').rgb, 3);
      }

      if (editor.mode !== 'hidden') {
        const title = editor.mode === 'add' ? 'ADD CONNECTION' : editor.mode === 'rename' ? 'RENAME CONNECTION' : 'EDIT HOST';
        draw_line(c, rect.x0 + 1, rect.y0 + 8, trim_end(title, innerWidth), get_color_by_name('vivid_yellow').rgb, 5);
        const namePrefix = editor.active_field === 'name' ? '>name: ' : ' name: ';
        const hostPrefix = editor.active_field === 'host' ? '>host: ' : ' host: ';
        const nameLine = trim_end(`${namePrefix}${editor.draft_name || 'New Connection'}`, innerWidth);
        const hostLine = trim_end(`${hostPrefix}${editor.draft_host || (editor.mode === 'add' ? '192.168.1.50:8787' : '')}`, innerWidth);
        draw_line(c, rect.x0 + 1, rect.y0 + 7, nameLine, get_color_by_name('off_white').rgb, 4);
        draw_line(c, rect.x0 + 1, rect.y0 + 6, hostLine, get_color_by_name('off_white').rgb, 4);
        button_hits.push({ x0: rect.x0 + 1, x1: rect.x0 + nameLine.length, y: rect.y0 + 7, action: 'field_name' });
        button_hits.push({ x0: rect.x0 + 1, x1: rect.x0 + hostLine.length, y: rect.y0 + 6, action: 'field_host' });
        draw_button(c, rect.x0 + 1, rect.y0 + 5, '[SAVE]', get_color_by_name('vivid_green').rgb, 'save');
        draw_button(c, rect.x0 + 10, rect.y0 + 5, '[CANCEL]', get_color_by_name('vivid_red').rgb, 'cancel');
        const helper = editor.mode === 'add' ? 'tab switches field, host or host:port' : 'edit and press enter to save';
        draw_line(c, rect.x0 + 1, rect.y0 + 9, trim_end(helper, innerWidth), get_color_by_name('medium_gray').rgb, 3);
        if (editor.error) draw_line(c, rect.x0 + 1, rect.y0 + 10, trim_end(editor.error, innerWidth), get_color_by_name('vivid_red').rgb, 3);
      }

      let rowY = rect.y1 - 3;
      const listFloor = editor.mode === 'hidden' ? rect.y0 + 5 : rect.y0 + 11;
      for (const connection of connections) {
        if (rowY - 1 <= listFloor) break;
        const probe = probes[connection.id];
        const isSelected = connection.id === selected;
        const kindBadge = connection.kind === 'local' ? 'LOCAL' : connection.kind === 'lan_discovered' ? 'LAN' : 'SAVED';
        const statusBadge = probe?.status === 'online' ? 'ONLINE' : probe?.status === 'offline' ? 'OFFLINE' : probe?.status === 'error' ? 'ERROR' : 'CHECK';
        const titleLine = trim_end(`${isSelected ? '>' : ' '} ${connection.name} [${kindBadge}] [${statusBadge}]`, innerWidth);
        const subtitleLine = trim_end(`  ${connection.host} - ${probe_detail(probe)}`, innerWidth);
        const titleRgb = isSelected
          ? get_color_by_name('vivid_yellow').rgb
          : connection.kind === 'local'
            ? get_color_by_name('vivid_green').rgb
            : get_color_by_name('off_white').rgb;
        const subtitleRgb = probe?.status === 'online'
          ? get_color_by_name('light_blue').rgb
          : get_color_by_name('medium_gray').rgb;
        draw_line(c, rect.x0 + 1, rowY, titleLine, titleRgb, isSelected ? 5 : 4);
        draw_line(c, rect.x0 + 1, rowY - 1, subtitleLine, subtitleRgb, 3);
        row_hits.push({ y0: rowY - 1, y1: rowY, connection_id: connection.id });
        rowY -= 3;
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const button = button_hits.find((entry) => entry.y === e.y && e.x >= entry.x0 && e.x <= entry.x1);
      if (button) {
        if (button.action === 'join') opts.on_join_selected();
        else if (button.action === 'refresh') opts.on_refresh();
        else if (button.action === 'add') opts.on_begin_add();
        else if (button.action === 'rename') opts.on_begin_rename_selected();
        else if (button.action === 'edit_host') opts.on_begin_edit_host_selected();
        else if (button.action === 'forget') opts.on_forget_selected();
        else if (button.action === 'save') opts.on_submit_editor();
        else if (button.action === 'cancel') opts.on_cancel_editor();
        else if (button.action === 'field_name') opts.on_set_editor_field('name');
        else if (button.action === 'field_host') opts.on_set_editor_field('host');
        else opts.on_back();
        return;
      }
      const row = row_hits.find((entry) => e.y >= entry.y0 && e.y <= entry.y1);
      if (row) opts.on_select_connection(row.connection_id);
    },
    on_key_down(e: KeyboardEvent): void {
      const editor = opts.get_editor_state();
      const connections = opts.get_connections();
      const selected = opts.get_selected_connection_id();
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
      if (e.key === 'Enter') {
        e.preventDefault();
        opts.on_join_selected();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        opts.on_back();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (connections.length < 1) return;
        const index = Math.max(0, connections.findIndex((entry) => entry.id === selected));
        opts.on_select_connection(connections[(index - 1 + connections.length) % connections.length]!.id);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (connections.length < 1) return;
        const index = Math.max(0, connections.findIndex((entry) => entry.id === selected));
        opts.on_select_connection(connections[(index + 1) % connections.length]!.id);
        return;
      }
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        opts.on_refresh();
        return;
      }
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        opts.on_begin_add();
        return;
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        opts.on_begin_rename_selected();
        return;
      }
      if (e.key.toLowerCase() === 'h') {
        e.preventDefault();
        opts.on_begin_edit_host_selected();
        return;
      }
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        opts.on_forget_selected();
      }
    },
    on_text_input(text: string): void {
      const editor = opts.get_editor_state();
      if (editor.mode === 'hidden') return;
      if (editor.active_field === 'name') opts.on_editor_name_change(editor.draft_name + text);
      else opts.on_editor_host_change(editor.draft_host + text);
    },
    wants_text_capture(): boolean {
      return opts.get_editor_state().mode !== 'hidden';
    },
  });
}
