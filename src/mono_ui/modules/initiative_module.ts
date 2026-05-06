import type { Canvas, Module, PointerEvent, Rect, WheelEvent } from '../types.js';
import { PANEL_BORDER_PRESETS, draw_panel_horizontal_divider } from '../module_borders.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';
import { get_ui_semantic_rgb } from '../runtime/ui_customization_store.js';

export type InitiativeEntryView = {
  actor_ref: string;
  initiative_roll: number;
  status: string;
};

export type InitiativeModuleState = {
  active: boolean;
  type: string | null;
  phase: string | null;
  current_turn: number | null;
  current_round: number | null;
  active_actor_ref: string | null;
  controlled_actor_ref: string | null;
  turn_window_breaths: number | null;
  turn_breaths_remaining: number | null;
  timed_event_world_breath_index: number | null;
  initiative_order: InitiativeEntryView[];
};

export type InitiativeModuleOptions = {
  id: string;
  rect: Rect;
  get_state: () => InitiativeModuleState;
  on_move?: (new_rect: Rect) => void;
  on_resize?: (new_rect: Rect) => void;
  on_close?: () => void;
  on_end_turn?: () => void;
};

type Row =
  | {
      kind: 'world';
      label: string;
      detail: string;
      is_active: boolean;
    }
  | {
      kind: 'entry';
      actor_ref: string;
      initiative_roll: number;
      label: string;
      status: string;
      is_active: boolean;
    };

