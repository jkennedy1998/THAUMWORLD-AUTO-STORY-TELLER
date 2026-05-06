import type { Canvas, Module, PointerEvent, Rect } from '../types.js';
import { make_floating_panel_module } from './floating_panel_module.js';
import { get_standard_ux_chrome_colors } from '../module_borders.js';
import {
  begin_plain_text_control_frame,
  clear_plain_text_control_interaction,
  create_plain_text_control_state,
  press_plain_text_control,
  release_hovered_plain_text_control,
  update_plain_text_hover,
} from '../ux/plain_text_controls.js';
import { draw_text_command_row, draw_text_stateful_row } from '../ux/plain_text_interactables.js';
import type { LaunchActionId, LaunchMenuState } from '../../engine_launch/types.js';

type LaunchModuleOptions = {
  id: string;
  rect: Rect;
  title: string;
  get_state: () => LaunchMenuState;
  on_select_action: (action: LaunchActionId) => void;
  on_select_join_entry: (entry_id: string) => void;
  on_confirm_action: (action: LaunchActionId) => void;
};

const ACTIONS: LaunchActionId[] = ['resume', 'new', 'load', 'join'];
const LABELS: Record<LaunchActionId, string> = {
  resume: 'Resume',
  new: 'New',
  load: 'Load',
  join: 'Join',
};

