import type { Module, Canvas, Rect, PointerEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';
import type { VoxelSpace } from '../../ascii_painter/voxel_space.js';

export type PlaceCameraControlOptions = {
  id: string;
  rect: Rect;
  getSpace: () => VoxelSpace;
  title?: string;
  action_rows?: Array<Array<{ id: string; label: string }>>;
  onAction?: (id: string) => void;
  onParallaxMoveToggle?: (enabled: boolean) => void;
  onParallaxSizeToggle?: (enabled: boolean) => void;
  onOcclusionToggle?: (enabled: boolean) => void;
  occlusionLabel?: string;
  getOcclusionEnabled?: () => boolean;
  onCenterTargetToggle?: (enabled: boolean) => void;
  onCalibrationChange?: (x: number, y: number) => void;
  onCalibrationReset?: () => void;
  onScalePerLayerChange?: (value: number) => void;
  onMovementPerLayerChange?: (value: number) => void;
  onMouseAngleYawDegChange?: (value: number) => void;
  onMouseAnglePitchDegChange?: (value: number) => void;
  onMouseAngleSpringChange?: (value: number) => void;
  onMove?: (new_rect: Rect) => void;
  onResize?: (new_rect: Rect) => void;
  onClose?: () => void;
};

const MIN_WIDTH = 24;
const MAX_WIDTH = 44;
const MIN_HEIGHT = 12;
const MAX_HEIGHT = 40;

const ROW_GIZMO = 0;
const ROW_TITLE = 1;
const ROW_SEPARATOR_1 = 2;
const ROW_PARALLAX_MOVE = 3;
const ROW_PARALLAX_SIZE = 4;
const ROW_OCCLUSION = 5;
const ROW_CENTER_TARGET = 6;
const ROW_SEPARATOR_2 = 7;
const ROW_ACTIONS_1 = 8;
const ROW_ACTIONS_2 = 9;
const ROW_SEPARATOR_2B = 10;
const ROW_MOUSE_YAW_LABEL = 11;
const ROW_MOUSE_YAW = 12;
const ROW_MOUSE_YAW_SLIDER = 13;
const ROW_SEPARATOR_3 = 14;
const ROW_MOUSE_PITCH_LABEL = 15;
const ROW_MOUSE_PITCH = 16;
const ROW_MOUSE_PITCH_SLIDER = 17;
const ROW_SEPARATOR_4 = 18;
const ROW_MOUSE_SPRING_LABEL = 19;
const ROW_MOUSE_SPRING = 20;
const ROW_MOUSE_SPRING_SLIDER = 21;
const ROW_SEPARATOR_5 = 22;
const ROW_LAYER_MOVE_LABEL = 23;
const ROW_LAYER_MOVE = 24;
const ROW_LAYER_MOVE_SLIDER = 25;
const ROW_SEPARATOR_6 = 26;
const ROW_LAYER_SCALE_LABEL = 27;
const ROW_LAYER_SCALE = 28;
const ROW_LAYER_SCALE_SLIDER = 29;
const ROW_SEPARATOR_7 = 30;
const ROW_CALIBRATION_LABEL = 31;
const ROW_CALIBRATION_X_VALUE = 32;
const ROW_CALIBRATION_X_SLIDER = 33;
const ROW_CALIBRATION_Y_VALUE = 34;
const ROW_CALIBRATION_Y_SLIDER = 35;
const ROW_RESET = 36;

const CONTENT_HEIGHT = 37;
const COL_TOGGLE = 2;
const COL_LABEL = 4;

export function makePlaceCameraControlModule(opts: PlaceCameraControlOptions): Module {
  let rect = opts.rect;
  let scroll_offset = 0;
  let is_dragging_slider: 'movement_per_layer' | 'scale_per_layer' | 'mouse_angle_yaw_deg' | 'mouse_angle_pitch_deg' | 'mouse_angle_spring' | 'calibration_x' | 'calibration_y' | null = null;
  let buttonHitboxes: Array<{ id: string; x0: number; y0: number; x1: number; y1: number }> = [];
  let pressedButtons = new Set<string>();

  const borderColor = get_color_by_name('medium_gray').rgb;
  const textColor = get_color_by_name('off_white').rgb;
  const labelColor = get_color_by_name('pale_gray').rgb;
  const enabledColor = get_color_by_name('vivid_green').rgb;
  const disabledColor = get_color_by_name('pale_gray').rgb;
  const accentColor = get_color_by_name('vivid_cyan').rgb;
  const valueColor = get_color_by_name('vivid_yellow').rgb;
  const sliderBgColor = get_color_by_name('dark_gray').rgb;
  const sliderFgColor = get_color_by_name('vivid_blue').rgb;

  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.onClose,
    on_move: opts.onMove,
  };

  function get_visible_height(): number {
    return rect.y1 - rect.y0 - 1;
  }

  function clamp_scroll(): void {
    const max_scroll = Math.max(0, CONTENT_HEIGHT - get_visible_height());
    scroll_offset = Math.max(0, Math.min(max_scroll, scroll_offset));
  }

  function is_row_visible(row: number): boolean {
    return row >= scroll_offset && row <= scroll_offset + get_visible_height();
  }

  function get_screen_y(row: number): number {
    return rect.y1 - 1 - (row - scroll_offset);
  }

  function set_button_hitbox(id: string, x0: number, y0: number, x1: number, y1: number): void {
    buttonHitboxes.push({ id, x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
  }

  function find_button_hitbox(x: number, y: number) {
    for (let i = buttonHitboxes.length - 1; i >= 0; i -= 1) {
      const hit = buttonHitboxes[i]!;
      if (x >= hit.x0 && x <= hit.x1 && y >= hit.y0 && y <= hit.y1) return hit;
    }
    return null;
  }

  function drawSeparator(c: Canvas, row: number): void {
    if (!is_row_visible(row)) return;
    const y = get_screen_y(row);
    for (let x = rect.x0 + 1; x < rect.x1; x += 1) c.set(x, y, { char: '─', rgb: borderColor, weight_index: 1, render_index: 10 });
  }

  function drawLabel(c: Canvas, row: number, text: string): void {
    if (!is_row_visible(row)) return;
    const y = get_screen_y(row);
    for (let i = 0; i < text.length && rect.x0 + COL_LABEL + i <= rect.x1 - 2; i += 1) c.set(rect.x0 + COL_LABEL + i, y, { char: text[i]!, rgb: labelColor, weight_index: 0, render_index: 10 });
  }

  function drawToggle(c: Canvas, row: number, enabled: boolean, label: string): void {
    if (!is_row_visible(row)) return;
    const y = get_screen_y(row);
    const x = rect.x0 + COL_TOGGLE;
    c.set(x, y, { char: '[', rgb: borderColor, weight_index: 0, render_index: 10 });
    c.set(x + 1, y, { char: enabled ? 'x' : ' ', rgb: enabled ? enabledColor : disabledColor, weight_index: 2, render_index: 10 });
    c.set(x + 2, y, { char: ']', rgb: borderColor, weight_index: 0, render_index: 10 });
    for (let i = 0; i < label.length && x + 4 + i <= rect.x1 - 2; i += 1) c.set(x + 4 + i, y, { char: label[i]!, rgb: textColor, weight_index: 0, render_index: 10 });
    set_button_hitbox(`toggle:${row}`, rect.x0 + 1, y, rect.x1 - 2, y);
  }

  function drawActionRow(c: Canvas, row: number, actions: Array<{ id: string; label: string }>): void {
    if (!is_row_visible(row) || actions.length === 0) return;
    const y = get_screen_y(row);
    const span = Math.max(1, rect.x1 - rect.x0 - 3);
    const slotWidth = Math.max(7, Math.floor(span / actions.length));
    actions.forEach((action, index) => {
      const label = `[${action.label}]`;
      const x = rect.x0 + 2 + slotWidth * index;
      for (let i = 0; i < label.length && x + i <= rect.x1 - 2; i += 1) {
        c.set(x + i, y, { char: label[i]!, rgb: pressedButtons.has(action.id) ? accentColor : textColor, weight_index: 1, render_index: 10 });
      }
      set_button_hitbox(`action:${action.id}`, x, y, Math.min(rect.x1 - 2, x + label.length - 1), y);
    });
  }

  function drawValue(c: Canvas, row: number, value: string): void {
    if (!is_row_visible(row)) return;
    const y = get_screen_y(row);
    const x = rect.x0 + Math.floor((rect.x1 - rect.x0 - value.length) / 2);
    for (let i = 0; i < value.length; i += 1) c.set(x + i, y, { char: value[i]!, rgb: valueColor, weight_index: 1, render_index: 10 });
  }

  function slider_bounds(): { x0: number; x1: number } {
    return { x0: rect.x0 + 4, x1: rect.x1 - 4 };
  }

  function slider_track_bounds(): { x0: number; x1: number } {
    const { x0, x1 } = slider_bounds();
    return { x0: x0 + 4, x1: x1 - 4 };
  }

  function get_slider_value(pointer_x: number, min: number, max: number): number {
    const { x0, x1 } = slider_track_bounds();
    const t = Math.max(0, Math.min(1, (pointer_x - x0) / Math.max(1, (x1 - x0))));
    return min + (max - min) * t;
  }

  function is_on_slider(x: number, y: number, row: number): boolean {
    if (!is_row_visible(row)) return false;
    const sy = get_screen_y(row);
    const { x0, x1 } = slider_track_bounds();
    return y === sy && x >= x0 && x <= x1;
  }

  function is_on_minus(x: number, y: number, row: number): boolean {
    if (!is_row_visible(row)) return false;
    const sy = get_screen_y(row);
    const { x0 } = slider_bounds();
    return y === sy && x >= x0 && x <= x0 + 2;
  }

  function is_on_plus(x: number, y: number, row: number): boolean {
    if (!is_row_visible(row)) return false;
    const sy = get_screen_y(row);
    const { x1 } = slider_bounds();
    return y === sy && x >= x1 - 2 && x <= x1;
  }

  function drawSlider(c: Canvas, row: number, value: number, min: number, max: number): void {
    if (!is_row_visible(row)) return;
    const y = get_screen_y(row);
    const { x0, x1 } = slider_bounds();
    c.set(x0, y, { char: '[', rgb: borderColor, weight_index: 0, render_index: 10 });
    c.set(x0 + 1, y, { char: '-', rgb: textColor, weight_index: 1, render_index: 10 });
    c.set(x0 + 2, y, { char: ']', rgb: borderColor, weight_index: 0, render_index: 10 });
    c.set(x1 - 2, y, { char: '[', rgb: borderColor, weight_index: 0, render_index: 10 });
    c.set(x1 - 1, y, { char: '+', rgb: textColor, weight_index: 1, render_index: 10 });
    c.set(x1, y, { char: ']', rgb: borderColor, weight_index: 0, render_index: 10 });
    const track_x0 = x0 + 4;
    const track_x1 = x1 - 4;
    for (let x = track_x0; x <= track_x1; x += 1) c.set(x, y, { char: '─', rgb: sliderBgColor, weight_index: 0, render_index: 10 });
    const t = Math.max(0, Math.min(1, (value - min) / Math.max(0.0001, max - min)));
    const knobX = track_x0 + Math.round((track_x1 - track_x0) * t);
    c.set(knobX, y, { char: '◆', rgb: sliderFgColor, weight_index: 2, render_index: 10 });
  }

  function nudgeSlider(kind: typeof is_dragging_slider, dir: -1 | 1): void {
    const cam = camera();
    if (kind === 'mouse_angle_yaw_deg') opts.onMouseAngleYawDegChange?.(Math.max(-45, Math.min(45, Math.round(((cam.mouse_angle_yaw_deg ?? 0) + dir * 0.5) * 10) / 10)));
    else if (kind === 'mouse_angle_pitch_deg') opts.onMouseAnglePitchDegChange?.(Math.max(-45, Math.min(45, Math.round(((cam.mouse_angle_pitch_deg ?? 0) + dir * 0.5) * 10) / 10)));
    else if (kind === 'mouse_angle_spring') opts.onMouseAngleSpringChange?.(Math.max(1, Math.min(30, Math.round(((cam.mouse_angle_spring ?? 10) + dir * 0.5) * 10) / 10)));
    else if (kind === 'movement_per_layer') opts.onMovementPerLayerChange?.(Math.max(-500, Math.min(500, Math.round((cam.movement_per_layer ?? 0) + dir))));
    else if (kind === 'scale_per_layer') opts.onScalePerLayerChange?.(Math.max(-1, Math.min(1, Math.round(((cam.scale_per_layer ?? 0) + dir * 0.01) * 100) / 100)));
    else if (kind === 'calibration_x') opts.onCalibrationChange?.(Math.max(-500, Math.min(500, Math.round((cam.calibration?.x ?? 0) + dir))), Math.round(cam.calibration?.y ?? 0));
    else if (kind === 'calibration_y') opts.onCalibrationChange?.(Math.round(cam.calibration?.x ?? 0), Math.max(-500, Math.min(500, Math.round((cam.calibration?.y ?? 0) + dir))));
  }

  function camera() {
    return opts.getSpace().camera;
  }

  return make_floating_panel_module({
    id: opts.id,
    rect,
    title: opts.title ?? 'Place Camera',
    gizmos: gizmo_config,
    resize: { min_width: MIN_WIDTH, min_height: MIN_HEIGHT, max_width: MAX_WIDTH, max_height: MAX_HEIGHT },
    draw_content(c: Canvas, next_rect: Rect): void {
      rect = next_rect;
      clamp_scroll();
      buttonHitboxes = [];
      const cam = camera();
      drawSeparator(c, ROW_SEPARATOR_1);
      drawToggle(c, ROW_PARALLAX_MOVE, cam.parallax_move_enabled ?? false, 'Soft Mouse Tilt');
      drawToggle(c, ROW_PARALLAX_SIZE, cam.parallax_size_enabled ?? false, 'Depth Scale');
      drawToggle(c, ROW_OCCLUSION, opts.getOcclusionEnabled ? opts.getOcclusionEnabled() : !(cam.show_all_layers ?? true), opts.occlusionLabel ?? 'Voxel Occlusion');
      drawToggle(c, ROW_CENTER_TARGET, cam.center_target_in_view ?? false, 'Center Target');
      drawSeparator(c, ROW_SEPARATOR_2);
      drawActionRow(c, ROW_ACTIONS_1, opts.action_rows?.[0] ?? []);
      drawActionRow(c, ROW_ACTIONS_2, opts.action_rows?.[1] ?? []);
      drawSeparator(c, ROW_SEPARATOR_2B);
      drawLabel(c, ROW_MOUSE_YAW_LABEL, 'Mouse Yaw°');
      drawValue(c, ROW_MOUSE_YAW, (cam.mouse_angle_yaw_deg ?? 0).toFixed(1));
      drawSlider(c, ROW_MOUSE_YAW_SLIDER, cam.mouse_angle_yaw_deg ?? 0, -45, 45);
      drawSeparator(c, ROW_SEPARATOR_3);
      drawLabel(c, ROW_MOUSE_PITCH_LABEL, 'Mouse Pitch°');
      drawValue(c, ROW_MOUSE_PITCH, (cam.mouse_angle_pitch_deg ?? 0).toFixed(1));
      drawSlider(c, ROW_MOUSE_PITCH_SLIDER, cam.mouse_angle_pitch_deg ?? 0, -45, 45);
      drawSeparator(c, ROW_SEPARATOR_4);
      drawLabel(c, ROW_MOUSE_SPRING_LABEL, 'Mouse Spring');
      drawValue(c, ROW_MOUSE_SPRING, (cam.mouse_angle_spring ?? 0).toFixed(1));
      drawSlider(c, ROW_MOUSE_SPRING_SLIDER, cam.mouse_angle_spring ?? 0, 1, 30);
      drawSeparator(c, ROW_SEPARATOR_5);
      drawLabel(c, ROW_LAYER_MOVE_LABEL, 'Depth Move');
      drawValue(c, ROW_LAYER_MOVE, Math.round(cam.movement_per_layer ?? 0).toString());
      drawSlider(c, ROW_LAYER_MOVE_SLIDER, cam.movement_per_layer ?? 0, -500, 500);
      drawSeparator(c, ROW_SEPARATOR_6);
      drawLabel(c, ROW_LAYER_SCALE_LABEL, 'Scale/Layer');
      drawValue(c, ROW_LAYER_SCALE, (cam.scale_per_layer ?? 0).toFixed(2));
      drawSlider(c, ROW_LAYER_SCALE_SLIDER, cam.scale_per_layer ?? 0, -1, 1);
      drawSeparator(c, ROW_SEPARATOR_7);
      drawLabel(c, ROW_CALIBRATION_LABEL, 'Calibration');
      const cal = cam.calibration ?? { x: 0, y: 0 };
      drawValue(c, ROW_CALIBRATION_X_VALUE, `X:${Math.round(cal.x)}`);
      drawSlider(c, ROW_CALIBRATION_X_SLIDER, cal.x, -500, 500);
      drawValue(c, ROW_CALIBRATION_Y_VALUE, `Y:${Math.round(cal.y)}`);
      drawSlider(c, ROW_CALIBRATION_Y_SLIDER, cal.y, -500, 500);
      if (is_row_visible(ROW_RESET)) {
        const y = get_screen_y(ROW_RESET);
        const label = '[Reset Calibration]';
        const x = rect.x0 + Math.floor((rect.x1 - rect.x0 - label.length) / 2);
        for (let i = 0; i < label.length; i += 1) c.set(x + i, y, { char: label[i]!, rgb: pressedButtons.has('reset_calibration') ? accentColor : textColor, weight_index: 1, render_index: 10 });
        set_button_hitbox('reset_calibration', x, y, x + label.length - 1, y);
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      if (is_dragging_slider !== null) is_dragging_slider = null;
      const cam = camera();
      const updateSlider = (kind: typeof is_dragging_slider, min: number, max: number, cb: (value: number) => void) => {
        is_dragging_slider = kind;
        cb(get_slider_value(e.x, min, max));
      };
      if (is_on_slider(e.x, e.y, ROW_MOUSE_YAW_SLIDER)) return updateSlider('mouse_angle_yaw_deg', -45, 45, (v) => opts.onMouseAngleYawDegChange?.(Math.round(v * 10) / 10));
      if (is_on_slider(e.x, e.y, ROW_MOUSE_PITCH_SLIDER)) return updateSlider('mouse_angle_pitch_deg', -45, 45, (v) => opts.onMouseAnglePitchDegChange?.(Math.round(v * 10) / 10));
      if (is_on_slider(e.x, e.y, ROW_MOUSE_SPRING_SLIDER)) return updateSlider('mouse_angle_spring', 1, 30, (v) => opts.onMouseAngleSpringChange?.(Math.round(v * 10) / 10));
      if (is_on_slider(e.x, e.y, ROW_LAYER_MOVE_SLIDER)) return updateSlider('movement_per_layer', -500, 500, (v) => opts.onMovementPerLayerChange?.(Math.round(v)));
      if (is_on_slider(e.x, e.y, ROW_LAYER_SCALE_SLIDER)) return updateSlider('scale_per_layer', -1, 1, (v) => opts.onScalePerLayerChange?.(Math.round(v * 100) / 100));
      if (is_on_slider(e.x, e.y, ROW_CALIBRATION_X_SLIDER)) return updateSlider('calibration_x', -500, 500, (v) => opts.onCalibrationChange?.(Math.round(v), Math.round(cam.calibration?.y ?? 0)));
      if (is_on_slider(e.x, e.y, ROW_CALIBRATION_Y_SLIDER)) return updateSlider('calibration_y', -500, 500, (v) => opts.onCalibrationChange?.(Math.round(cam.calibration?.x ?? 0), Math.round(v)));

      if (is_on_minus(e.x, e.y, ROW_MOUSE_YAW_SLIDER)) return void nudgeSlider('mouse_angle_yaw_deg', -1);
      if (is_on_plus(e.x, e.y, ROW_MOUSE_YAW_SLIDER)) return void nudgeSlider('mouse_angle_yaw_deg', 1);
      if (is_on_minus(e.x, e.y, ROW_MOUSE_PITCH_SLIDER)) return void nudgeSlider('mouse_angle_pitch_deg', -1);
      if (is_on_plus(e.x, e.y, ROW_MOUSE_PITCH_SLIDER)) return void nudgeSlider('mouse_angle_pitch_deg', 1);
      if (is_on_minus(e.x, e.y, ROW_MOUSE_SPRING_SLIDER)) return void nudgeSlider('mouse_angle_spring', -1);
      if (is_on_plus(e.x, e.y, ROW_MOUSE_SPRING_SLIDER)) return void nudgeSlider('mouse_angle_spring', 1);
      if (is_on_minus(e.x, e.y, ROW_LAYER_MOVE_SLIDER)) return void nudgeSlider('movement_per_layer', -1);
      if (is_on_plus(e.x, e.y, ROW_LAYER_MOVE_SLIDER)) return void nudgeSlider('movement_per_layer', 1);
      if (is_on_minus(e.x, e.y, ROW_LAYER_SCALE_SLIDER)) return void nudgeSlider('scale_per_layer', -1);
      if (is_on_plus(e.x, e.y, ROW_LAYER_SCALE_SLIDER)) return void nudgeSlider('scale_per_layer', 1);
      if (is_on_minus(e.x, e.y, ROW_CALIBRATION_X_SLIDER)) return void nudgeSlider('calibration_x', -1);
      if (is_on_plus(e.x, e.y, ROW_CALIBRATION_X_SLIDER)) return void nudgeSlider('calibration_x', 1);
      if (is_on_minus(e.x, e.y, ROW_CALIBRATION_Y_SLIDER)) return void nudgeSlider('calibration_y', -1);
      if (is_on_plus(e.x, e.y, ROW_CALIBRATION_Y_SLIDER)) return void nudgeSlider('calibration_y', 1);

      const hit = find_button_hitbox(e.x, e.y);
      if (!hit) return;
      if (hit.id.startsWith('action:')) {
        const actionId = hit.id.slice('action:'.length);
        pressedButtons.add(actionId);
        opts.onAction?.(actionId);
        return;
      }
      if (hit.id === `toggle:${ROW_PARALLAX_MOVE}`) return void opts.onParallaxMoveToggle?.(!(cam.parallax_move_enabled ?? false));
      if (hit.id === `toggle:${ROW_PARALLAX_SIZE}`) return void opts.onParallaxSizeToggle?.(!(cam.parallax_size_enabled ?? false));
      if (hit.id === `toggle:${ROW_OCCLUSION}`) {
        const enabled = opts.getOcclusionEnabled ? opts.getOcclusionEnabled() : !(cam.show_all_layers ?? true);
        return void opts.onOcclusionToggle?.(!enabled);
      }
      if (hit.id === `toggle:${ROW_CENTER_TARGET}`) return void opts.onCenterTargetToggle?.(!(cam.center_target_in_view ?? false));
      if (hit.id === 'reset_calibration') {
        pressedButtons.add('reset_calibration');
        opts.onCalibrationReset?.();
      }
    },
    on_pointer_move_content(e: PointerEvent): void {
      if (is_dragging_slider === 'mouse_angle_yaw_deg') opts.onMouseAngleYawDegChange?.(Math.round(get_slider_value(e.x, -45, 45) * 10) / 10);
      else if (is_dragging_slider === 'mouse_angle_pitch_deg') opts.onMouseAnglePitchDegChange?.(Math.round(get_slider_value(e.x, -45, 45) * 10) / 10);
      else if (is_dragging_slider === 'mouse_angle_spring') opts.onMouseAngleSpringChange?.(Math.round(get_slider_value(e.x, 1, 30) * 10) / 10);
      else if (is_dragging_slider === 'movement_per_layer') opts.onMovementPerLayerChange?.(Math.round(get_slider_value(e.x, -500, 500)));
      else if (is_dragging_slider === 'scale_per_layer') opts.onScalePerLayerChange?.(Math.round(get_slider_value(e.x, -1, 1) * 100) / 100);
      else if (is_dragging_slider === 'calibration_x') opts.onCalibrationChange?.(Math.round(get_slider_value(e.x, -500, 500)), Math.round(camera().calibration?.y ?? 0));
      else if (is_dragging_slider === 'calibration_y') opts.onCalibrationChange?.(Math.round(camera().calibration?.x ?? 0), Math.round(get_slider_value(e.x, -500, 500)));
    },
    on_pointer_up_content(): void {
      is_dragging_slider = null;
      pressedButtons.clear();
    },
    on_wheel_content(e): void {
      scroll_offset += e.delta_y > 0 ? 3 : -3;
      clamp_scroll();
    },
  });
}