const MIN_WIDTH = 26;
const MAX_WIDTH = 72;
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 36;
const TRANSITION_FLASH_MS = 320;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function format_ref_label(ref: string): string {
  const raw = String(ref ?? '').replace(/^(actor|npc|item|tile)\./, '').trim();
  const base = raw.length > 0 ? raw : 'unknown';
  return base.replace(/[_\.]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function abbreviate_status(status: string): string {
  const upper = String(status ?? '').toUpperCase();
  if (upper === 'ACTIVE') return 'ACT';
  if (upper === 'DONE') return 'DONE';
  if (upper === 'WAITING') return 'WAIT';
  if (upper === 'PENDING') return 'PEND';
  if (upper === 'DELAYED') return 'DELAY';
  return upper.slice(0, 5) || 'UNK';
}

function build_rows(state: InitiativeModuleState): Row[] {
  const rows: Row[] = [];
  if (!state.active) return rows;

  if (state.phase === 'world_sim_interstitial') {
    const remaining = state.turn_breaths_remaining ?? 0;
    const total = state.turn_window_breaths ?? 0;
    const breath_index = state.timed_event_world_breath_index ?? 0;
    rows.push({
      kind: 'world',
      label: 'WORLD TURN',
      detail: `B:${remaining}/${total} W:${breath_index}`,
      is_active: true,
    });
  }

  for (const entry of Array.isArray(state.initiative_order) ? state.initiative_order : []) {
    rows.push({
      kind: 'entry',
      actor_ref: entry.actor_ref,
      initiative_roll: Number(entry.initiative_roll ?? 0) || 0,
      label: format_ref_label(entry.actor_ref),
      status: abbreviate_status(entry.status),
      is_active: state.phase !== 'world_sim_interstitial' && entry.actor_ref === state.active_actor_ref,
    });
  }

  return rows;
}

export function make_initiative_module(opts: InitiativeModuleOptions): Module {
  let rect = opts.rect;
  let scroll_offset = 0;
  let last_transition_key = '';
  let transition_until_ms = 0;
  let end_turn_hitbox: Rect | null = null;

  const bg_color = () => get_ui_semantic_rgb('background');
  const border_color = () => get_ui_semantic_rgb('dimmest');
  const text_color = () => get_ui_semantic_rgb('bright');
  const muted_color = () => get_ui_semantic_rgb('medium');
  const accent_color = () => get_ui_semantic_rgb('vivid');
  const world_color = () => get_ui_semantic_rgb('vivid');
  const active_color = () => get_ui_semantic_rgb('bright');
  const flash_color = () => get_ui_semantic_rgb('vivid');
  const status_color = () => get_ui_semantic_rgb('medium');

  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
    on_resize: opts.on_resize,
  };

  function content_height(): number {
    return Math.max(1, rect.y1 - rect.y0 - 5);
  }

  function max_scroll(rows: Row[]): number {
    return Math.max(0, rows.length - content_height());
  }

  function clamp_scroll(rows: Row[]): void {
    scroll_offset = clamp(scroll_offset, 0, max_scroll(rows));
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: 'INITIATIVE',
    gizmos: gizmo_config,
    background: { rgb: bg_color() },
    border: {
      style: PANEL_BORDER_PRESETS.default_double.style,
      border_rgb: border_color(),
      weight_index: PANEL_BORDER_PRESETS.default_double.weight_index,
      markers: () => {
        const rows = build_rows(opts.get_state());
        return {
          top: scroll_offset > 0 ? '^' : undefined,
          bottom: scroll_offset < max_scroll(rows) ? 'v' : undefined,
        };
      },
    },
    resize: {
      min_width: MIN_WIDTH,
      min_height: MIN_HEIGHT,
      max_width: MAX_WIDTH,
      max_height: MAX_HEIGHT,
    },
    draw_content(c: Canvas, next_rect: Rect): void {
      rect = next_rect;
      c.fill_rect(rect, { char: ' ', rgb: bg_color(), style: 'regular' });

      const state = opts.get_state();
      const rows = build_rows(state);
      clamp_scroll(rows);

      const transition_key = [
        state.active ? '1' : '0',
        state.phase ?? '',
        String(state.current_turn ?? ''),
        String(state.current_round ?? ''),
        state.active_actor_ref ?? '',
      ].join('|');
      if (transition_key !== last_transition_key) {
        last_transition_key = transition_key;
        transition_until_ms = Date.now() + TRANSITION_FLASH_MS;
      }
      const transition_active = Date.now() < transition_until_ms;

      const summary_y = rect.y1 - 2;
      const detail_y = rect.y1 - 3;
      const divider_y = rect.y1 - 4;
      const content_top_y = rect.y1 - 5;
      const content_bottom_y = rect.y0 + 1;
      const inner_width = Math.max(1, rect.x1 - rect.x0 - 2);

      const summary = state.active
        ? `${String(state.type ?? 'event').toUpperCase()}  R:${state.current_round ?? '?'} T:${state.current_turn ?? '?'}`
        : 'NO TIMED BASED EVENT';
      const detail = state.active
        ? (state.phase === 'world_sim_interstitial'
          ? `WORLD PHASE  B:${state.turn_breaths_remaining ?? '?'} / ${state.turn_window_breaths ?? '?'}`
          : `ACTIVE ${format_ref_label(state.active_actor_ref ?? '')}`)
        : 'Waiting for a timed event to begin';

      const summary_text = summary.slice(0, inner_width);
      for (let i = 0; i < summary_text.length; i += 1) {
        c.set(rect.x0 + 1 + i, summary_y, {
          char: summary_text[i]!,
          rgb: state.active ? accent_color() : muted_color(),
          style: 'regular',
          weight_index: 2,
        });
      }

      const detail_text = detail.slice(0, inner_width);
      for (let i = 0; i < detail_text.length; i += 1) {
        c.set(rect.x0 + 1 + i, detail_y, {
          char: detail_text[i]!,
          rgb: state.phase === 'world_sim_interstitial' ? world_color() : muted_color(),
          style: 'regular',
          weight_index: 2,
        });
      }

      const can_end_turn = !!(
        state.active
        && state.phase !== 'world_sim_interstitial'
        && state.active_actor_ref
        && state.controlled_actor_ref
        && state.active_actor_ref === state.controlled_actor_ref
      );
      const action_label = state.active ? (can_end_turn ? '[END TURN]' : '[WAIT TURN]') : '';
      const action_rgb = can_end_turn ? flash_color() : muted_color();
      const action_x = rect.x0 + 1;
      end_turn_hitbox = action_label
        ? {
            x0: action_x,
            y0: summary_y,
            x1: Math.min(rect.x1 - 1, action_x + action_label.length - 1),
            y1: summary_y,
          }
        : null;
      for (let i = 0; i < action_label.length && action_x + i < rect.x1; i += 1) {
        c.set(action_x + i, summary_y, {
          char: action_label[i]!,
          rgb: action_rgb,
          style: 'regular',
          weight_index: can_end_turn ? 3 : 2,
        });
      }

      draw_panel_horizontal_divider(c, {
        y: divider_y,
        rect,
        style: PANEL_BORDER_PRESETS.default_double.style,
        rgb: border_color(),
        weight_index: 1,
      });

      if (!state.active || rows.length === 0) {
        const empty = 'NO TIMED BASED EVENT';
        const x = rect.x0 + Math.max(1, Math.floor((inner_width - empty.length) / 2));
        const y = Math.max(content_bottom_y, Math.floor((content_bottom_y + content_top_y) / 2));
        for (let i = 0; i < empty.length && x + i < rect.x1; i += 1) {
          c.set(x + i, y, {
            char: empty[i]!,
            rgb: muted_color(),
            style: 'regular',
            weight_index: 2,
          });
        }
        return;
      }

      const visible_rows = Math.max(1, content_top_y - content_bottom_y + 1);
      const roll_width = 3;
      const marker_x = rect.x0 + 1;
      const roll_x = rect.x0 + 3;
      const status_width = Math.min(5, Math.max(3, Math.floor(inner_width / 5)));
      const status_x = Math.max(roll_x + roll_width + 2, rect.x1 - status_width - 1);
      const name_x = roll_x + roll_width + 2;
      const name_width = Math.max(4, status_x - name_x - 1);

      for (let i = 0; i < visible_rows; i += 1) {
        const row = rows[scroll_offset + i];
        if (!row) break;

        const y = content_top_y - i;
        if (y < content_bottom_y) break;

        const row_rgb = row.kind === 'world'
          ? world_color()
          : row.is_active
            ? (transition_active ? flash_color() : active_color())
            : text_color();
        const marker = row.kind === 'world' ? '*' : (row.is_active ? '>' : ' ');

        c.set(marker_x, y, {
          char: marker,
          rgb: row_rgb,
          style: 'regular',
          weight_index: row.is_active ? 3 : 2,
        });

        if (row.kind === 'world') {
          const label = row.label.slice(0, Math.max(1, status_x - name_x - 1));
          for (let j = 0; j < label.length && name_x + j < status_x; j += 1) {
            c.set(name_x + j, y, {
              char: label[j]!,
              rgb: row_rgb,
              style: 'regular',
              weight_index: 2,
            });
          }
          const detail_text_world = row.detail.slice(0, Math.max(1, rect.x1 - status_x));
          for (let j = 0; j < detail_text_world.length && status_x + j < rect.x1; j += 1) {
            c.set(status_x + j, y, {
              char: detail_text_world[j]!,
              rgb: status_color(),
              style: 'regular',
              weight_index: 2,
            });
          }
          continue;
        }

        const roll = String(row.initiative_roll).padStart(roll_width, ' ');
        for (let j = 0; j < roll.length; j += 1) {
          c.set(roll_x + j, y, {
            char: roll[j]!,
            rgb: accent_color(),
            style: 'regular',
            weight_index: row.is_active ? 3 : 2,
          });
        }

        const name = row.label.slice(0, name_width);
        for (let j = 0; j < name.length && name_x + j < status_x; j += 1) {
          c.set(name_x + j, y, {
            char: name[j]!,
            rgb: row_rgb,
            style: 'regular',
            weight_index: row.is_active ? 3 : 2,
          });
        }

        const status = row.status.slice(0, status_width);
        for (let j = 0; j < status.length && status_x + j < rect.x1; j += 1) {
          c.set(status_x + j, y, {
            char: status[j]!,
            rgb: row.is_active ? row_rgb : status_color(),
            style: 'regular',
            weight_index: 2,
          });
        }
      }
    },
    on_wheel_content(e: WheelEvent): void {
      const rows = build_rows(opts.get_state());
      if (rows.length <= 0) return;
      scroll_offset += e.delta_y > 0 ? 1 : -1;
      clamp_scroll(rows);
    },
    on_pointer_down_content(e: PointerEvent): void {
      if (e.button !== 0 || !end_turn_hitbox) return;
      const state = opts.get_state();
      const can_end_turn = !!(
        state.active
        && state.phase !== 'world_sim_interstitial'
        && state.active_actor_ref
        && state.controlled_actor_ref
        && state.active_actor_ref === state.controlled_actor_ref
      );
      if (!can_end_turn) return;
      if (e.x < end_turn_hitbox.x0 || e.x > end_turn_hitbox.x1 || e.y < end_turn_hitbox.y0 || e.y > end_turn_hitbox.y1) return;
      opts.on_end_turn?.();
    },
  });
}
