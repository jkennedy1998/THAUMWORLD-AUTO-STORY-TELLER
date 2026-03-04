/**
 * Camera Control Module
 * 
 * UI panel for controlling camera view settings in the 3D ASCII painter.
 * Provides parallax toggles, occlusion mode, orientation controls, and Euler rotation.
 * 
 * Layout:
 * ┌─ Camera ──────────────[×]─┐
 * │                           │
 * │ [👁] Parallax Move        │
 * │ [👁] Parallax Size        │
 * │ [■] Voxel Occlusion       │
 * │                           │
 * │ 90° Views:                │
 * │ [XY] [YZ] [XZ]            │
 * │                           │
 * │ Euler Rotate (±30°):      │
 * │ X: [←][→] 0°              │
 * │ Y: [←][→] 0°              │
 * │ Z: [←][→] 0°              │
 * │                           │
 * │ Pan: [Reset]              │
 * └───────────────────────────┘
 */

import type { Module, Canvas, Rect, PointerEvent, DragEvent, WheelEvent } from '../mono_ui/types.js';
import type { VoxelSpace, CameraConfig, CameraOrientation } from './voxel_space.js';
import { DEFAULT_CAMERA_VALUES } from './voxel_space.js';
import { get_color_by_name } from '../mono_ui/colors.js';
import type { ModuleGizmosConfig, GizmoState } from '../mono_ui/module_gizmos.js';
import { draw_module_gizmos, handle_gizmo_click, create_gizmo_state, is_in_gizmo_area, get_resize_edge, handle_resize_drag } from '../mono_ui/module_gizmos.js';

export type CameraControlOptions = {
  id: string;
  rect: Rect;
  getSpace: () => VoxelSpace;
  onParallaxMoveToggle?: (enabled: boolean) => void;
  onParallaxSizeToggle?: (enabled: boolean) => void;
  onOcclusionToggle?: (enabled: boolean) => void;
  onOrientationChange?: (orientation: CameraOrientation) => void;
  onEulerRotate?: (axis: 'x' | 'y' | 'z', degrees: number) => void;
  onPanReset?: () => void;
  onCalibrationChange?: (x: number, y: number) => void;
  onCalibrationReset?: () => void;
  onScalePerLayerChange?: (value: number) => void;
  onMovementPerLayerChange?: (value: number) => void;
  onBaseLayerScaleChange?: (value: number) => void;
  onCharSpacingXChange?: (value: number) => void;
  onCharSpacingYChange?: (value: number) => void;
  onPanXChange?: (value: number) => void;
  onPanYChange?: (value: number) => void;
  onMove?: (new_rect: Rect) => void;
  onResize?: (new_rect: Rect) => void;
  onClose?: () => void;
};

// Min/Max sizes for resize
const MIN_WIDTH = 24;
const MAX_WIDTH = 50;
const MIN_HEIGHT = 12;
const MAX_HEIGHT = 50;

// Layout rows (from bottom up)
const ROW_GIZMO = 0;
const ROW_TITLE = 1;
const ROW_SEPARATOR_1 = 2;
const ROW_PARALLAX_MOVE = 3;
const ROW_PARALLAX_SIZE = 4;
const ROW_OCCLUSION = 5;
const ROW_SEPARATOR_2 = 6;
const ROW_ORIENTATION_LABEL = 7;
const ROW_ORIENTATION_BUTTONS = 8;
const ROW_SEPARATOR_3 = 9;
const ROW_EULER_LABEL = 10;
const ROW_EULER_X = 11;
const ROW_EULER_Y = 12;
const ROW_EULER_Z = 13;
const ROW_SEPARATOR_4 = 14;
const ROW_PAN_RESET = 15;
const ROW_SEPARATOR_5 = 16;
const ROW_CALIBRATION_LABEL = 17;
const ROW_CALIBRATION_X_VALUE = 18;
const ROW_CALIBRATION_X_SLIDER = 19;
const ROW_CALIBRATION_Y_VALUE = 20;
const ROW_CALIBRATION_Y_SLIDER = 21;
const ROW_SEPARATOR_6 = 22;
const ROW_LAYER_SCALE_LABEL = 23;
const ROW_LAYER_SCALE = 24;
const ROW_LAYER_SCALE_SLIDER = 25;
const ROW_SEPARATOR_7 = 26;
const ROW_LAYER_MOVE_LABEL = 27;
const ROW_LAYER_MOVE = 28;
const ROW_LAYER_MOVE_SLIDER = 29;
const ROW_SEPARATOR_8 = 30;
const ROW_BASE_SCALE_LABEL = 31;
const ROW_BASE_SCALE = 32;
const ROW_BASE_SCALE_SLIDER = 33;
const ROW_SEPARATOR_9 = 34;
const ROW_CHAR_SPACING_X_LABEL = 35;
const ROW_CHAR_SPACING_X = 36;
const ROW_CHAR_SPACING_X_SLIDER = 37;
const ROW_SEPARATOR_10 = 38;
const ROW_CHAR_SPACING_Y_LABEL = 39;
const ROW_CHAR_SPACING_Y = 40;
const ROW_CHAR_SPACING_Y_SLIDER = 41;
const ROW_SEPARATOR_11 = 42;
const ROW_PAN_X_LABEL = 43;
const ROW_PAN_X_VALUE = 44;
const ROW_PAN_X_SLIDER = 45;
const ROW_SEPARATOR_12 = 46;
const ROW_PAN_Y_LABEL = 47;
const ROW_PAN_Y_VALUE = 48;
const ROW_PAN_Y_SLIDER = 49;

// Total content height
const CONTENT_HEIGHT = 50;

// Column positions
const COL_TOGGLE = 2;
const COL_LABEL_START = 4;
const COL_BUTTON_START = 2;
const COL_EULER_LABEL = 2;
const COL_EULER_VALUE = 16;

