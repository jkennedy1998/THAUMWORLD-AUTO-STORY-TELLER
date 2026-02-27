/**
 * Toolbox Module
 * 
 * A floating module showing all available tools as a vertically scrolling list.
 * Selected tool is highlighted in bright yellow, unselected in medium gray.
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent, WheelEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import type { ModuleGizmosConfig, GizmoState } from '../module_gizmos.js';
import { draw_module_gizmos, handle_gizmo_click, create_gizmo_state, is_in_gizmo_area, handle_move_drag, get_resize_edge, handle_resize_drag } from '../module_gizmos.js';
import type { ToolType } from '../../ascii_painter/types.js';

export type ToolboxOptions = {
  id: string;
  rect: Rect;
  get_current_tool: () => ToolType;
  get_left_click_tool: () => ToolType;
  get_right_click_tool: () => ToolType;
  on_tool_select: (tool: ToolType) => void;
  on_left_click_tool_change: (tool: ToolType) => void;
  on_right_click_tool_change: (tool: ToolType) => void;
  on_move?: (new_rect: Rect) => void;
  on_resize?: (new_rect: Rect) => void;
  on_close?: () => void;
};

// Tool definitions with icons
const TOOLS: { tool: ToolType; label: string; icon: string; shortcut: string }[] = [
  { tool: 'pencil', label: 'Pencil', icon: '✎', shortcut: 'P' },
  { tool: 'eraser', label: 'Eraser', icon: '◫', shortcut: 'E' },
  { tool: 'bucket', label: 'Bucket', icon: '▧', shortcut: 'B' },
  { tool: 'eyedropper', label: 'Dropper', icon: '◉', shortcut: 'I' },
  { tool: 'line', label: 'Line', icon: '╱', shortcut: 'L' },
  { tool: 'rect_stroke', label: 'Rect', icon: '□', shortcut: 'R' },
  { tool: 'rect_fill', label: 'Fill', icon: '■', shortcut: 'S' },
  { tool: 'text', label: 'Text', icon: 'T', shortcut: 'T' },
];

// Size constraints
const MIN_WIDTH = 14;
const MAX_WIDTH = 20;
const MIN_HEIGHT = 10;
const MAX_HEIGHT = 30;

export function make_toolbox_module(opts: ToolboxOptions): Module {
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
  let scroll_offset = 0;

  function get_visible_count(): number {
    return Math.max(1, rect.y1 - rect.y0 - 3); // -3 for border/title/gizmo
  }

  function clamp_scroll(): void {
    const max_scroll = Math.max(0, TOOLS.length - get_visible_count());
    scroll_offset = Math.max(0, Math.min(max_scroll, scroll_offset));
  }

  function get_tool_at_y(y: number): ToolType | null {
    const start_y = rect.y1 - 3;
    const index = scroll_offset + (start_y - y);
    
    if (index >= 0 && index < TOOLS.length) {
      return TOOLS[index]!.tool;
    }
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
      const selected_color = get_color_by_name('vivid_yellow').rgb;
      const unselected_color = get_color_by_name('medium_gray').rgb;
      const left_color = get_color_by_name('vivid_blue').rgb;
      const right_color = get_color_by_name('vivid_red').rgb;
      
      // Fill background
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });
      
      // Draw border
      for (let x = rect.x0; x <= rect.x1; x++) {
        c.set(x, rect.y1, { char: '─', rgb: border_color, style: 'regular', weight_index: 3 });
        c.set(x, rect.y0, { char: '─', rgb: border_color, style: 'regular', weight_index: 3 });
      }
      for (let y = rect.y0; y <= rect.y1; y++) {
        c.set(rect.x0, y, { char: '│', rgb: border_color, style: 'regular', weight_index: 3 });
        c.set(rect.x1, y, { char: '│', rgb: border_color, style: 'regular', weight_index: 3 });
      }
      c.set(rect.x0, rect.y1, { char: '┌', rgb: border_color, style: 'regular', weight_index: 3 });
      c.set(rect.x1, rect.y1, { char: '┐', rgb: border_color, style: 'regular', weight_index: 3 });
      c.set(rect.x0, rect.y0, { char: '└', rgb: border_color, style: 'regular', weight_index: 3 });
      c.set(rect.x1, rect.y0, { char: '┘', rgb: border_color, style: 'regular', weight_index: 3 });
      
      // Draw title
      const title = 'TOOLS';
      const title_y = rect.y1 - 1;
      for (let i = 0; i < title.length && i < rect.x1 - rect.x0 - 2; i++) {
        const char = title[i]!;
        c.set(rect.x0 + 2 + i, title_y, { 
          char: char, 
          rgb: text_color, 
          style: 'regular',
          weight_index: 4 
        });
      }
      
      // Draw assignment legend
      const left_tool = opts.get_left_click_tool();
      const right_tool = opts.get_right_click_tool();
      
      // Draw tools list
      const visible_count = get_visible_count();
      const start_y = rect.y1 - 3;
      
      for (let i = 0; i < visible_count; i++) {
        const tool_index = scroll_offset + i;
        if (tool_index >= TOOLS.length) break;
        
        const tool = TOOLS[tool_index]!;
        const tool_y = start_y - i;
        if (tool_y <= rect.y0) break;
        
        const is_left = tool.tool === left_tool;
        const is_right = tool.tool === right_tool;
        const is_current = tool.tool === opts.get_current_tool();
        
        // Determine indicator character and color
        let indicator = ' ';
        let indicator_color = unselected_color;
        
        if (is_left && is_right) {
          indicator = '◆'; // Both
          indicator_color = selected_color;
        } else if (is_left) {
          indicator = 'L';
          indicator_color = left_color;
        } else if (is_right) {
          indicator = 'R';
          indicator_color = right_color;
        }
        
        // Draw indicator
        c.set(rect.x0 + 1, tool_y, {
          char: indicator,
          rgb: indicator_color,
          style: 'regular',
          weight_index: is_current ? 6 : 4
        });
        
        // Draw icon
        const icon_color = is_current ? selected_color : (is_left || is_right ? indicator_color : unselected_color);
        c.set(rect.x0 + 3, tool_y, {
          char: tool.icon,
          rgb: icon_color,
          style: 'regular',
          weight_index: is_current ? 6 : 4
        });
        
        // Draw label
        const label_color = is_current ? selected_color : unselected_color;
        for (let j = 0; j < tool.label.length && rect.x0 + 5 + j < rect.x1; j++) {
          c.set(rect.x0 + 5 + j, tool_y, {
            char: tool.label[j]!,
            rgb: label_color,
            style: 'regular',
            weight_index: is_current ? 6 : 4
          });
        }
      }
      
      // Draw gizmos
      draw_module_gizmos(c, rect, gizmo_config, gizmo_state);
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
      
      const tool = get_tool_at_y(e.y);
      if (tool) {
        // Left click = set left-click tool AND current tool
        if (e.button === 0) {
          opts.on_tool_select(tool);
          opts.on_left_click_tool_change(tool);
        }
        // Right click = set right-click tool
        else if (e.button === 2) {
          opts.on_right_click_tool_change(tool);
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
      }
    },

    OnPointerUp(): void {
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

    OnWheel(e: WheelEvent): void {
      scroll_offset += e.delta_y > 0 ? 1 : -1;
      clamp_scroll();
    },
  };
}
