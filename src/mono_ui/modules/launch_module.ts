import type { Canvas, Module, PointerEvent, Rect } from '../types.js';
import { make_floating_panel_module } from './floating_panel_module.js';
import { get_color_by_name } from '../colors.js';
import type { LaunchActionId, LaunchMenuState } from '../../engine_launch/types.js';

type LaunchModuleOptions = {
  id: string;
  rect: Rect;
  title: string;
  get_state: () => LaunchMenuState;
  on_select_action: (action: LaunchActionId) => void;
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
  const text = get_color_by_name('off_white').rgb;
  const muted = get_color_by_name('medium_gray').rgb;
  const accent = get_color_by_name('vivid_yellow').rgb;
  const good = get_color_by_name('pale_green').rgb;
  const panel = get_color_by_name('off_black').rgb;
  const border = get_color_by_name('pale_yellow').rgb;
  let hits: Array<{ action: LaunchActionId; x0: number; x1: number; y: number }> = [];

  function drawText(c: Canvas, x: number, y: number, value: string, rgb = text, weight_index = 2): void {
    for (let i = 0; i < value.length; i += 1) {
      c.set(x + i, y, { char: value[i]!, rgb, weight_index, render_index: 6, style: 'regular' });
    }
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: opts.title,
    background: { rgb: panel },
    border: { border_rgb: border, text_rgb: border },
    resize: { min_width: 28, min_height: 12, max_width: 64, max_height: 28 },
    gizmos: {
      enabled: ['seamless'],
      can_close: false,
      can_move: false,
      can_save_position: false,
    },
    draw_content(c: Canvas, rect: Rect): void {
      hits = [];
      const state = opts.get_state();
      const actionStartY = rect.y1 - 3;
      drawText(c, rect.x0 + 2, rect.y1 - 1, 'Choose how to begin', muted, 3);
      if (state.resume_candidate) {
        drawText(c, rect.x0 + 2, rect.y1 - 2, state.resume_candidate.summary.title, good, 3);
        if (state.resume_candidate.summary.subtitle) {
          drawText(c, rect.x0 + 2, rect.y1 - 3, state.resume_candidate.summary.subtitle, muted, 2);
        }
      }
      for (let i = 0; i < ACTIONS.length; i += 1) {
        const action = ACTIONS[i]!;
        const rowY = actionStartY - 2 - i * 2;
        const selected = state.selected_action === action;
        const availability = state.availability[action];
        const enabled = availability.enabled;
        const label = `[${LABELS[action].toUpperCase()}]`;
        const color = !enabled ? muted : selected ? accent : text;
        drawText(c, rect.x0 + 2, rowY, label, color, selected ? 5 : 3);
        hits.push({ action, x0: rect.x0 + 2, x1: rect.x0 + 2 + label.length - 1, y: rowY });
        if (!enabled) {
          drawText(c, rect.x0 + 2 + label.length + 2, rowY, availability.reason, muted, 2);
        }
      }
      const statusTop = rect.y0 + 2;
      for (let i = 0; i < state.status_lines.length && statusTop + i < actionStartY - 10; i += 1) {
        drawText(c, rect.x0 + 2, statusTop + i, state.status_lines[i] ?? '', muted, 2);
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const hit = hits.find((entry) => entry.y === e.y && e.x >= entry.x0 && e.x <= entry.x1);
      if (!hit) return;
      opts.on_select_action(hit.action);
      const availability = opts.get_state().availability[hit.action];
      if (availability.enabled) opts.on_confirm_action(hit.action);
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
      if (e.key === 'Enter') {
        e.preventDefault();
        const availability = state.availability[state.selected_action];
        if (availability.enabled) opts.on_confirm_action(state.selected_action);
      }
    },
    focusable: true,
  });
}
