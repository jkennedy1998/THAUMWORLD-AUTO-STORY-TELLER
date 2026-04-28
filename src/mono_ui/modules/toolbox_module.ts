/**
 * Toolbox Module
 * 
 * A floating module showing all available tools as a vertically scrolling list.
 * Selected tool is highlighted in bright yellow, unselected in medium gray.
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent, WheelEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import type { ToolType } from '../../ascii_painter/types.js';
import { make_floating_panel_module } from './floating_panel_module.js';

export type ToolboxToolDef<TTool extends string> = { tool: TTool; label: string; icon: string; shortcut: string };

export type ToolboxOptions<TTool extends string = ToolType> = {
  id: string;
  rect: Rect;
  get_current_tool: () => TTool;
  get_left_click_tool: () => TTool;
  get_right_click_tool: () => TTool;
  on_tool_select: (tool: TTool) => void;
  on_left_click_tool_change: (tool: TTool) => void;
  on_right_click_tool_change: (tool: TTool) => void;
  title?: string;
  tool_defs?: Array<ToolboxToolDef<TTool>>;
  on_move?: (new_rect: Rect) => void;
  on_resize?: (new_rect: Rect) => void;
  on_close?: () => void;
};

// Tool definitions with icons
const TOOLS: ToolboxToolDef<ToolType>[] = [
  { tool: 'pencil', label: 'Pencil', icon: '✎', shortcut: 'P' },
  { tool: 'eraser', label: 'Eraser', icon: '◫', shortcut: 'E' },
  { tool: 'bucket', label: 'Bucket', icon: '▧', shortcut: 'B' },
  { tool: 'eyedropper', label: 'Dropper', icon: '◉', shortcut: 'I' },
  { tool: 'line', label: 'Line', icon: '╱', shortcut: 'L' },
  { tool: 'rect_stroke', label: 'Rect', icon: '□', shortcut: 'R' },
  { tool: 'rect_fill', label: 'Fill', icon: '■', shortcut: 'S' },
  { tool: 'text', label: 'Text', icon: 'T', shortcut: 'T' },
  { tool: 'selectangle', label: 'RectSel', icon: '▣', shortcut: 'M' },
  { tool: 'lassoselect', label: 'Lasso', icon: '◎', shortcut: 'N' },
  { tool: 'copy', label: 'Copy', icon: '⎘', shortcut: 'C' },
  { tool: 'paste', label: 'Paste', icon: '⎗', shortcut: 'V' },
  { tool: 'move', label: 'Move', icon: '✥', shortcut: 'G' },
];

// Size constraints
const MIN_WIDTH = 14;
const MAX_WIDTH = 20;
const MIN_HEIGHT = 10;
const MAX_HEIGHT = 30;

export function make_toolbox_module<TTool extends string = ToolType>(opts: ToolboxOptions<TTool>): Module {
  const tool_defs: Array<ToolboxToolDef<TTool>> = (opts.tool_defs ?? (TOOLS as unknown as Array<ToolboxToolDef<TTool>>));
  const title = String(opts.title ?? 'TOOLS');
  
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };
  
  let scroll_offset = 0;

  function get_visible_count(rect: Rect): number {
    return Math.max(1, rect.y1 - rect.y0 - 3); // -3 for border/title/gizmo
  }

  function clamp_scroll(rect: Rect): void {
    const max_scroll = Math.max(0, tool_defs.length - get_visible_count(rect));
    scroll_offset = Math.max(0, Math.min(max_scroll, scroll_offset));
  }

  function get_tool_at_y(rect: Rect, y: number): TTool | null {
    const start_y = rect.y1 - 3;
    const index = scroll_offset + (start_y - y);
    
    if (index >= 0 && index < tool_defs.length) {
      return tool_defs[index]!.tool;
    }
    return null;
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title,
    gizmos: gizmo_config,
    background: { rgb: get_color_by_name('off_black').rgb },
    resize: {
      min_width: MIN_WIDTH,
      min_height: MIN_HEIGHT,
      max_width: MAX_WIDTH,
      max_height: MAX_HEIGHT,
    },
    draw_content(c: Canvas, rect: Rect): void {
      const bg_color = get_color_by_name('off_black').rgb;
      const selected_color = get_color_by_name('vivid_yellow').rgb;
      const unselected_color = get_color_by_name('medium_gray').rgb;
      const left_color = get_color_by_name('vivid_blue').rgb;
      const right_color = get_color_by_name('vivid_red').rgb;
      
      // Fill background
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });
      
      // Draw assignment legend
      const left_tool = opts.get_left_click_tool();
      const right_tool = opts.get_right_click_tool();
      
      // Draw tools list
      const visible_count = get_visible_count(rect);
      const start_y = rect.y1 - 3;
      
      for (let i = 0; i < visible_count; i++) {
        const tool_index = scroll_offset + i;
        if (tool_index >= tool_defs.length) break;
        
        const tool = tool_defs[tool_index]!;
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
          weight_index: is_current ? 3 : 2
        });
        
        // Draw icon
        const icon_color = is_current ? selected_color : (is_left || is_right ? indicator_color : unselected_color);
        c.set(rect.x0 + 3, tool_y, {
          char: tool.icon,
          rgb: icon_color,
          style: 'regular',
          weight_index: is_current ? 3 : 2
        });
        
        // Draw label
        const label_color = is_current ? selected_color : unselected_color;
        for (let j = 0; j < tool.label.length && rect.x0 + 5 + j < rect.x1; j++) {
          c.set(rect.x0 + 5 + j, tool_y, {
            char: tool.label[j]!,
            rgb: label_color,
            style: 'regular',
            weight_index: is_current ? 3 : 2
          });
        }
      }
    },
    on_pointer_down_content(e: PointerEvent, rect: Rect): void {
      const tool = get_tool_at_y(rect, e.y);
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
    on_wheel_content(e: WheelEvent, rect: Rect): void {
      scroll_offset += e.delta_y > 0 ? 1 : -1;
      clamp_scroll(rect);
    },
  });
}