function makeCameraControlModule(opts: CameraControlOptions): Module {
  let rect = opts.rect;
  
  // Scroll offset for when module is too short
  let scroll_offset = 0;
  
  // Track what we're dragging
  let is_dragging_slider: 'scale_per_layer' | 'movement_per_layer' | 'calibration_x' | 'calibration_y' | 'base_layer_scale' | 'char_spacing_x' | 'char_spacing_y' | 'pan_x' | 'pan_y' | null = null;
  
  // Colors
  const bgColor = get_color_by_name('off_black').rgb;
  const borderColor = get_color_by_name('medium_gray').rgb;
  const textColor = get_color_by_name('off_white').rgb;
  const labelColor = get_color_by_name('pale_gray').rgb;
  const enabledColor = get_color_by_name('vivid_green').rgb;
  const disabledColor = get_color_by_name('pale_gray').rgb;
  const buttonColor = get_color_by_name('deep_blue').rgb;
  const buttonActiveColor = get_color_by_name('vivid_cyan').rgb;
  const eulerColor = get_color_by_name('vivid_yellow').rgb;
  const accentColor = get_color_by_name('vivid_cyan').rgb;
  const sliderBgColor = get_color_by_name('dark_gray').rgb;
  const sliderFgColor = get_color_by_name('vivid_blue').rgb;
  
  // Gizmo configuration - enable resize
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.onClose,
    on_move: opts.onMove,
  };
  
  const gizmo_state: GizmoState = create_gizmo_state();
  
  // Button press states for visual feedback
  let pressedButtons = new Set<string>();
  
  // Get visible height accounting for scroll
  function get_visible_height(): number {
    return rect.y1 - rect.y0 - 1; // -1 for gizmo row
  }
  
  // Clamp scroll offset
  function clamp_scroll(): void {
    const max_scroll = Math.max(0, CONTENT_HEIGHT - get_visible_height());
    scroll_offset = Math.max(0, Math.min(max_scroll, scroll_offset));
  }
  
  // Check if a row is visible
  function is_row_visible(row: number): boolean {
    const visible_start = scroll_offset;
    const visible_end = scroll_offset + get_visible_height();
    return row >= visible_start && row <= visible_end;
  }
  
  // Get Y position on screen for a row
  function get_screen_y(row: number): number {
    return rect.y1 - 1 - (row - scroll_offset);
  }
  
  function drawToggle(c: Canvas, row: number, enabled: boolean, label: string): void {
    if (!is_row_visible(row)) return;
    const y = get_screen_y(row);
    const color = enabled ? enabledColor : disabledColor;
    const icon = enabled ? '👁' : '○';
    const x = COL_TOGGLE + rect.x0;
    
    c.set(x, y, { char: '[', rgb: borderColor, weight_index: 0, render_index: 10 });
    c.set(x + 1, y, { char: icon, rgb: color, weight_index: 4, render_index: 10 });
    c.set(x + 2, y, { char: ']', rgb: borderColor, weight_index: 0, render_index: 10 });
    
    for (let i = 0; i < label.length && x + 4 + i <= rect.x1 - 2; i++) {
      c.set(x + 4 + i, y, { char: label[i]!, rgb: textColor, weight_index: 0, render_index: 10 });
    }
  }
  
  function drawButton(c: Canvas, x: number, row: number, label: string, isActive: boolean, isPressed: boolean): void {
    if (!is_row_visible(row)) return;
    const y = get_screen_y(row);
    const bg = isPressed ? accentColor : (isActive ? buttonActiveColor : buttonColor);
    const fg = isActive ? get_color_by_name('off_black').rgb : textColor;
    
    c.set(x, y, { char: '[', rgb: borderColor, weight_index: 0, render_index: 10 });
    
    for (let i = 0; i < label.length && x + 1 + i < rect.x1 - 2; i++) {
      c.set(x + 1 + i, y, { 
        char: label[i]!, 
        rgb: fg, 
        weight_index: isActive ? 5 : 3, 
        render_index: 10,
        style: 'regular'
      });
    }
    
    c.set(x + 1 + label.length, y, { char: ']', rgb: borderColor, weight_index: 0, render_index: 10 });
  }
  
  function drawSeparator(c: Canvas, row: number): void {
    if (!is_row_visible(row)) return;
    const y = get_screen_y(row);
    for (let x = rect.x0 + 1; x < rect.x1; x++) {
      c.set(x, y, { char: '─', rgb: borderColor, weight_index: 0, render_index: 10 });
    }
  }
  
  function drawLabel(c: Canvas, row: number, text: string): void {
    if (!is_row_visible(row)) return;
    const y = get_screen_y(row);
    for (let i = 0; i < text.length && COL_LABEL_START + rect.x0 + i <= rect.x1 - 2; i++) {
      c.set(COL_LABEL_START + rect.x0 + i, y, { 
        char: text[i]!, 
        rgb: labelColor, 
        weight_index: 0, 
        render_index: 10 
      });
    }
  }
  
  function drawEulerControl(c: Canvas, row: number, axis: string, value: number): void {
    if (!is_row_visible(row)) return;
    const y = get_screen_y(row);
    
    // Label
    c.set(COL_EULER_LABEL + rect.x0, y, { char: axis, rgb: eulerColor, weight_index: 4, render_index: 10 });
    c.set(COL_EULER_LABEL + rect.x0 + 1, y, { char: ':', rgb: labelColor, weight_index: 0, render_index: 10 });
    
    // Decrease button
    const decPressed = pressedButtons.has(`euler_${axis}_dec`);
    const decColor = decPressed ? accentColor : buttonColor;
    c.set(COL_EULER_LABEL + rect.x0 + 3, y, { char: '[', rgb: borderColor, weight_index: 0, render_index: 10 });
    c.set(COL_EULER_LABEL + rect.x0 + 4, y, { char: '←', rgb: decColor, weight_index: 4, render_index: 10 });
    c.set(COL_EULER_LABEL + rect.x0 + 5, y, { char: ']', rgb: borderColor, weight_index: 0, render_index: 10 });
    
    // Increase button
    const incPressed = pressedButtons.has(`euler_${axis}_inc`);
    const incColor = incPressed ? accentColor : buttonColor;
    c.set(COL_EULER_LABEL + rect.x0 + 7, y, { char: '[', rgb: borderColor, weight_index: 0, render_index: 10 });
    c.set(COL_EULER_LABEL + rect.x0 + 8, y, { char: '→', rgb: incColor, weight_index: 4, render_index: 10 });
    c.set(COL_EULER_LABEL + rect.x0 + 9, y, { char: ']', rgb: borderColor, weight_index: 0, render_index: 10 });
    
    // Value display
    const valueStr = `${value}°`;
    const valueX = COL_EULER_VALUE + rect.x0;
    for (let i = 0; i < valueStr.length && valueX + i <= rect.x1 - 2; i++) {
      c.set(valueX + i, y, { char: valueStr[i]!, rgb: eulerColor, weight_index: 3, render_index: 10 });
    }
  }

  // Draw slider control with [-] <track> [+] pattern
  function drawSlider(c: Canvas, row: number, value: number, min: number, max: number, precision: number): void {
    if (!is_row_visible(row)) return;
    const y = get_screen_y(row);
    const minusPressed = pressedButtons.has('slider_minus');
    const plusPressed = pressedButtons.has('slider_plus');
    
    // Minus button
    c.set(rect.x0 + 2, y, { char: '[', rgb: borderColor, weight_index: 0, render_index: 10 });
    c.set(rect.x0 + 3, y, { char: '-', rgb: minusPressed ? accentColor : buttonColor, weight_index: 4, render_index: 10 });
    c.set(rect.x0 + 4, y, { char: ']', rgb: borderColor, weight_index: 0, render_index: 10 });
    
    // Track
    const trackStart = rect.x0 + 6;
    const trackEnd = rect.x1 - 5;
    const trackWidth = trackEnd - trackStart;
    const percent = (value - min) / (max - min);
    const fillWidth = Math.floor(percent * trackWidth);
    
    for (let x = trackStart; x <= trackEnd; x++) {
      const isFilled = x - trackStart < fillWidth;
      c.set(x, y, { 
        char: isFilled ? '█' : '░', 
        rgb: isFilled ? sliderFgColor : sliderBgColor, 
        weight_index: 2, 
        render_index: 10 
      });
    }
    
    // Plus button
    c.set(rect.x1 - 3, y, { char: '[', rgb: borderColor, weight_index: 0, render_index: 10 });
    c.set(rect.x1 - 2, y, { char: '+', rgb: plusPressed ? accentColor : buttonColor, weight_index: 4, render_index: 10 });
    c.set(rect.x1 - 1, y, { char: ']', rgb: borderColor, weight_index: 0, render_index: 10 });
  }

  // Get slider value from X position
  function get_slider_value(x: number, min: number, max: number): number {
    const trackStart = rect.x0 + 6;
    const trackEnd = rect.x1 - 5;
    const trackWidth = trackEnd - trackStart;
    const relativeX = Math.max(0, Math.min(trackWidth, x - trackStart));
    const percent = relativeX / trackWidth;
    return min + percent * (max - min);
  }
  
  // Check if position is on slider track (with small Y tolerance)
  function is_on_slider(x: number, y: number, row: number): boolean {
    if (!is_row_visible(row)) return false;
    const slider_y = get_screen_y(row);
    return Math.abs(y - slider_y) <= 1 && x >= rect.x0 + 6 && x <= rect.x1 - 5;
  }
  
  // Check if position is on minus button (with small Y tolerance)
  function is_on_minus(x: number, y: number, row: number): boolean {
    if (!is_row_visible(row)) return false;
    const slider_y = get_screen_y(row);
    return Math.abs(y - slider_y) <= 1 && x >= rect.x0 + 2 && x <= rect.x0 + 4;
  }

  // Check if position is on plus button (with small Y tolerance)
  function is_on_plus(x: number, y: number, row: number): boolean {
    if (!is_row_visible(row)) return false;
    const slider_y = get_screen_y(row);
    return Math.abs(y - slider_y) <= 1 && x >= rect.x1 - 3 && x <= rect.x1 - 1;
  }

  return {
    id: opts.id,
    get rect() { return rect; },
    set rect(newRect) { rect = newRect; clamp_scroll(); },
    Focusable: true,

    Draw(c: Canvas): void {
      clamp_scroll();
      
      // Background
      c.fill_rect(rect, { char: ' ', rgb: bgColor, weight_index: 0, render_index: 0 });
      
      // Border
      for (let x = rect.x0; x <= rect.x1; x++) {
        c.set(x, rect.y0, { char: '─', rgb: borderColor, weight_index: 0, render_index: 10 });
        c.set(x, rect.y1, { char: '─', rgb: borderColor, weight_index: 0, render_index: 10 });
      }
      for (let y = rect.y0; y <= rect.y1; y++) {
        c.set(rect.x0, y, { char: '│', rgb: borderColor, weight_index: 0, render_index: 10 });
        c.set(rect.x1, y, { char: '│', rgb: borderColor, weight_index: 0, render_index: 10 });
      }
      // Corners
      c.set(rect.x0, rect.y0, { char: '┌', rgb: borderColor, weight_index: 0, render_index: 10 });
      c.set(rect.x1, rect.y0, { char: '┐', rgb: borderColor, weight_index: 0, render_index: 10 });
      c.set(rect.x0, rect.y1, { char: '└', rgb: borderColor, weight_index: 0, render_index: 10 });
      c.set(rect.x1, rect.y1, { char: '┘', rgb: borderColor, weight_index: 0, render_index: 10 });
      
      const camera = opts.getSpace().camera;
      
      // Title
      if (is_row_visible(ROW_TITLE)) {
        const title = 'Camera';
        const titleX = rect.x0 + Math.floor((rect.x1 - rect.x0 - title.length) / 2);
        const y = get_screen_y(ROW_TITLE);
        for (let i = 0; i < title.length; i++) {
          c.set(titleX + i, y, { char: title[i]!, rgb: accentColor, weight_index: 5, render_index: 10 });
        }
      }
      
      drawSeparator(c, ROW_SEPARATOR_1);
      
      // Parallax toggles
      drawToggle(c, ROW_PARALLAX_MOVE, camera.parallax_move_enabled ?? false, 'Parallax Move');
      drawToggle(c, ROW_PARALLAX_SIZE, camera.parallax_size_enabled ?? false, 'Parallax Size');
      
      // Occlusion toggle
      const occlusionEnabled = !(camera.show_all_layers ?? true);
      drawToggle(c, ROW_OCCLUSION, occlusionEnabled, 'Voxel Occlusion');
      
      drawSeparator(c, ROW_SEPARATOR_2);
      
      // Orientation
      drawLabel(c, ROW_ORIENTATION_LABEL, '90° Views:');
      if (is_row_visible(ROW_ORIENTATION_BUTTONS)) {
        const y = get_screen_y(ROW_ORIENTATION_BUTTONS);
        const orientations: CameraOrientation[] = ['xy', 'yz', 'xz'];
        let btnX = COL_BUTTON_START + rect.x0;
        for (const orient of orientations) {
          const isActive = camera.orientation === orient;
          drawButton(c, btnX, ROW_ORIENTATION_BUTTONS, orient.toUpperCase(), isActive, false);
          btnX += 5;
        }
      }
      
      drawSeparator(c, ROW_SEPARATOR_3);
      
      // Euler rotation
      drawLabel(c, ROW_EULER_LABEL, 'Euler Rotate (±30°):');
      const euler = camera.euler_rotation ?? { x: 0, y: 0, z: 0 };
      drawEulerControl(c, ROW_EULER_X, 'X', euler.x);
      drawEulerControl(c, ROW_EULER_Y, 'Y', euler.y);
      drawEulerControl(c, ROW_EULER_Z, 'Z', euler.z);
      
      drawSeparator(c, ROW_SEPARATOR_4);
      
      // Pan reset button
      if (is_row_visible(ROW_PAN_RESET)) {
        const y = get_screen_y(ROW_PAN_RESET);
        const resetPressed = pressedButtons.has('pan_reset');
        const resetX = rect.x0 + Math.floor((rect.x1 - rect.x0 - 10) / 2);
        const resetColor = resetPressed ? accentColor : buttonColor;
        c.set(resetX, y, { char: '[', rgb: borderColor, weight_index: 0, render_index: 10 });
        c.set(resetX + 1, y, { char: 'P', rgb: resetColor, weight_index: 4, render_index: 10 });
        c.set(resetX + 2, y, { char: 'a', rgb: resetColor, weight_index: 4, render_index: 10 });
        c.set(resetX + 3, y, { char: 'n', rgb: resetColor, weight_index: 4, render_index: 10 });
        c.set(resetX + 4, y, { char: ' ', rgb: resetColor, weight_index: 4, render_index: 10 });
        c.set(resetX + 5, y, { char: 'R', rgb: resetColor, weight_index: 4, render_index: 10 });
        c.set(resetX + 6, y, { char: 'e', rgb: resetColor, weight_index: 4, render_index: 10 });
        c.set(resetX + 7, y, { char: 's', rgb: resetColor, weight_index: 4, render_index: 10 });
        c.set(resetX + 8, y, { char: 'e', rgb: resetColor, weight_index: 4, render_index: 10 });
        c.set(resetX + 9, y, { char: 't', rgb: resetColor, weight_index: 4, render_index: 10 });
        c.set(resetX + 10, y, { char: ']', rgb: borderColor, weight_index: 0, render_index: 10 });
      }
      
      drawSeparator(c, ROW_SEPARATOR_5);
      
      // Calibration with slider controls
      drawLabel(c, ROW_CALIBRATION_LABEL, 'Calibration:');
      
      // X calibration value (-500 to +500 pixels)
      if (is_row_visible(ROW_CALIBRATION_X_VALUE)) {
        const cal = camera.calibration ?? DEFAULT_CAMERA_VALUES.calibration;
        const y = get_screen_y(ROW_CALIBRATION_X_VALUE);
        const valueStr = `X:${Math.round(cal.x)}`;
        const valueX = rect.x0 + Math.floor((rect.x1 - rect.x0 - valueStr.length) / 2);
        for (let i = 0; i < valueStr.length; i++) {
          c.set(valueX + i, y, { char: valueStr[i]!, rgb: eulerColor, weight_index: 3, render_index: 10 });
        }
      }
      
      drawSlider(c, ROW_CALIBRATION_X_SLIDER, (camera.calibration ?? DEFAULT_CAMERA_VALUES.calibration).x, -500, 500, 1);
      
      // Y calibration value (-500 to +500 pixels)
      if (is_row_visible(ROW_CALIBRATION_Y_VALUE)) {
        const cal = camera.calibration ?? DEFAULT_CAMERA_VALUES.calibration;
        const y = get_screen_y(ROW_CALIBRATION_Y_VALUE);
        const valueStr = `Y:${Math.round(cal.y)}`;
        const valueX = rect.x0 + Math.floor((rect.x1 - rect.x0 - valueStr.length) / 2);
        for (let i = 0; i < valueStr.length; i++) {
          c.set(valueX + i, y, { char: valueStr[i]!, rgb: eulerColor, weight_index: 3, render_index: 10 });
        }
      }
      
      drawSlider(c, ROW_CALIBRATION_Y_SLIDER, (camera.calibration ?? DEFAULT_CAMERA_VALUES.calibration).y, -500, 500, 1);
      
      drawSeparator(c, ROW_SEPARATOR_6);
      
      // Scale per layer with slider
      drawLabel(c, ROW_LAYER_SCALE_LABEL, 'Scale/Layer:');
      
      if (is_row_visible(ROW_LAYER_SCALE)) {
        const y = get_screen_y(ROW_LAYER_SCALE);
        const valueStr = (camera.scale_per_layer ?? 0.12).toFixed(2);
        // Value display centered
        const valueX = rect.x0 + Math.floor((rect.x1 - rect.x0 - valueStr.length) / 2);
        for (let i = 0; i < valueStr.length; i++) {
          c.set(valueX + i, y, { char: valueStr[i]!, rgb: eulerColor, weight_index: 3, render_index: 10 });
        }
      }
      
      drawSlider(c, ROW_LAYER_SCALE_SLIDER, camera.scale_per_layer ?? 0.12, -1.0, 1.0, 0.01);
      
      drawSeparator(c, ROW_SEPARATOR_7);
      
      // Movement per layer with slider
      drawLabel(c, ROW_LAYER_MOVE_LABEL, 'Move/Layer:');
      
      if (is_row_visible(ROW_LAYER_MOVE)) {
        const y = get_screen_y(ROW_LAYER_MOVE);
        const valueStr = Math.round(camera.movement_per_layer ?? DEFAULT_CAMERA_VALUES.movement_per_layer).toString();
        // Value display centered
        const valueX = rect.x0 + Math.floor((rect.x1 - rect.x0 - valueStr.length) / 2);
        for (let i = 0; i < valueStr.length; i++) {
          c.set(valueX + i, y, { char: valueStr[i]!, rgb: eulerColor, weight_index: 3, render_index: 10 });
        }
      }
      
      drawSlider(c, ROW_LAYER_MOVE_SLIDER, camera.movement_per_layer ?? DEFAULT_CAMERA_VALUES.movement_per_layer, -500, 500, 1);
      
      drawSeparator(c, ROW_SEPARATOR_8);
      
      // Base Layer Scale
      drawLabel(c, ROW_BASE_SCALE_LABEL, 'Base Scale:');
      
      if (is_row_visible(ROW_BASE_SCALE)) {
        const y = get_screen_y(ROW_BASE_SCALE);
        const valueStr = (camera.base_layer_scale ?? DEFAULT_CAMERA_VALUES.base_layer_scale).toFixed(2);
        const valueX = rect.x0 + Math.floor((rect.x1 - rect.x0 - valueStr.length) / 2);
        for (let i = 0; i < valueStr.length; i++) {
          c.set(valueX + i, y, { char: valueStr[i]!, rgb: eulerColor, weight_index: 3, render_index: 10 });
        }
      }
      
      drawSlider(c, ROW_BASE_SCALE_SLIDER, camera.base_layer_scale ?? DEFAULT_CAMERA_VALUES.base_layer_scale, 0.2, 1.5, 0.01);
      
      drawSeparator(c, ROW_SEPARATOR_9);
      
      // Char Spacing X
      drawLabel(c, ROW_CHAR_SPACING_X_LABEL, 'Char Spacing X:');
      
      if (is_row_visible(ROW_CHAR_SPACING_X)) {
        const y = get_screen_y(ROW_CHAR_SPACING_X);
        const valueStr = (camera.char_spacing_x ?? DEFAULT_CAMERA_VALUES.char_spacing_x).toFixed(2);
        const valueX = rect.x0 + Math.floor((rect.x1 - rect.x0 - valueStr.length) / 2);
        for (let i = 0; i < valueStr.length; i++) {
          c.set(valueX + i, y, { char: valueStr[i]!, rgb: eulerColor, weight_index: 3, render_index: 10 });
        }
      }
      
      drawSlider(c, ROW_CHAR_SPACING_X_SLIDER, camera.char_spacing_x ?? DEFAULT_CAMERA_VALUES.char_spacing_x, 0.5, 2.0, 0.01);
      
      drawSeparator(c, ROW_SEPARATOR_10);
      
      // Char Spacing Y
      drawLabel(c, ROW_CHAR_SPACING_Y_LABEL, 'Char Spacing Y:');
      
      if (is_row_visible(ROW_CHAR_SPACING_Y)) {
        const y = get_screen_y(ROW_CHAR_SPACING_Y);
        const valueStr = (camera.char_spacing_y ?? DEFAULT_CAMERA_VALUES.char_spacing_y).toFixed(2);
        const valueX = rect.x0 + Math.floor((rect.x1 - rect.x0 - valueStr.length) / 2);
        for (let i = 0; i < valueStr.length; i++) {
          c.set(valueX + i, y, { char: valueStr[i]!, rgb: eulerColor, weight_index: 3, render_index: 10 });
        }
      }
      
      drawSlider(c, ROW_CHAR_SPACING_Y_SLIDER, camera.char_spacing_y ?? DEFAULT_CAMERA_VALUES.char_spacing_y, 0.5, 2.0, 0.01);
      
      drawSeparator(c, ROW_SEPARATOR_11);
      
      // Pan X
      drawLabel(c, ROW_PAN_X_LABEL, 'Pan X:');
      
      if (is_row_visible(ROW_PAN_X_VALUE)) {
        const y = get_screen_y(ROW_PAN_X_VALUE);
        const valueStr = Math.round(camera.pan_x ?? DEFAULT_CAMERA_VALUES.pan_x).toString();
        const valueX = rect.x0 + Math.floor((rect.x1 - rect.x0 - valueStr.length) / 2);
        for (let i = 0; i < valueStr.length; i++) {
          c.set(valueX + i, y, { char: valueStr[i]!, rgb: eulerColor, weight_index: 3, render_index: 10 });
        }
      }
      
      drawSlider(c, ROW_PAN_X_SLIDER, camera.pan_x ?? DEFAULT_CAMERA_VALUES.pan_x, -100, 100, 1);
      
      drawSeparator(c, ROW_SEPARATOR_12);
      
      // Pan Y
      drawLabel(c, ROW_PAN_Y_LABEL, 'Pan Y:');
      
      if (is_row_visible(ROW_PAN_Y_VALUE)) {
        const y = get_screen_y(ROW_PAN_Y_VALUE);
        const valueStr = Math.round(camera.pan_y ?? DEFAULT_CAMERA_VALUES.pan_y).toString();
        const valueX = rect.x0 + Math.floor((rect.x1 - rect.x0 - valueStr.length) / 2);
        for (let i = 0; i < valueStr.length; i++) {
          c.set(valueX + i, y, { char: valueStr[i]!, rgb: eulerColor, weight_index: 3, render_index: 10 });
        }
      }
      
      drawSlider(c, ROW_PAN_Y_SLIDER, camera.pan_y ?? DEFAULT_CAMERA_VALUES.pan_y, -100, 100, 1);
      
      // Draw gizmos
      draw_module_gizmos(c, rect, gizmo_config, gizmo_state, 'Camera');
      
      // Draw scroll indicator if needed
      const max_scroll = Math.max(0, CONTENT_HEIGHT - get_visible_height());
      if (max_scroll > 0 && is_row_visible(Math.floor(scroll_offset + get_visible_height() / 2))) {
        const indicatorY = get_screen_y(Math.floor(scroll_offset + get_visible_height() / 2));
        const scrollPercent = scroll_offset / max_scroll;
        const indicatorChar = scrollPercent < 0.33 ? '▲' : scrollPercent > 0.66 ? '▼' : '◆';
        c.set(rect.x1 - 1, indicatorY, {
          char: indicatorChar,
          rgb: accentColor,
          weight_index: 5,
          render_index: 10
        });
      }
    },
    
    OnPointerDown(e: PointerEvent): void {
      // Clear any stuck slider state first
      if (is_dragging_slider !== null) {
        is_dragging_slider = null;
      }
      
      // Check gizmo area first
      if (is_in_gizmo_area(e.x, e.y, rect)) {
        const gizmo = handle_gizmo_click(e.x, e.y, rect, gizmo_config, gizmo_state);
        if (gizmo === 'move') {
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
        }
        if (gizmo === 'close') {
          opts.onClose?.();
        }
        return;
      }
      
      // Check if clicking on resize border when in resize mode
      if (gizmo_state.is_resize_mode) {
        const edge = get_resize_edge(e.x, e.y, rect);
        if (edge) {
          gizmo_state.resize_edge = edge;
          gizmo_state.is_dragging_resize = true;
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
          gizmo_state.original_rect = { ...rect };
          return;
        }
      }
      
      // Handle move mode
      if (gizmo_state.is_move_mode) {
        gizmo_state.move_start_x = e.x;
        gizmo_state.move_start_y = e.y;
        return;
      }
      
      // Check slider track interactions (drag mode)
      if (is_on_slider(e.x, e.y, ROW_LAYER_SCALE_SLIDER)) {
        is_dragging_slider = 'scale_per_layer';
        const newValue = get_slider_value(e.x, -1.0, 1.0);
        opts.getSpace().camera.scale_per_layer = Math.max(-1.0, Math.min(1.0, Math.round(newValue * 100) / 100));
        opts.onScalePerLayerChange?.(opts.getSpace().camera.scale_per_layer);
        return;
      }
      
      if (is_on_slider(e.x, e.y, ROW_LAYER_MOVE_SLIDER)) {
        is_dragging_slider = 'movement_per_layer';
        const newValue = get_slider_value(e.x, -500, 500);
        opts.getSpace().camera.movement_per_layer = Math.max(-500, Math.min(500, Math.round(newValue)));
        opts.onMovementPerLayerChange?.(opts.getSpace().camera.movement_per_layer);
        return;
      }
      
      // Check slider buttons
      if (is_on_minus(e.x, e.y, ROW_LAYER_SCALE_SLIDER)) {
        const current = opts.getSpace().camera.scale_per_layer ?? 0.12;
        opts.getSpace().camera.scale_per_layer = Math.max(-1.0, current - 0.01);
        opts.onScalePerLayerChange?.(opts.getSpace().camera.scale_per_layer);
        pressedButtons.add('slider_minus');
        return;
      }
      
      if (is_on_plus(e.x, e.y, ROW_LAYER_SCALE_SLIDER)) {
        const current = opts.getSpace().camera.scale_per_layer ?? 0.12;
        opts.getSpace().camera.scale_per_layer = Math.min(1.0, current + 0.01);
        opts.onScalePerLayerChange?.(opts.getSpace().camera.scale_per_layer);
        pressedButtons.add('slider_plus');
        return;
      }
      
      if (is_on_minus(e.x, e.y, ROW_LAYER_MOVE_SLIDER)) {
        const current = opts.getSpace().camera.movement_per_layer ?? DEFAULT_CAMERA_VALUES.movement_per_layer;
        opts.getSpace().camera.movement_per_layer = Math.max(-500, current - 5);
        opts.onMovementPerLayerChange?.(opts.getSpace().camera.movement_per_layer);
        pressedButtons.add('slider_minus');
        return;
      }
      
      if (is_on_plus(e.x, e.y, ROW_LAYER_MOVE_SLIDER)) {
        const current = opts.getSpace().camera.movement_per_layer ?? DEFAULT_CAMERA_VALUES.movement_per_layer;
        opts.getSpace().camera.movement_per_layer = Math.min(500, current + 5);
        opts.onMovementPerLayerChange?.(opts.getSpace().camera.movement_per_layer);
        pressedButtons.add('slider_plus');
        return;
      }
      
      // Check Base Layer Scale slider
      if (is_on_slider(e.x, e.y, ROW_BASE_SCALE_SLIDER)) {
        is_dragging_slider = 'base_layer_scale';
        const newValue = get_slider_value(e.x, 0.2, 1.5);
        opts.getSpace().camera.base_layer_scale = Math.max(0.2, Math.min(1.5, Math.round(newValue * 100) / 100));
        opts.onBaseLayerScaleChange?.(opts.getSpace().camera.base_layer_scale);
        return;
      }

      if (is_on_minus(e.x, e.y, ROW_BASE_SCALE_SLIDER)) {
        const current = opts.getSpace().camera.base_layer_scale ?? DEFAULT_CAMERA_VALUES.base_layer_scale;
        opts.getSpace().camera.base_layer_scale = Math.max(0.2, current - 0.01);
        opts.onBaseLayerScaleChange?.(opts.getSpace().camera.base_layer_scale);
        pressedButtons.add('slider_minus');
        return;
      }

      if (is_on_plus(e.x, e.y, ROW_BASE_SCALE_SLIDER)) {
        const current = opts.getSpace().camera.base_layer_scale ?? DEFAULT_CAMERA_VALUES.base_layer_scale;
        opts.getSpace().camera.base_layer_scale = Math.min(1.5, current + 0.01);
        opts.onBaseLayerScaleChange?.(opts.getSpace().camera.base_layer_scale);
        pressedButtons.add('slider_plus');
        return;
      }

      // Check Char Spacing X slider
      if (is_on_slider(e.x, e.y, ROW_CHAR_SPACING_X_SLIDER)) {
        is_dragging_slider = 'char_spacing_x';
        const newValue = get_slider_value(e.x, 0.5, 2.0);
        opts.getSpace().camera.char_spacing_x = Math.max(0.5, Math.min(2.0, Math.round(newValue * 100) / 100));
        opts.onCharSpacingXChange?.(opts.getSpace().camera.char_spacing_x);
        return;
      }
      
      if (is_on_minus(e.x, e.y, ROW_CHAR_SPACING_X_SLIDER)) {
        const current = opts.getSpace().camera.char_spacing_x ?? DEFAULT_CAMERA_VALUES.char_spacing_x;
        opts.getSpace().camera.char_spacing_x = Math.max(0.5, current - 0.01);
        opts.onCharSpacingXChange?.(opts.getSpace().camera.char_spacing_x);
        pressedButtons.add('slider_minus');
        return;
      }

      if (is_on_plus(e.x, e.y, ROW_CHAR_SPACING_X_SLIDER)) {
        const current = opts.getSpace().camera.char_spacing_x ?? DEFAULT_CAMERA_VALUES.char_spacing_x;
        opts.getSpace().camera.char_spacing_x = Math.min(2.0, current + 0.01);
        opts.onCharSpacingXChange?.(opts.getSpace().camera.char_spacing_x);
        pressedButtons.add('slider_plus');
        return;
      }

      // Check Char Spacing Y slider
      if (is_on_slider(e.x, e.y, ROW_CHAR_SPACING_Y_SLIDER)) {
        is_dragging_slider = 'char_spacing_y';
        const newValue = get_slider_value(e.x, 0.5, 2.0);
        opts.getSpace().camera.char_spacing_y = Math.max(0.5, Math.min(2.0, Math.round(newValue * 100) / 100));
        opts.onCharSpacingYChange?.(opts.getSpace().camera.char_spacing_y);
        return;
      }

      if (is_on_minus(e.x, e.y, ROW_CHAR_SPACING_Y_SLIDER)) {
        const current = opts.getSpace().camera.char_spacing_y ?? DEFAULT_CAMERA_VALUES.char_spacing_y;
        opts.getSpace().camera.char_spacing_y = Math.max(0.5, current - 0.01);
        opts.onCharSpacingYChange?.(opts.getSpace().camera.char_spacing_y);
        pressedButtons.add('slider_minus');
        return;
      }

      if (is_on_plus(e.x, e.y, ROW_CHAR_SPACING_Y_SLIDER)) {
        const current = opts.getSpace().camera.char_spacing_y ?? DEFAULT_CAMERA_VALUES.char_spacing_y;
        opts.getSpace().camera.char_spacing_y = Math.min(2.0, current + 0.01);
        opts.onCharSpacingYChange?.(opts.getSpace().camera.char_spacing_y);
        pressedButtons.add('slider_plus');
        return;
      }

      // Check Pan X slider
      if (is_on_slider(e.x, e.y, ROW_PAN_X_SLIDER)) {
        is_dragging_slider = 'pan_x';
        const newValue = get_slider_value(e.x, -100, 100);
        const clampedValue = Math.max(-100, Math.min(100, Math.round(newValue)));
        opts.onPanXChange?.(clampedValue);
        return;
      }

      if (is_on_minus(e.x, e.y, ROW_PAN_X_SLIDER)) {
        const current = opts.getSpace().camera.pan_x ?? DEFAULT_CAMERA_VALUES.pan_x;
        const newValue = Math.max(-100, current - 1);
        opts.onPanXChange?.(newValue);
        pressedButtons.add('slider_minus');
        return;
      }

      if (is_on_plus(e.x, e.y, ROW_PAN_X_SLIDER)) {
        const current = opts.getSpace().camera.pan_x ?? DEFAULT_CAMERA_VALUES.pan_x;
        const newValue = Math.min(100, current + 1);
        opts.onPanXChange?.(newValue);
        pressedButtons.add('slider_plus');
        return;
      }

      // Check Pan Y slider
      if (is_on_slider(e.x, e.y, ROW_PAN_Y_SLIDER)) {
        is_dragging_slider = 'pan_y';
        const newValue = get_slider_value(e.x, -100, 100);
        const clampedValue = Math.max(-100, Math.min(100, Math.round(newValue)));
        opts.onPanYChange?.(clampedValue);
        return;
      }

      if (is_on_minus(e.x, e.y, ROW_PAN_Y_SLIDER)) {
        const current = opts.getSpace().camera.pan_y ?? DEFAULT_CAMERA_VALUES.pan_y;
        const newValue = Math.max(-100, current - 1);
        opts.onPanYChange?.(newValue);
        pressedButtons.add('slider_minus');
        return;
      }

      if (is_on_plus(e.x, e.y, ROW_PAN_Y_SLIDER)) {
        const current = opts.getSpace().camera.pan_y ?? DEFAULT_CAMERA_VALUES.pan_y;
        const newValue = Math.min(100, current + 1);
        opts.onPanYChange?.(newValue);
        pressedButtons.add('slider_plus');
        return;
      }

      // Convert to local coordinates
      const localX = e.x - rect.x0;
      const localY = rect.y1 - e.y + scroll_offset; // Account for scroll
      const camera = opts.getSpace().camera;
      
      // Check toggles
      if (localY === ROW_PARALLAX_MOVE && localX >= COL_TOGGLE && localX <= COL_TOGGLE + 2) {
        const newValue = !(camera.parallax_move_enabled ?? false);
        camera.parallax_move_enabled = newValue;
        opts.onParallaxMoveToggle?.(newValue);
        pressedButtons.add('parallax_move');
        return;
      }
      
      if (localY === ROW_PARALLAX_SIZE && localX >= COL_TOGGLE && localX <= COL_TOGGLE + 2) {
        const newValue = !(camera.parallax_size_enabled ?? false);
        camera.parallax_size_enabled = newValue;
        opts.onParallaxSizeToggle?.(newValue);
        pressedButtons.add('parallax_size');
        return;
      }
      
      if (localY === ROW_OCCLUSION && localX >= COL_TOGGLE && localX <= COL_TOGGLE + 2) {
        const currentOcclusionEnabled = !(camera.show_all_layers ?? true);
        const newOcclusionEnabled = !currentOcclusionEnabled;
        camera.show_all_layers = !newOcclusionEnabled;
        opts.onOcclusionToggle?.(newOcclusionEnabled);
        pressedButtons.add('occlusion');
        return;
      }
      
      // Check orientation buttons
      if (localY === ROW_ORIENTATION_BUTTONS) {
        const orientations: CameraOrientation[] = ['xy', 'yz', 'xz'];
        let btnX = COL_BUTTON_START;
        for (const orient of orientations) {
          if (localX >= btnX && localX <= btnX + 3) {
            camera.orientation = orient;
            opts.onOrientationChange?.(orient);
            pressedButtons.add(`orient_${orient}`);
            return;
          }
          btnX += 5;
        }
      }
      
      // Check Euler rotation buttons
      const eulerRows = [
        { row: ROW_EULER_X, axis: 'x' as const },
        { row: ROW_EULER_Y, axis: 'y' as const },
        { row: ROW_EULER_Z, axis: 'z' as const },
      ];
      
      for (const { row, axis } of eulerRows) {
        if (localY === row) {
          if (localX >= COL_EULER_LABEL + 3 && localX <= COL_EULER_LABEL + 5) {
            const euler = camera.euler_rotation ?? { x: 0, y: 0, z: 0 };
            const newValue = Math.max(-30, euler[axis] - 5);
            euler[axis] = newValue;
            camera.euler_rotation = euler;
            opts.onEulerRotate?.(axis, newValue);
            pressedButtons.add(`euler_${axis}_dec`);
            return;
          }
          if (localX >= COL_EULER_LABEL + 7 && localX <= COL_EULER_LABEL + 9) {
            const euler = camera.euler_rotation ?? { x: 0, y: 0, z: 0 };
            const newValue = Math.min(30, euler[axis] + 5);
            euler[axis] = newValue;
            camera.euler_rotation = euler;
            opts.onEulerRotate?.(axis, newValue);
            pressedButtons.add(`euler_${axis}_inc`);
            return;
          }
        }
      }
      
      // Check Pan Reset button
      if (localY === ROW_PAN_RESET) {
        const resetX = Math.floor((rect.x1 - rect.x0 - 10) / 2);
        if (localX >= resetX && localX <= resetX + 10) {
          opts.onPanReset?.();
          opts.onCalibrationReset?.();
          pressedButtons.add('pan_reset');
          return;
        }
      }
      
      // Check Calibration X slider (-500 to +500 pixels)
      if (is_on_slider(e.x, e.y, ROW_CALIBRATION_X_SLIDER)) {
        is_dragging_slider = 'calibration_x';
        const newValue = get_slider_value(e.x, -500, 500);
        const cal = camera.calibration ?? DEFAULT_CAMERA_VALUES.calibration;
        camera.calibration = { x: Math.round(newValue), y: cal.y };
        opts.onCalibrationChange?.(camera.calibration.x, camera.calibration.y);
        return;
      }
      
      if (is_on_minus(e.x, e.y, ROW_CALIBRATION_X_SLIDER)) {
        const cal = camera.calibration ?? DEFAULT_CAMERA_VALUES.calibration;
        camera.calibration = { x: Math.max(-500, cal.x - 1), y: cal.y };
        opts.onCalibrationChange?.(camera.calibration.x, camera.calibration.y);
        pressedButtons.add('slider_minus');
        return;
      }
      
      if (is_on_plus(e.x, e.y, ROW_CALIBRATION_X_SLIDER)) {
        const cal = camera.calibration ?? DEFAULT_CAMERA_VALUES.calibration;
        camera.calibration = { x: Math.min(500, cal.x + 1), y: cal.y };
        opts.onCalibrationChange?.(camera.calibration.x, camera.calibration.y);
        pressedButtons.add('slider_plus');
        return;
      }
      
      // Check Calibration Y slider (-500 to +500 pixels)
      if (is_on_slider(e.x, e.y, ROW_CALIBRATION_Y_SLIDER)) {
        is_dragging_slider = 'calibration_y';
        const newValue = get_slider_value(e.x, -500, 500);
        const cal = camera.calibration ?? DEFAULT_CAMERA_VALUES.calibration;
        camera.calibration = { x: cal.x, y: Math.round(newValue) };
        opts.onCalibrationChange?.(camera.calibration.x, camera.calibration.y);
        return;
      }
      
      if (is_on_minus(e.x, e.y, ROW_CALIBRATION_Y_SLIDER)) {
        const cal = camera.calibration ?? DEFAULT_CAMERA_VALUES.calibration;
        camera.calibration = { x: cal.x, y: Math.max(-500, cal.y - 1) };
        opts.onCalibrationChange?.(camera.calibration.x, camera.calibration.y);
        pressedButtons.add('slider_minus');
        return;
      }
      
      if (is_on_plus(e.x, e.y, ROW_CALIBRATION_Y_SLIDER)) {
        const cal = camera.calibration ?? DEFAULT_CAMERA_VALUES.calibration;
        camera.calibration = { x: cal.x, y: Math.min(500, cal.y + 1) };
        opts.onCalibrationChange?.(camera.calibration.x, camera.calibration.y);
        pressedButtons.add('slider_plus');
        return;
      }
    },
    
    OnPointerMove(e: PointerEvent): void {
      // Handle slider dragging - only update if actually dragging
      if (is_dragging_slider === 'scale_per_layer') {
        const newValue = get_slider_value(e.x, -1.0, 1.0);
        opts.getSpace().camera.scale_per_layer = Math.max(-1.0, Math.min(1.0, Math.round(newValue * 100) / 100));
        opts.onScalePerLayerChange?.(opts.getSpace().camera.scale_per_layer);
        return;
      }
      
      if (is_dragging_slider === 'movement_per_layer') {
        const newValue = get_slider_value(e.x, -500, 500);
        opts.getSpace().camera.movement_per_layer = Math.max(-500, Math.min(500, Math.round(newValue)));
        opts.onMovementPerLayerChange?.(opts.getSpace().camera.movement_per_layer);
        return;
      }
      
      if (is_dragging_slider === 'calibration_x') {
        const newValue = get_slider_value(e.x, -500, 500);
        const cal = opts.getSpace().camera.calibration ?? DEFAULT_CAMERA_VALUES.calibration;
        opts.getSpace().camera.calibration = { x: Math.round(newValue), y: cal.y };
        opts.onCalibrationChange?.(opts.getSpace().camera.calibration.x, opts.getSpace().camera.calibration.y);
        return;
      }
      
      if (is_dragging_slider === 'calibration_y') {
        const newValue = get_slider_value(e.x, -500, 500);
        const cal = opts.getSpace().camera.calibration ?? DEFAULT_CAMERA_VALUES.calibration;
        opts.getSpace().camera.calibration = { x: cal.x, y: Math.round(newValue) };
        opts.onCalibrationChange?.(opts.getSpace().camera.calibration.x, opts.getSpace().camera.calibration.y);
        return;
      }
      
      if (is_dragging_slider === 'base_layer_scale') {
        const newValue = get_slider_value(e.x, 0.2, 1.5);
        opts.getSpace().camera.base_layer_scale = Math.max(0.2, Math.min(1.5, Math.round(newValue * 100) / 100));
        opts.onBaseLayerScaleChange?.(opts.getSpace().camera.base_layer_scale);
        return;
      }

      if (is_dragging_slider === 'char_spacing_x') {
        const newValue = get_slider_value(e.x, 0.5, 2.0);
        opts.getSpace().camera.char_spacing_x = Math.max(0.5, Math.min(2.0, Math.round(newValue * 100) / 100));
        opts.onCharSpacingXChange?.(opts.getSpace().camera.char_spacing_x);
        return;
      }

      if (is_dragging_slider === 'char_spacing_y') {
        const newValue = get_slider_value(e.x, 0.5, 2.0);
        opts.getSpace().camera.char_spacing_y = Math.max(0.5, Math.min(2.0, Math.round(newValue * 100) / 100));
        opts.onCharSpacingYChange?.(opts.getSpace().camera.char_spacing_y);
        return;
      }

      if (is_dragging_slider === 'pan_x') {
        const newValue = get_slider_value(e.x, -100, 100);
        const clampedValue = Math.max(-100, Math.min(100, Math.round(newValue)));
        opts.onPanXChange?.(clampedValue);
        return;
      }

      if (is_dragging_slider === 'pan_y') {
        const newValue = get_slider_value(e.x, -100, 100);
        const clampedValue = Math.max(-100, Math.min(100, Math.round(newValue)));
        opts.onPanYChange?.(clampedValue);
        return;
      }

      // Update resize edge hover state
      if (gizmo_state.is_resize_mode && !gizmo_state.is_dragging_resize) {
        gizmo_state.resize_edge = get_resize_edge(e.x, e.y, rect);
      }
    },
    
    OnPointerUp(e: PointerEvent): void {
      pressedButtons.clear();
      is_dragging_slider = null;
      
      // Finalize move
      if (gizmo_state.is_move_mode) {
        gizmo_state.is_move_mode = false;
        opts.onMove?.(rect);
      }
      
      // Finalize resize
      if (gizmo_state.is_dragging_resize) {
        gizmo_state.is_dragging_resize = false;
        gizmo_state.resize_edge = null;
        opts.onResize?.(rect);
      }
    },
    
    OnDragMove(e: DragEvent): void {
      // Handle move mode dragging
      if (gizmo_state.is_move_mode && gizmo_state.original_rect) {
        const dx = e.x - gizmo_state.move_start_x;
        const dy = e.y - gizmo_state.move_start_y;

        rect = {
          x0: gizmo_state.original_rect.x0 + dx,
          y0: gizmo_state.original_rect.y0 + dy,
          x1: gizmo_state.original_rect.x1 + dx,
          y1: gizmo_state.original_rect.y1 + dy,
        };
        return;
      }
      
      // Handle resize dragging
      if (gizmo_state.is_resize_mode && gizmo_state.is_dragging_resize && gizmo_state.original_rect) {
        const new_rect = handle_resize_drag(
          e.x,
          e.y,
          gizmo_state,
          gizmo_state.original_rect,
          MIN_WIDTH,
          MIN_HEIGHT,
          MAX_WIDTH,
          MAX_HEIGHT,
          (newRect) => {
            rect = newRect;
          }
        );
        if (new_rect) {
          rect = new_rect;
        }
        return;
      }
    },
    
    OnWheel(e: WheelEvent): void {
      scroll_offset += e.delta_y > 0 ? 1 : -1;
      clamp_scroll();
    },
  };
}

export { makeCameraControlModule };
