import type { Canvas, Rgb, StyleName } from '../types.js';
import { get_ui_semantic_rgb, type UiSemanticColorRole } from '../runtime/ui_customization_store.js';

export type PlainTextControlId = string;

export type PlainTextHitbox = {
  id: PlainTextControlId;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type PlainTextHitboxMode = 'text_only' | 'full_row' | 'custom';

export type PlainTextControlState = {
  hovered_id: PlainTextControlId | null;
  pressed_id: PlainTextControlId | null;
  hitboxes: PlainTextHitbox[];
};

export type PlainTextSemanticRole = UiSemanticColorRole | 'custom';

export type PlainTextControlVisualOptions = {
  selected?: boolean;
  disabled?: boolean;
  hovered?: boolean;
  pressed?: boolean;
  idle_role?: PlainTextSemanticRole;
  hover_role?: PlainTextSemanticRole;
  pressed_role?: PlainTextSemanticRole;
  selected_role?: PlainTextSemanticRole;
  disabled_role?: PlainTextSemanticRole;
  custom_idle_rgb?: Rgb;
  custom_hover_rgb?: Rgb;
  custom_pressed_rgb?: Rgb;
  custom_selected_rgb?: Rgb;
  custom_disabled_rgb?: Rgb;
  base_weight_index?: number;
  selected_weight_index?: number;
  pressed_weight_index?: number;
  disabled_weight_index?: number;
};

export type DrawPlainTextControlOptions = PlainTextControlVisualOptions & {
  id?: PlainTextControlId;
  text: string;
  x: number;
  y: number;
  state?: PlainTextControlState;
  hitbox?: PlainTextHitboxMode;
  custom_hitbox?: PlainTextHitbox;
  render_index?: number;
  style?: StyleName;
};

export type DrawPlainTextRowOptions = DrawPlainTextControlOptions & {
  row_x0: number;
  row_x1: number;
};

export type DrawPlainTextToggleOptions = PlainTextControlVisualOptions & {
  id: PlainTextControlId;
  x: number;
  y: number;
  state: PlainTextControlState;
  label: string;
  value: boolean;
  row_x0?: number;
  row_x1?: number;
  true_text?: string;
  false_text?: string;
  render_index?: number;
  style?: StyleName;
};

function clamp_weight(weight: number): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(3, Math.round(weight))) as 0 | 1 | 2 | 3;
}

function normalize_hitbox(hitbox: PlainTextHitbox): PlainTextHitbox {
  return {
    id: hitbox.id,
    x0: Math.min(hitbox.x0, hitbox.x1),
    y0: Math.min(hitbox.y0, hitbox.y1),
    x1: Math.max(hitbox.x0, hitbox.x1),
    y1: Math.max(hitbox.y0, hitbox.y1),
  };
}

function resolve_role_rgb(role: PlainTextSemanticRole | undefined, custom_rgb: Rgb | undefined, fallback: UiSemanticColorRole): Rgb {
  if (role === 'custom' && custom_rgb) return custom_rgb;
  return get_ui_semantic_rgb((role && role !== 'custom' ? role : fallback));
}

export function create_plain_text_control_state(): PlainTextControlState {
  return {
    hovered_id: null,
    pressed_id: null,
    hitboxes: [],
  };
}

export function begin_plain_text_control_frame(state: PlainTextControlState): void {
  state.hitboxes = [];
}

export function clear_plain_text_control_interaction(state: PlainTextControlState): void {
  state.hovered_id = null;
  state.pressed_id = null;
}

export function register_plain_text_hitbox(state: PlainTextControlState, hitbox: PlainTextHitbox): void {
  state.hitboxes.push(normalize_hitbox(hitbox));
}

export function find_plain_text_hit(state: PlainTextControlState, x: number, y: number): PlainTextHitbox | null {
  for (let i = state.hitboxes.length - 1; i >= 0; i -= 1) {
    const hit = state.hitboxes[i]!;
    if (x >= hit.x0 && x <= hit.x1 && y >= hit.y0 && y <= hit.y1) return hit;
  }
  return null;
}

export function make_text_hitbox(id: PlainTextControlId, x: number, y: number, text: string): PlainTextHitbox {
  return { id, x0: x, y0: y, x1: x + Math.max(0, text.length - 1), y1: y };
}

export function update_plain_text_hover(state: PlainTextControlState, x: number, y: number): PlainTextControlId | null {
  const hit = find_plain_text_hit(state, x, y);
  state.hovered_id = hit?.id ?? null;
  return state.hovered_id;
}

