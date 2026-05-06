import type { Canvas, Rgb, StyleName } from '../types.js';
import {
  draw_plain_text_control,
  draw_plain_text_row,
  type PlainTextControlState,
  type PlainTextSemanticRole,
} from './plain_text_controls.js';

type BaseTextInteractableOptions = {
  id: string;
  label: string;
  x: number;
  y: number;
  state: PlainTextControlState;
  disabled?: boolean;
  render_index?: number;
  style?: StyleName;
};

type RowBoundsOptions = {
  row_x0: number;
  row_x1: number;
};

export type DrawTextCommandOptions = BaseTextInteractableOptions & {
  idle_role?: PlainTextSemanticRole;
  hover_role?: PlainTextSemanticRole;
  pressed_role?: PlainTextSemanticRole;
  disabled_role?: PlainTextSemanticRole;
  custom_idle_rgb?: Rgb;
  custom_hover_rgb?: Rgb;
  custom_pressed_rgb?: Rgb;
  custom_disabled_rgb?: Rgb;
  base_weight_index?: number;
  pressed_weight_index?: number;
  disabled_weight_index?: number;
};

export type DrawTextCommandRowOptions = DrawTextCommandOptions & RowBoundsOptions;

export type DrawTextStatefulOptions = BaseTextInteractableOptions & {
  active: boolean;
  inactive_role?: PlainTextSemanticRole;
  active_role?: PlainTextSemanticRole;
  hover_role?: PlainTextSemanticRole;
  pressed_role?: PlainTextSemanticRole;
  disabled_role?: PlainTextSemanticRole;
  custom_inactive_rgb?: Rgb;
  custom_active_rgb?: Rgb;
  custom_hover_rgb?: Rgb;
  custom_pressed_rgb?: Rgb;
  custom_disabled_rgb?: Rgb;
  base_weight_index?: number;
  active_weight_index?: number;
  pressed_weight_index?: number;
  disabled_weight_index?: number;
};

export type DrawTextStatefulRowOptions = DrawTextStatefulOptions & RowBoundsOptions;

export function draw_text_command(c: Canvas, opts: DrawTextCommandOptions): void {
  draw_plain_text_control(c, {
    id: opts.id,
    text: opts.label,
    x: opts.x,
    y: opts.y,
    state: opts.state,
    hitbox: 'text_only',
    disabled: opts.disabled,
    idle_role: opts.idle_role ?? 'bright',
    hover_role: opts.hover_role ?? 'vivid',
    pressed_role: opts.pressed_role ?? 'vivid',
    disabled_role: opts.disabled_role ?? 'dimmest',
    custom_idle_rgb: opts.custom_idle_rgb,
    custom_hover_rgb: opts.custom_hover_rgb,
    custom_pressed_rgb: opts.custom_pressed_rgb,
    custom_disabled_rgb: opts.custom_disabled_rgb,
    base_weight_index: opts.base_weight_index ?? 1,
    pressed_weight_index: opts.pressed_weight_index ?? 2,
    disabled_weight_index: opts.disabled_weight_index ?? (opts.base_weight_index ?? 1),
    render_index: opts.render_index,
    style: opts.style,
  });
}

export function draw_text_command_row(c: Canvas, opts: DrawTextCommandRowOptions): void {
  draw_plain_text_row(c, {
    id: opts.id,
    text: opts.label,
    x: opts.x,
    y: opts.y,
    row_x0: opts.row_x0,
    row_x1: opts.row_x1,
    state: opts.state,
    disabled: opts.disabled,
    idle_role: opts.idle_role ?? 'bright',
    hover_role: opts.hover_role ?? 'vivid',
    pressed_role: opts.pressed_role ?? 'vivid',
    disabled_role: opts.disabled_role ?? 'dimmest',
    custom_idle_rgb: opts.custom_idle_rgb,
    custom_hover_rgb: opts.custom_hover_rgb,
    custom_pressed_rgb: opts.custom_pressed_rgb,
    custom_disabled_rgb: opts.custom_disabled_rgb,
    base_weight_index: opts.base_weight_index ?? 1,
    pressed_weight_index: opts.pressed_weight_index ?? 2,
    disabled_weight_index: opts.disabled_weight_index ?? (opts.base_weight_index ?? 1),
    render_index: opts.render_index,
    style: opts.style,
  });
}

export function draw_text_stateful(c: Canvas, opts: DrawTextStatefulOptions): void {
  draw_plain_text_control(c, {
    id: opts.id,
    text: opts.label,
    x: opts.x,
    y: opts.y,
    state: opts.state,
    hitbox: 'text_only',
    selected: opts.active,
    disabled: opts.disabled,
    idle_role: opts.inactive_role ?? 'medium',
    selected_role: opts.active_role ?? 'bright',
    hover_role: opts.hover_role ?? 'vivid',
    pressed_role: opts.pressed_role ?? 'vivid',
    disabled_role: opts.disabled_role ?? 'dimmest',
    custom_idle_rgb: opts.custom_inactive_rgb,
    custom_selected_rgb: opts.custom_active_rgb,
    custom_hover_rgb: opts.custom_hover_rgb ?? opts.custom_active_rgb,
    custom_pressed_rgb: opts.custom_pressed_rgb ?? opts.custom_active_rgb,
    custom_disabled_rgb: opts.custom_disabled_rgb,
    base_weight_index: opts.base_weight_index ?? 1,
    selected_weight_index: opts.active_weight_index ?? 2,
    pressed_weight_index: opts.pressed_weight_index ?? 3,
    disabled_weight_index: opts.disabled_weight_index ?? (opts.base_weight_index ?? 1),
    render_index: opts.render_index,
    style: opts.style,
  });
}

export function draw_text_stateful_row(c: Canvas, opts: DrawTextStatefulRowOptions): void {
  draw_plain_text_row(c, {
    id: opts.id,
    text: opts.label,
    x: opts.x,
    y: opts.y,
    row_x0: opts.row_x0,
    row_x1: opts.row_x1,
    state: opts.state,
    selected: opts.active,
    disabled: opts.disabled,
    idle_role: opts.inactive_role ?? 'medium',
    selected_role: opts.active_role ?? 'bright',
    hover_role: opts.hover_role ?? 'vivid',
    pressed_role: opts.pressed_role ?? 'vivid',
    disabled_role: opts.disabled_role ?? 'dimmest',
    custom_idle_rgb: opts.custom_inactive_rgb,
    custom_selected_rgb: opts.custom_active_rgb,
    custom_hover_rgb: opts.custom_hover_rgb ?? opts.custom_active_rgb,
    custom_pressed_rgb: opts.custom_pressed_rgb ?? opts.custom_active_rgb,
    custom_disabled_rgb: opts.custom_disabled_rgb,
    base_weight_index: opts.base_weight_index ?? 1,
    selected_weight_index: opts.active_weight_index ?? 2,
    pressed_weight_index: opts.pressed_weight_index ?? 3,
    disabled_weight_index: opts.disabled_weight_index ?? (opts.base_weight_index ?? 1),
    render_index: opts.render_index,
    style: opts.style,
  });
}