export function make_launch_module(opts: LaunchModuleOptions): Module {
  const { text_rgb: text, muted_rgb: muted, accent_rgb: accent } = get_standard_ux_chrome_colors();
  const good = accent;
  const text_controls = create_plain_text_control_state();

  function trim_text(value: string, width: number): string {
    if (value.length <= width) return value;
    return width <= 1 ? value.slice(0, width) : `${value.slice(0, width - 1)}~`;
  }

  function drawText(c: Canvas, x: number, y: number, value: string, rgb = text, weight_index = 2): void {
    for (let i = 0; i < value.length; i += 1) {
      c.set(x + i, y, { char: value[i]!, rgb, weight_index, render_index: 6, style: 'regular' });
    }
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: opts.title,
    
    resize: { min_width: 28, min_height: 12, max_width: 64, max_height: 28 },
    gizmos: {
      enabled: ['seamless'],
      can_close: false,
      can_move: false,
      can_save_position: false,
    },
    draw_content(c: Canvas, rect: Rect): void {
      begin_plain_text_control_frame(text_controls);
      const state = opts.get_state();
      const actionStartY = rect.y1 - 3;
      const innerWidth = Math.max(1, rect.x1 - rect.x0 - 3);
      drawText(c, rect.x0 + 2, rect.y1 - 1, 'Choose how to begin', muted, 3);
      if (state.resume_candidate) {
        drawText(c, rect.x0 + 2, rect.y1 - 2, trim_text(state.resume_candidate.summary.title, innerWidth), good, 3);
        if (state.resume_candidate.summary.subtitle) {
          drawText(c, rect.x0 + 2, rect.y1 - 3, trim_text(state.resume_candidate.summary.subtitle, innerWidth), muted, 2);
        }
      }
      for (let i = 0; i < ACTIONS.length; i += 1) {
        const action = ACTIONS[i]!;
        const rowY = actionStartY - 2 - i * 2;
        const selected = state.selected_action === action;
        const availability = state.availability[action];
        const enabled = availability.enabled;
        const label = `[${LABELS[action].toUpperCase()}]`;
        draw_text_stateful_row(c, {
          id: `action:${action}`,
          label,
          x: rect.x0 + 2,
          y: rowY,
          row_x0: rect.x0 + 2,
          row_x1: rect.x1 - 2,
          state: text_controls,
          active: selected,
          disabled: !enabled,
          inactive_role: 'custom',
          active_role: 'custom',
          hover_role: 'bright',
          pressed_role: 'vivid',
          disabled_role: 'dimmest',
          custom_inactive_rgb: text,
          custom_active_rgb: accent,
          base_weight_index: 2,
          active_weight_index: 4,
          pressed_weight_index: 5,
          render_index: 6,
        });
        if (!enabled) {
          drawText(c, rect.x0 + 2 + label.length + 2, rowY, trim_text(availability.reason, Math.max(1, innerWidth - label.length - 2)), muted, 2);
        }
      }
      const statusTop = rect.y0 + 2;
      let statusBottomLimit = actionStartY - 10;
      if (state.selected_action === 'join' && state.join_entries.length > 0) {
        const joinTop = statusTop + Math.min(state.status_lines.length, 2) + 1;
        const joinBottomLimit = actionStartY - 1;
        drawText(c, rect.x0 + 2, joinTop, 'Join Targets', accent, 3);
        let joinY = joinTop + 1;
        for (const entry of state.join_entries) {
          if (joinY >= joinBottomLimit) break;
          const selected = state.selected_join_entry_id === entry.id;
          const localMarker = entry.local ? 'L' : 'R';
          const line = trim_text(`[${localMarker}] ${entry.label}`, innerWidth);
          draw_text_stateful_row(c, {
            id: `join:${entry.id}`,
            label: line,
            x: rect.x0 + 2,
            y: joinY,
            row_x0: rect.x0 + 2,
            row_x1: rect.x1 - 2,
            state: text_controls,
            active: selected,
            inactive_role: 'custom',
            active_role: 'custom',
            hover_role: 'bright',
            pressed_role: 'vivid',
            custom_inactive_rgb: text,
            custom_active_rgb: accent,
            base_weight_index: 2,
            active_weight_index: 3,
            pressed_weight_index: 4,
            render_index: 6,
          });
          joinY += 1;
          if (joinY >= joinBottomLimit) break;
          if (entry.description) {
            const description = trim_text(`  ${entry.description}`, innerWidth);
            drawText(c, rect.x0 + 2, joinY, description, muted, 2);
            joinY += 1;
          }
        }
        statusBottomLimit = Math.min(statusBottomLimit, joinTop - 1);
      }
      for (let i = 0; i < state.status_lines.length && statusTop + i < statusBottomLimit; i += 1) {
        drawText(c, rect.x0 + 2, statusTop + i, trim_text(state.status_lines[i] ?? '', innerWidth), muted, 2);
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const hit = press_plain_text_control(text_controls, e.x, e.y);
      if (!hit) return;
      if (hit.startsWith('join:')) {
        opts.on_select_action('join');
        opts.on_select_join_entry(hit.slice('join:'.length));
        return;
      }
      if (hit.startsWith('action:')) {
        opts.on_select_action(hit.slice('action:'.length) as LaunchActionId);
      }
    },
    on_pointer_move_content(e: PointerEvent): void {
      update_plain_text_hover(text_controls, e.x, e.y);
    },
    on_pointer_up_content(): void {
      const hit = release_hovered_plain_text_control(text_controls);
      if (!hit) return;
      if (!hit.startsWith('action:')) return;
      const action = hit.slice('action:'.length) as LaunchActionId;
      const availability = opts.get_state().availability[action];
      if (availability.enabled) opts.on_confirm_action(action);
    },
    on_pointer_leave_content(): void {
      clear_plain_text_control_interaction(text_controls);
    },
    on_key_down(e: KeyboardEvent): void {
      const state = opts.get_state();
      const currentIndex = ACTIONS.indexOf(state.selected_action);
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        opts.on_select_action(ACTIONS[(currentIndex - 1 + ACTIONS.length) % ACTIONS.length]!);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        opts.on_select_action(ACTIONS[(currentIndex + 1) % ACTIONS.length]!);
        return;
      }
      if (state.selected_action === 'join' && state.join_entries.length > 0) {
        const currentJoinIndex = Math.max(0, state.join_entries.findIndex((entry) => entry.id === state.selected_join_entry_id));
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          opts.on_select_join_entry(state.join_entries[(currentJoinIndex - 1 + state.join_entries.length) % state.join_entries.length]!.id);
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          opts.on_select_join_entry(state.join_entries[(currentJoinIndex + 1) % state.join_entries.length]!.id);
          return;
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const availability = state.availability[state.selected_action];
        if (availability.enabled) opts.on_confirm_action(state.selected_action);
      }
    },
    focusable: true,
  });
}
