/**
 * Tool Properties Module
 * 
 * A floating module showing properties for the currently selected tool.
 * For brush tools, shows brush tip size slider (1x1 to 5x5).
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import { draw_module_border, BORDER_STYLES } from '../module_borders.js';
import type { ModuleGizmosConfig, GizmoState } from '../module_gizmos.js';
import { draw_module_gizmos, handle_gizmo_click, create_gizmo_state, is_in_gizmo_area, get_resize_edge, handle_resize_drag, handle_global_pointer_down_for_gizmos } from '../module_gizmos.js';
import type { ToolType } from '../../ascii_painter/types.js';
import type { SelectionMode } from '../../ascii_painter/selection.js';
import type { GradiatorState, GradiatorSlot } from '../../ascii_painter/gradiator.js';

export type ToolPropertiesOptions = {
  id: string;
  rect: Rect;
  get_current_tool: () => ToolType;
  get_brush_size: () => number; // 1-5
  on_brush_size_change: (size: number) => void;
  get_space_replace: () => boolean;
  on_space_replace_change: (replace: boolean) => void;
  // Text tool options
  get_text_spacing: () => number;
  on_text_spacing_change: (spacing: number) => void;
  get_text_charlead: () => number;
  on_text_charlead_change: (charlead: number) => void;
  get_text_enterlead: () => number;
  on_text_enterlead_change: (enterlead: number) => void;
  get_text_enterspace: () => number;
  on_text_enterspace_change: (enterspace: number) => void;
  // Selection mode
  get_selection_mode: () => SelectionMode;
  on_selection_mode_change: (mode: SelectionMode) => void;
  // Paste options
  get_paste_space_replace: () => boolean;
  on_paste_space_replace_change: (replace: boolean) => void;
  get_paste_scale: () => number; // 0.1 to 3.0
  on_paste_scale_change: (scale: number) => void;
  // Paste ignore options
  get_paste_ignore_space: () => boolean;
  on_paste_ignore_space_change: (ignore: boolean) => void;
  get_paste_ignore_black: () => boolean;
  on_paste_ignore_black_change: (ignore: boolean) => void;
  get_paste_ignore_white: () => boolean;
  on_paste_ignore_white_change: (ignore: boolean) => void;
  get_paste_ignore_color: () => boolean;
  on_paste_ignore_color_change: (ignore: boolean) => void;
  get_paste_ignore_color_rgb: () => { r: number; g: number; b: number };
  on_paste_ignore_color_select: () => void;
  // Gradiator options
  get_gradiator_state: () => GradiatorState;
  on_gradiator_slot_select: (slot: GradiatorSlot) => void;
  on_gradiator_char_select: (slot: GradiatorSlot, x: number) => void;
  on_gradiator_add_char: (slot: GradiatorSlot) => void;
  on_gradiator_remove_char: (slot: GradiatorSlot) => void;
  on_gradiator_char_set: (slot: GradiatorSlot, x: number, char: string) => void;
  // Selection controls
  on_selection_clear?: () => void;
  on_selection_invert?: () => void;
  on_selection_all?: () => void;
  on_move?: (new_rect: Rect) => void;
  on_resize?: (new_rect: Rect) => void;
  on_close?: () => void;
};

const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 5;
const SIZE_LABELS = ['1x1', '2x2', '3x3', '4x4', '5x5'];

// Size constraints
const MIN_WIDTH = 16;
const MAX_WIDTH = 25;
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 24;

export function make_tool_properties_module(opts: ToolPropertiesOptions): Module {
  let rect = opts.rect;
  
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };
  
  const gizmo_state: GizmoState = create_gizmo_state();
  let is_dragging_slider = false;
  let is_dragging_scale = false;

  // Calculate brush size from x position
  function get_size_from_x(x: number): number {
    const slider_start_x = rect.x0 + 3;
    const slider_width = rect.x1 - rect.x0 - 5;
    const segment_width = slider_width / (MAX_BRUSH_SIZE - MIN_BRUSH_SIZE);
    
    const relative_x = x - slider_start_x;
    let size = Math.round(relative_x / segment_width) + MIN_BRUSH_SIZE;
    size = Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, size));
    
    return size;
  }

  // Check if position is on slider
  function is_on_slider(x: number, y: number): boolean {
    const slider_y = rect.y1 - 3;
    return y >= slider_y - 1 && y <= slider_y + 1 && x >= rect.x0 + 2 && x <= rect.x1 - 2;
  }

  // Check if position is on space_replace checkbox
  function is_on_space_checkbox(x: number, y: number): boolean {
    const checkbox_y = rect.y1 - 5;
    return y === checkbox_y && x >= rect.x0 + 2 && x <= rect.x0 + 4;
  }

  // Check if position is on paste ignore_space checkbox
  function is_on_paste_ignore_space(x: number, y: number): boolean {
    const checkbox_y = rect.y1 - 11;
    return y === checkbox_y && x >= rect.x0 + 2 && x <= rect.x0 + 4;
  }

  // Check if position is on paste ignore_black checkbox
  function is_on_paste_ignore_black(x: number, y: number): boolean {
    const checkbox_y = rect.y1 - 12;
    return y === checkbox_y && x >= rect.x0 + 2 && x <= rect.x0 + 4;
  }

  // Check if position is on paste ignore_white checkbox
  function is_on_paste_ignore_white(x: number, y: number): boolean {
    const checkbox_y = rect.y1 - 13;
    return y === checkbox_y && x >= rect.x0 + 2 && x <= rect.x0 + 4;
  }

  // Check if position is on paste ignore_color checkbox
  function is_on_paste_ignore_color(x: number, y: number): boolean {
    const checkbox_y = rect.y1 - 14;
    return y === checkbox_y && x >= rect.x0 + 2 && x <= rect.x0 + 4;
  }

  // Check if position is on paste ignore color selector
  function is_on_paste_ignore_color_selector(x: number, y: number): boolean {
    const selector_y = rect.y1 - 14;
    return y === selector_y && x >= rect.x0 + 14 && x <= rect.x0 + 16;
  }

  // Check if position is on gradiator slot selector
  function is_on_gradiator_slot(x: number, y: number): number | null {
    const gradiator_start_y = rect.y1 - 3;
    for (let slot = 0; slot < 3; slot++) {
      const y_pos = gradiator_start_y - (slot * 2);
      if (y === y_pos && x >= rect.x0 + 2 && x <= rect.x0 + 4) {
        return slot;
      }
    }
    return null;
  }

  // Check if position is on gradiator character area (for editing)
  function is_on_gradiator_char(x: number, y: number): { slot: number; charX: number } | null {
    const gradiator_start_y = rect.y1 - 3;
    const gradiatorState = opts.get_gradiator_state();
    for (let slot = 0; slot < 3; slot++) {
      const y_pos = gradiator_start_y - (slot * 2);
      const gradiator = gradiatorState.slots[slot]!;
      // Clickable area is within the brackets based on actual gradiator length
      const endX = rect.x0 + 6 + Math.min(gradiator.length, 12);
      if (y === y_pos && x >= rect.x0 + 6 && x < endX) {
        return { slot, charX: x - (rect.x0 + 6) };
      }
    }
    return null;
  }

  // Check if position is on gradiator add (+) button
  function is_on_gradiator_add(x: number, y: number): number | null {
    const gradiator_start_y = rect.y1 - 3;
    const gradiatorState = opts.get_gradiator_state();
    for (let slot = 0; slot < 3; slot++) {
      const y_pos = gradiator_start_y - (slot * 2);
      const gradiator = gradiatorState.slots[slot]!;
      // + button appears after the closing bracket
      const buttonX = rect.x0 + 6 + Math.min(gradiator.length, 12) + 1;
      if (y === y_pos && x === buttonX) {
        return slot;
      }
    }
    return null;
  }

  // Check if position is on gradiator remove (-) button
  function is_on_gradiator_remove(x: number, y: number): number | null {
    const gradiator_start_y = rect.y1 - 3;
    const gradiatorState = opts.get_gradiator_state();
    for (let slot = 0; slot < 3; slot++) {
      const y_pos = gradiator_start_y - (slot * 2);
      const gradiator = gradiatorState.slots[slot]!;
      // - button appears after the + button
      const buttonX = rect.x0 + 6 + Math.min(gradiator.length, 12) + 2;
      if (y === y_pos && x === buttonX) {
        return slot;
      }
    }
    return null;
  }

  // Check if position is on scale slider (between the buttons)
  function is_on_scale_slider(x: number, y: number): boolean {
    const scale_y = rect.y1 - 9;
    const slider_start = rect.x0 + 10;
    const slider_end = rect.x1 - 5;
    return y === scale_y && x >= slider_start && x <= slider_end;
  }

  // Check if position is on scale minus button
  function is_on_scale_minus(x: number, y: number): boolean {
    const scale_y = rect.y1 - 9;
    return y === scale_y && x === rect.x0 + 8;
  }

  // Check if position is on scale plus button
  function is_on_scale_plus(x: number, y: number): boolean {
    const scale_y = rect.y1 - 9;
    return y === scale_y && x === rect.x1 - 3;
  }

  // Get scale value from x position
  function get_scale_from_x(x: number): number {
    const slider_start = rect.x0 + 10;
    const slider_width = rect.x1 - slider_start - 9;
    const relative_x = x - slider_start;
    const percent = 10 + (relative_x / slider_width) * 290;
    return Math.max(10, Math.min(300, Math.round(percent))) / 100;
  }

  // Check if position is on selection mode option
  function is_on_selection_mode(x: number, y: number): SelectionMode | null {
    const modes: SelectionMode[] = ['replace', 'additive', 'subtract', 'intersect'];
    let y_pos = rect.y1 - 4;
    
    for (const mode of modes) {
      if (y === y_pos && x >= rect.x0 + 2 && x <= rect.x1 - 2) {
        return mode;
      }
      y_pos--;
    }
    return null;
  }

  // Check if position is on selection button
  function is_on_selection_button(x: number, y: number): 'clear' | 'invert' | 'all' | null {
    const btn_y = rect.y1 - 8;
    if (y !== btn_y) return null;
    
    // [Clear] [Invert] [All]
    let btn_x = rect.x0 + 2;
    
    if (x >= btn_x && x < btn_x + 7) return 'clear';
    btn_x += 8;
    if (x >= btn_x && x < btn_x + 8) return 'invert';
    btn_x += 9;
    if (x >= btn_x && x < btn_x + 5) return 'all';
    
    return null;
  }

  // Check if position is on text spacing +/- buttons
  function is_on_text_spacing_button(x: number, y: number): 'minus' | 'plus' | null {
    const spacing_y = rect.y1 - 4; // Below the checkbox
    if (y !== spacing_y) return null;
    
    if (x === rect.x1 - 3) return 'minus';
    if (x === rect.x1 - 1) return 'plus';
    return null;
  }

  // Check if position is on text charlead +/- buttons
  function is_on_text_charlead_button(x: number, y: number): 'minus' | 'plus' | null {
    const charlead_y = rect.y1 - 5; // Below spacing
    if (y !== charlead_y) return null;
    
    if (x === rect.x1 - 3) return 'minus';
    if (x === rect.x1 - 1) return 'plus';
    return null;
  }

  // Check if position is on text enterlead +/- buttons
  function is_on_text_enterlead_button(x: number, y: number): 'minus' | 'plus' | null {
    const enterlead_y = rect.y1 - 6; // Below charlead
    if (y !== enterlead_y) return null;
    
    if (x === rect.x1 - 3) return 'minus';
    if (x === rect.x1 - 1) return 'plus';
    return null;
  }

  // Check if position is on text enterspace +/- buttons
  function is_on_text_enterspace_button(x: number, y: number): 'minus' | 'plus' | null {
    const enterspace_y = rect.y1 - 7; // Below enterlead
    if (y !== enterspace_y) return null;
    
    if (x === rect.x1 - 3) return 'minus';
    if (x === rect.x1 - 1) return 'plus';
    return null;
  }

  return {
    id: opts.id,
    get rect() { return rect; },
    set rect(newRect) { rect = newRect; },
    Focusable: true,

    Draw(c: Canvas): void {
      const bg_color = get_color_by_name('off_black').rgb;
      const border_color = get_color_by_name('medium_gray').rgb;
      const text_color = get_color_by_name('off_white').rgb;
      const slider_bg = get_color_by_name('dark_gray').rgb;
      const slider_fg = get_color_by_name('vivid_blue').rgb;
      const handle_color = get_color_by_name('vivid_yellow').rgb;
      
      // Fill background
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });

      draw_module_border(c, {
        rect,
        style: BORDER_STYLES.double,
        border_rgb: border_color,
        weight_index: 3,
        header: {
          text: 'PROPS',
          reserve_left_cols: 2 + ((gizmo_config.enabled?.length ?? 0) * 2),
        },
      });
      
      // Show brush size slider only for brush tools
      if (opts.get_current_tool() === 'pencil' || opts.get_current_tool() === 'eraser' || opts.get_current_tool() === 'weighter' || opts.get_current_tool() === 'colorer') {
        // Draw size label
        const size_label = `Size: ${SIZE_LABELS[opts.get_brush_size() - 1]!}`;
        const label_y = rect.y1 - 5;
        const label_start_x = Math.floor((rect.x0 + rect.x1 - size_label.length) / 2);
        
        for (let i = 0; i < size_label.length; i++) {
          c.set(label_start_x + i, label_y, {
            char: size_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
          });
        }
        
        // Draw slider track
        const slider_y = rect.y1 - 3;
        const slider_start_x = rect.x0 + 3;
        const slider_end_x = rect.x1 - 3;
        
        for (let x = slider_start_x; x <= slider_end_x; x++) {
          c.set(x, slider_y, {
            char: '─',
            rgb: slider_bg,
            style: 'regular',
            weight_index: 3
          });
        }
        
        // Draw size markers
        const segment_width = (slider_end_x - slider_start_x) / (MAX_BRUSH_SIZE - MIN_BRUSH_SIZE);
        for (let i = 0; i < MAX_BRUSH_SIZE; i++) {
          const marker_x = Math.round(slider_start_x + (i * segment_width));
          const is_selected = i + 1 === opts.get_brush_size();
          
          c.set(marker_x, slider_y, {
            char: is_selected ? '●' : '○',
            rgb: is_selected ? slider_fg : slider_bg,
            style: 'regular',
            weight_index: is_selected ? 6 : 3
          });
        }
      } else if (opts.get_current_tool() === 'text') {
        let y_pos = rect.y1 - 3;
        
        // Show space_replace checkbox
        const space_replace = opts.get_space_replace();
        c.set(rect.x0 + 2, y_pos, {
          char: space_replace ? '☑' : '☐',
          rgb: text_color,
          style: 'regular',
          weight_index: 4
        });
        
        const space_label = 'space→" "';
        for (let i = 0; i < space_label.length && i < rect.x1 - rect.x0 - 5; i++) {
          c.set(rect.x0 + 4 + i, y_pos, {
            char: space_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
          });
        }
        y_pos--;
        
        // Spacing control (X per char)
        const spacing = opts.get_text_spacing();
        const spacing_label = `SpaceX: ${spacing > 0 ? '+' : ''}${spacing}`;
        for (let i = 0; i < spacing_label.length && i < rect.x1 - rect.x0 - 2; i++) {
          c.set(rect.x0 + 2 + i, y_pos, {
            char: spacing_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
          });
        }
        c.set(rect.x1 - 3, y_pos, { char: '-', rgb: slider_fg, style: 'regular', weight_index: 5 });
        c.set(rect.x1 - 1, y_pos, { char: '+', rgb: slider_fg, style: 'regular', weight_index: 5 });
        y_pos--;
        
        // Charlead control (Y per char)
        const charlead = opts.get_text_charlead();
        const charlead_label = `CharY: ${charlead > 0 ? '+' : ''}${charlead}`;
        for (let i = 0; i < charlead_label.length && i < rect.x1 - rect.x0 - 2; i++) {
          c.set(rect.x0 + 2 + i, y_pos, {
            char: charlead_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
          });
        }
        c.set(rect.x1 - 3, y_pos, { char: '-', rgb: slider_fg, style: 'regular', weight_index: 5 });
        c.set(rect.x1 - 1, y_pos, { char: '+', rgb: slider_fg, style: 'regular', weight_index: 5 });
        y_pos--;
        
        // Enterlead control (Y on Enter)
        const enterlead = opts.get_text_enterlead();
        const enterlead_label = `EntY: ${enterlead > 0 ? '+' : ''}${enterlead}`;
        for (let i = 0; i < enterlead_label.length && i < rect.x1 - rect.x0 - 2; i++) {
          c.set(rect.x0 + 2 + i, y_pos, {
            char: enterlead_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
          });
        }
        c.set(rect.x1 - 3, y_pos, { char: '-', rgb: slider_fg, style: 'regular', weight_index: 5 });
        c.set(rect.x1 - 1, y_pos, { char: '+', rgb: slider_fg, style: 'regular', weight_index: 5 });
        y_pos--;
        
        // Enterspace control (X on Enter)
        const enterspace = opts.get_text_enterspace();
        const enterspace_label = `EntX: ${enterspace > 0 ? '+' : ''}${enterspace}`;
        for (let i = 0; i < enterspace_label.length && i < rect.x1 - rect.x0 - 2; i++) {
          c.set(rect.x0 + 2 + i, y_pos, {
            char: enterspace_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
          });
        }
        c.set(rect.x1 - 3, y_pos, { char: '-', rgb: slider_fg, style: 'regular', weight_index: 5 });
        c.set(rect.x1 - 1, y_pos, { char: '+', rgb: slider_fg, style: 'regular', weight_index: 5 });
      } else if (opts.get_current_tool() === 'selectangle' || opts.get_current_tool() === 'lassoselect') {
        // Show selection mode options
        const modes: SelectionMode[] = ['replace', 'additive', 'subtract', 'intersect'];
        const current_mode = opts.get_selection_mode();
        let y_pos = rect.y1 - 4;
        
        for (const mode of modes) {
          const is_selected = current_mode === mode;
          c.set(rect.x0 + 2, y_pos, {
            char: is_selected ? '●' : '○',
            rgb: is_selected ? slider_fg : text_color,
            style: 'regular',
            weight_index: is_selected ? 6 : 3
          });
          
          const label = mode.charAt(0).toUpperCase() + mode.slice(1);
          for (let i = 0; i < label.length && i < rect.x1 - rect.x0 - 5; i++) {
            c.set(rect.x0 + 4 + i, y_pos, {
              char: label[i]!,
              rgb: is_selected ? slider_fg : text_color,
              style: 'regular',
              weight_index: is_selected ? 5 : 3
            });
          }
          y_pos--;
        }
        
        // Draw buttons
        const btn_y = rect.y1 - 8;
        const btns = ['[Clear]', '[Invert]', '[All]'];
        let btn_x = rect.x0 + 2;
        
        for (const btn of btns) {
          for (let i = 0; i < btn.length && btn_x + i < rect.x1; i++) {
            c.set(btn_x + i, btn_y, {
              char: btn[i]!,
              rgb: text_color,
              style: 'regular',
              weight_index: 4
            });
          }
          btn_x += btn.length + 1;
        }
      } else if (opts.get_current_tool() === 'paste') {
        const gradiatorState = opts.get_gradiator_state();
        const pasteScale = opts.get_paste_scale();
        const paste_replace = opts.get_paste_space_replace();
        
        // Draw gradiators
        const gradiator_start_y = rect.y1 - 3;
        const activeColor = get_color_by_name('vivid_yellow').rgb;
        const inactiveColor = get_color_by_name('medium_gray').rgb;
        
        for (let slot = 0; slot < 3; slot++) {
          const isActive = slot === gradiatorState.activeSlot;
          const gradiator = gradiatorState.slots[slot]!;
          const y_pos = gradiator_start_y - (slot * 2);
          
          // Draw slot label
          const label = `G${slot + 1}`;
          for (let i = 0; i < label.length; i++) {
            c.set(rect.x0 + 2 + i, y_pos, {
              char: label[i]!,
              rgb: isActive ? activeColor : inactiveColor,
              style: 'regular',
              weight_index: isActive ? 5 : 3
            });
          }
          
          // Draw gradiator characters in brackets
          c.set(rect.x0 + 5, y_pos, { char: '[', rgb: text_color, style: 'regular', weight_index: 3 });
          
          for (let x = 0; x < gradiator.length && x < 12; x++) {
            const char = gradiator[x]!;
            // Highlight selected character position if this is the active slot and has a selection
            const isSelected = isActive && gradiatorState.isEditing && gradiatorState.editSlot === slot && x === gradiatorState.editCursorX;
            
            c.set(rect.x0 + 6 + x, y_pos, {
              char: char,
              rgb: isSelected ? activeColor : text_color,
              style: isSelected ? 'reverse' : 'regular',
              weight_index: isSelected ? 5 : 4
            });
          }
          
          c.set(rect.x0 + 6 + Math.min(gradiator.length, 12), y_pos, { 
            char: ']', 
            rgb: text_color, 
            style: 'regular', 
            weight_index: 3 
          });
          
          // Draw + and - buttons
          const buttonX = rect.x0 + 6 + Math.min(gradiator.length, 12) + 1;
          c.set(buttonX, y_pos, {
            char: '+',
            rgb: get_color_by_name('vivid_yellow').rgb,
            style: 'regular',
            weight_index: 4
          });
          
          // Only show - if gradiator has more than minimum characters
          if (gradiator.length > 2) {
            c.set(buttonX + 1, y_pos, {
              char: '-',
              rgb: get_color_by_name('vivid_red').rgb,
              style: 'regular',
              weight_index: 4
            });
          }
        }
        
        // Draw scale slider
        const scale_y = rect.y1 - 9;
        const scale_label = 'Scale:';
        for (let i = 0; i < scale_label.length; i++) {
          c.set(rect.x0 + 2 + i, scale_y, {
            char: scale_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
          });
        }
        
        // Draw minus button for scale
        c.set(rect.x0 + 8, scale_y, {
          char: '-',
          rgb: get_color_by_name('vivid_red').rgb,
          style: 'regular',
          weight_index: 4
        });
        
        // Scale slider track
        const slider_start = rect.x0 + 10;
        const slider_width = rect.x1 - slider_start - 4;
        const scale_percent = Math.round(pasteScale * 100);
        const slider_pos = Math.floor(((scale_percent - 10) / 290) * slider_width);
        
        for (let x = 0; x < slider_width; x++) {
          c.set(slider_start + x, scale_y, {
            char: x === slider_pos ? '◆' : '─',
            rgb: x === slider_pos ? get_color_by_name('vivid_yellow').rgb : get_color_by_name('medium_gray').rgb,
            style: 'regular',
            weight_index: x === slider_pos ? 5 : 3
          });
        }
        
        // Draw plus button for scale
        c.set(rect.x1 - 3, scale_y, {
          char: '+',
          rgb: get_color_by_name('vivid_green').rgb,
          style: 'regular',
          weight_index: 4
        });
        
        // Scale percentage display
        const percent_str = `${scale_percent}%`;
        const percent_x = rect.x1 - percent_str.length - 5;
        for (let i = 0; i < percent_str.length; i++) {
          c.set(percent_x + i, scale_y, {
            char: percent_str[i]!,
            rgb: get_color_by_name('vivid_yellow').rgb,
            style: 'regular',
            weight_index: 4
          });
        }
        
        // Get ignore options
        const ignore_space = opts.get_paste_ignore_space();
        const ignore_black = opts.get_paste_ignore_black();
        const ignore_white = opts.get_paste_ignore_white();
        const ignore_color = opts.get_paste_ignore_color();
        const ignore_color_rgb = opts.get_paste_ignore_color_rgb();
        
        // Show ignore space checkbox and label
        const ignore_space_y = rect.y1 - 11;
        c.set(rect.x0 + 2, ignore_space_y, {
          char: ignore_space ? '☑' : '☐',
          rgb: text_color,
          style: 'regular',
          weight_index: 4
        });
        
        const ignore_space_label = 'ignore space';
        for (let i = 0; i < ignore_space_label.length && i < rect.x1 - rect.x0 - 6; i++) {
          c.set(rect.x0 + 4 + i, ignore_space_y, {
            char: ignore_space_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
          });
        }
        
        // Show ignore black checkbox and label
        const ignore_black_y = rect.y1 - 12;
        c.set(rect.x0 + 2, ignore_black_y, {
          char: ignore_black ? '☑' : '☐',
          rgb: text_color,
          style: 'regular',
          weight_index: 4
        });
        
        const ignore_black_label = 'ignore black';
        for (let i = 0; i < ignore_black_label.length && i < rect.x1 - rect.x0 - 15; i++) {
          c.set(rect.x0 + 4 + i, ignore_black_y, {
            char: ignore_black_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
          });
        }
        
        // Show black color indicator
        c.set(rect.x0 + 15, ignore_black_y, {
          char: '█',
          rgb: { r: 0, g: 0, b: 0 },
          style: 'regular',
          weight_index: 4
        });
        
        // Show ignore white checkbox and label
        const ignore_white_y = rect.y1 - 13;
        c.set(rect.x0 + 2, ignore_white_y, {
          char: ignore_white ? '☑' : '☐',
          rgb: text_color,
          style: 'regular',
          weight_index: 4
        });
        
        const ignore_white_label = 'ignore white';
        for (let i = 0; i < ignore_white_label.length && i < rect.x1 - rect.x0 - 15; i++) {
          c.set(rect.x0 + 4 + i, ignore_white_y, {
            char: ignore_white_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
          });
        }
        
        // Show white color indicator
        c.set(rect.x0 + 15, ignore_white_y, {
          char: '█',
          rgb: { r: 255, g: 255, b: 255 },
          style: 'regular',
          weight_index: 4
        });
        
        // Show ignore color checkbox and label
        const ignore_color_y = rect.y1 - 14;
        c.set(rect.x0 + 2, ignore_color_y, {
          char: ignore_color ? '☑' : '☐',
          rgb: text_color,
          style: 'regular',
          weight_index: 4
        });
        
        const ignore_color_label = 'ignore color';
        for (let i = 0; i < ignore_color_label.length && i < rect.x1 - rect.x0 - 17; i++) {
          c.set(rect.x0 + 4 + i, ignore_color_y, {
            char: ignore_color_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
          });
        }
        
        // Show color selector box (clickable)
        c.set(rect.x0 + 14, ignore_color_y, {
          char: '[',
          rgb: text_color,
          style: 'regular',
          weight_index: 3
        });
        c.set(rect.x0 + 15, ignore_color_y, {
          char: '█',
          rgb: ignore_color_rgb,
          style: 'regular',
          weight_index: 4
        });
        c.set(rect.x0 + 16, ignore_color_y, {
          char: ']',
          rgb: text_color,
          style: 'regular',
          weight_index: 3
        });
      } else {
        // Show message for non-brush tools
        const msg = 'No options';
        const msg_y = rect.y1 - 4;
        const msg_start_x = Math.floor((rect.x0 + rect.x1 - msg.length) / 2);
        
        for (let i = 0; i < msg.length; i++) {
          c.set(msg_start_x + i, msg_y, {
            char: msg[i]!,
            rgb: get_color_by_name('medium_gray').rgb,
            style: 'regular',
            weight_index: 3
          });
        }
      }
      
      // Draw gizmos
      draw_module_gizmos(c, rect, gizmo_config, gizmo_state, 'PROPERTIES');
    },

    OnGlobalPointerDown(e: PointerEvent): void {
      handle_global_pointer_down_for_gizmos(e, rect, gizmo_config, gizmo_state);
    },

    OnPointerDown(e: PointerEvent): void {
      if (is_in_gizmo_area(e.x, e.y, rect)) {
        const gizmo = handle_gizmo_click(e.x, e.y, rect, gizmo_config, gizmo_state);
        if (gizmo === 'move') {
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
        }
        return;
      }
      
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
      
      if (gizmo_state.is_move_mode) {
        gizmo_state.move_start_x = e.x;
        gizmo_state.move_start_y = e.y;
        return;
      }
      
      // Handle brush size slider
      if ((opts.get_current_tool() === 'pencil' || opts.get_current_tool() === 'eraser' || opts.get_current_tool() === 'weighter' || opts.get_current_tool() === 'colorer') && is_on_slider(e.x, e.y)) {
        is_dragging_slider = true;
        const new_size = get_size_from_x(e.x);
        if (new_size !== opts.get_brush_size()) {
          opts.on_brush_size_change(new_size);
        }
      }
      
      // Handle space_replace checkbox for text tool
      if (opts.get_current_tool() === 'text' && is_on_space_checkbox(e.x, e.y)) {
        opts.on_space_replace_change(!opts.get_space_replace());
      }
      
      // Handle text spacing and leading controls
      if (opts.get_current_tool() === 'text') {
        const spacing_btn = is_on_text_spacing_button(e.x, e.y);
        if (spacing_btn === 'minus') {
          const new_val = Math.max(-16, opts.get_text_spacing() - 1);
          opts.on_text_spacing_change(new_val);
        } else if (spacing_btn === 'plus') {
          const new_val = Math.min(16, opts.get_text_spacing() + 1);
          opts.on_text_spacing_change(new_val);
        }
        
        
        const charlead_btn = is_on_text_charlead_button(e.x, e.y);
        if (charlead_btn === 'minus') {
          const new_val = Math.max(-16, opts.get_text_charlead() - 1);
          opts.on_text_charlead_change(new_val);
        } else if (charlead_btn === 'plus') {
          const new_val = Math.min(16, opts.get_text_charlead() + 1);
          opts.on_text_charlead_change(new_val);
        }
        
        const enterlead_btn = is_on_text_enterlead_button(e.x, e.y);
        if (enterlead_btn === 'minus') {
          const new_val = Math.max(-16, opts.get_text_enterlead() - 1);
          opts.on_text_enterlead_change(new_val);
        } else if (enterlead_btn === 'plus') {
          const new_val = Math.min(16, opts.get_text_enterlead() + 1);
          opts.on_text_enterlead_change(new_val);
        }
        
        const enterspace_btn = is_on_text_enterspace_button(e.x, e.y);
        if (enterspace_btn === 'minus') {
          const new_val = Math.max(-16, opts.get_text_enterspace() - 1);
          opts.on_text_enterspace_change(new_val);
        } else if (enterspace_btn === 'plus') {
          const new_val = Math.min(16, opts.get_text_enterspace() + 1);
          opts.on_text_enterspace_change(new_val);
        }
      }
      
      // Handle selection mode change
      if (opts.get_current_tool() === 'selectangle' || opts.get_current_tool() === 'lassoselect') {
        const mode = is_on_selection_mode(e.x, e.y);
        if (mode) {
          opts.on_selection_mode_change(mode);
        }
        
        const btn = is_on_selection_button(e.x, e.y);
        if (btn === 'clear') opts.on_selection_clear?.();
        if (btn === 'invert') opts.on_selection_invert?.();
        if (btn === 'all') opts.on_selection_all?.();
      }
      
      // Handle paste tool interactions
      if (opts.get_current_tool() === 'paste') {
        // Handle paste ignore_space checkbox
        if (is_on_paste_ignore_space(e.x, e.y)) {
          opts.on_paste_ignore_space_change(!opts.get_paste_ignore_space());
          return;
        }
        
        // Handle paste ignore_black checkbox
        if (is_on_paste_ignore_black(e.x, e.y)) {
          opts.on_paste_ignore_black_change(!opts.get_paste_ignore_black());
          return;
        }
        
        // Handle paste ignore_white checkbox
        if (is_on_paste_ignore_white(e.x, e.y)) {
          opts.on_paste_ignore_white_change(!opts.get_paste_ignore_white());
          return;
        }
        
        // Handle paste ignore_color checkbox
        if (is_on_paste_ignore_color(e.x, e.y)) {
          opts.on_paste_ignore_color_change(!opts.get_paste_ignore_color());
          return;
        }
        
        // Handle paste ignore color selector
        if (is_on_paste_ignore_color_selector(e.x, e.y)) {
          opts.on_paste_ignore_color_select();
          return;
        }
        
        // Handle gradiator slot selection
        const gradiatorSlot = is_on_gradiator_slot(e.x, e.y);
        if (gradiatorSlot !== null) {
          opts.on_gradiator_slot_select(gradiatorSlot as GradiatorSlot);
          return;
        }
        
        // Handle gradiator character selection
        const gradiatorChar = is_on_gradiator_char(e.x, e.y);
        if (gradiatorChar !== null) {
          opts.on_gradiator_char_select(gradiatorChar.slot as GradiatorSlot, gradiatorChar.charX);
          return;
        }
        
        // Handle gradiator add/remove buttons
        const gradiatorAdd = is_on_gradiator_add(e.x, e.y);
        if (gradiatorAdd !== null) {
          opts.on_gradiator_add_char(gradiatorAdd as GradiatorSlot);
          return;
        }
        
        const gradiatorRemove = is_on_gradiator_remove(e.x, e.y);
        if (gradiatorRemove !== null) {
          opts.on_gradiator_remove_char(gradiatorRemove as GradiatorSlot);
          return;
        }
        
        // Handle scale minus button
        if (is_on_scale_minus(e.x, e.y)) {
          const currentScale = opts.get_paste_scale();
          const newScale = Math.max(0.1, currentScale - 0.01);
          opts.on_paste_scale_change(newScale);
          console.log('Scale decreased to', Math.round(newScale * 100) + '%');
          return;
        }
        
        // Handle scale plus button
        if (is_on_scale_plus(e.x, e.y)) {
          const currentScale = opts.get_paste_scale();
          const newScale = Math.min(3.0, currentScale + 0.01);
          opts.on_paste_scale_change(newScale);
          console.log('Scale increased to', Math.round(newScale * 100) + '%');
          return;
        }
        
        // Handle scale slider
        if (is_on_scale_slider(e.x, e.y)) {
          is_dragging_scale = true;
          const newScale = get_scale_from_x(e.x);
          opts.on_paste_scale_change(newScale);
          return;
        }
      }
    },

    OnPointerMove(e: PointerEvent): void {
      if (gizmo_state.is_resize_mode && !gizmo_state.is_dragging_resize) {
        gizmo_state.resize_edge = get_resize_edge(e.x, e.y, rect);
      }
    },

    OnDragMove(e: DragEvent): void {
      if (gizmo_state.is_move_mode && gizmo_state.original_rect) {
        const dx = e.x - gizmo_state.move_start_x;
        const dy = e.y - gizmo_state.move_start_y;
        
        rect = {
          x0: gizmo_state.original_rect.x0 + dx,
          y0: gizmo_state.original_rect.y0 + dy,
          x1: gizmo_state.original_rect.x1 + dx,
          y1: gizmo_state.original_rect.y1 + dy,
        };
        
        if (opts.on_move) opts.on_move(rect);
        return;
      }
      
      if (gizmo_state.is_resize_mode && gizmo_state.is_dragging_resize && gizmo_state.original_rect) {
        const new_rect = handle_resize_drag(
          e.x, e.y, gizmo_state, gizmo_state.original_rect,
          MIN_WIDTH, MIN_HEIGHT, MAX_WIDTH, MAX_HEIGHT,
          opts.on_resize || opts.on_move
        );
        if (new_rect) rect = new_rect;
        return;
      }
      
      // Handle slider dragging
      if (is_dragging_slider && (opts.get_current_tool() === 'pencil' || opts.get_current_tool() === 'eraser')) {
        const new_size = get_size_from_x(e.x);
        if (new_size !== opts.get_brush_size()) {
          opts.on_brush_size_change(new_size);
        }
      }
      
      // Handle scale slider dragging for paste tool
      if (is_dragging_scale && opts.get_current_tool() === 'paste') {
        const new_scale = get_scale_from_x(e.x);
        if (Math.abs(new_scale - opts.get_paste_scale()) > 0.01) {
          opts.on_paste_scale_change(new_scale);
        }
      }
    },

    OnPointerUp(): void {
      is_dragging_slider = false;
      is_dragging_scale = false;
      
      if (gizmo_state.is_move_mode) {
        gizmo_state.is_move_mode = false;
        if (opts.on_move) opts.on_move(rect);
      }
      if (gizmo_state.is_dragging_resize) {
        gizmo_state.is_dragging_resize = false;
        gizmo_state.resize_edge = null;
        if (opts.on_move) opts.on_move(rect);
      }
    },
  };
}