export function press_plain_text_control(state: PlainTextControlState, x: number, y: number): PlainTextControlId | null {
  const hit = find_plain_text_hit(state, x, y);
  state.hovered_id = hit?.id ?? null;
  state.pressed_id = hit?.id ?? null;
  return state.pressed_id;
}

export function release_plain_text_control(state: PlainTextControlState, x: number, y: number): PlainTextControlId | null {
  const hit = find_plain_text_hit(state, x, y);
  state.hovered_id = hit?.id ?? null;
  return release_hovered_plain_text_control(state);
}

export function release_hovered_plain_text_control(state: PlainTextControlState): PlainTextControlId | null {
  const triggered = state.pressed_id && state.hovered_id === state.pressed_id ? state.pressed_id : null;
  state.pressed_id = null;
  return triggered;
}

export function is_plain_text_control_hovered(state: PlainTextControlState, id: PlainTextControlId): boolean {
  return state.hovered_id === id;
}

export function is_plain_text_control_pressed(state: PlainTextControlState, id: PlainTextControlId): boolean {
  return state.pressed_id === id;
}

export function resolve_plain_text_control_rgb(opts: PlainTextControlVisualOptions): Rgb {
  if (opts.disabled) return resolve_role_rgb(opts.disabled_role, opts.custom_disabled_rgb, 'dimmest');
  if (opts.pressed) return resolve_role_rgb(opts.pressed_role, opts.custom_pressed_rgb, 'vivid');
  if (opts.hovered) return resolve_role_rgb(opts.hover_role, opts.custom_hover_rgb, 'vivid');
  if (opts.selected) return resolve_role_rgb(opts.selected_role, opts.custom_selected_rgb, 'bright');
  return resolve_role_rgb(opts.idle_role, opts.custom_idle_rgb, 'bright');
}

export function resolve_plain_text_control_weight_index(opts: PlainTextControlVisualOptions): 0 | 1 | 2 | 3 {
  if (opts.disabled) return clamp_weight(opts.disabled_weight_index ?? opts.base_weight_index ?? 1);
  if (opts.pressed) return clamp_weight(opts.pressed_weight_index ?? ((opts.selected ? 2 : 1) + 1));
  if (opts.selected) return clamp_weight(opts.selected_weight_index ?? 2);
  return clamp_weight(opts.base_weight_index ?? 1);
}

function register_draw_hitbox(state: PlainTextControlState | undefined, id: PlainTextControlId | undefined, hitbox: PlainTextHitbox | null): void {
  if (!state || !id || !hitbox) return;
  register_plain_text_hitbox(state, hitbox);
}

export function draw_plain_text_control(c: Canvas, opts: DrawPlainTextControlOptions): void {
  const render_index = opts.render_index ?? 10;
  const style = opts.style ?? 'regular';
  const hovered = !!(opts.id && opts.state && is_plain_text_control_hovered(opts.state, opts.id));
  const pressed = !!(opts.id && opts.state && is_plain_text_control_pressed(opts.state, opts.id));
  const rgb = resolve_plain_text_control_rgb({ ...opts, hovered, pressed });
  const weight_index = resolve_plain_text_control_weight_index({ ...opts, hovered, pressed });
  for (let i = 0; i < opts.text.length; i += 1) {
    c.set(opts.x + i, opts.y, { char: opts.text[i]!, rgb, weight_index, render_index, style });
  }
  if (opts.hitbox === 'custom') register_draw_hitbox(opts.state, opts.id, opts.custom_hitbox ?? null);
  else if (opts.hitbox === 'text_only') register_draw_hitbox(opts.state, opts.id, make_text_hitbox(opts.id!, opts.x, opts.y, opts.text));
}

export function draw_plain_text_row(c: Canvas, opts: DrawPlainTextRowOptions): void {
  draw_plain_text_control(c, { ...opts, hitbox: 'custom', custom_hitbox: { id: opts.id!, x0: opts.row_x0, y0: opts.y, x1: opts.row_x1, y1: opts.y } });
}

export function draw_plain_text_toggle(c: Canvas, opts: DrawPlainTextToggleOptions): void {
  const value_text = opts.value ? (opts.true_text ?? '[x]') : (opts.false_text ?? '[ ]');
  const text = `${value_text} ${opts.label}`;
  if (typeof opts.row_x0 === 'number' && typeof opts.row_x1 === 'number') {
    draw_plain_text_row(c, { ...opts, text, row_x0: opts.row_x0, row_x1: opts.row_x1 });
    return;
  }
  draw_plain_text_control(c, { ...opts, text, hitbox: 'text_only' });
}
