/**
 * ASCII Painter Toolbar Module
 * 
 * A toolbar with clickable ASCII buttons for tool selection.
 */

import type { Canvas, Module, Rect, PointerEvent, Rgb } from '../types.js';
import { get_color_by_name } from '../colors.js';
import { draw_module_border, PANEL_BORDER_PRESETS } from '../module_borders.js';
import type { ToolType } from '../../ascii_painter/types.js';

export type PainterToolbarOptions = {
  id: string;
  rect: Rect;
  
  // Current tool
  get_current_tool: () => ToolType;
  
  // Callback when tool is selected
  on_tool_select: (tool: ToolType) => void;
};

type ToolButton = {
  tool: ToolType;
  label: string;
  shortcut: string;
  x: number;
  y: number;
  width: number;
};

export function make_painter_toolbar_module(opts: PainterToolbarOptions): Module {
  const rect = opts.rect;
  
  // Define tool buttons layout
  // y=1 places buttons in the middle row (between borders)
  const buttons: ToolButton[] = [
    { tool: 'pencil', label: 'PENCIL', shortcut: 'P', x: 1, y: 1, width: 8 },
    { tool: 'eraser', label: 'ERASER', shortcut: 'E', x: 10, y: 1, width: 8 },
    { tool: 'bucket', label: 'BUCKET', shortcut: 'B', x: 19, y: 1, width: 8 },
    { tool: 'eyedropper', label: 'DROPPER', shortcut: 'I', x: 28, y: 1, width: 9 },
    { tool: 'line', label: 'LINE', shortcut: 'L', x: 38, y: 1, width: 6 },
    { tool: 'rect_stroke', label: 'RECT', shortcut: 'R', x: 45, y: 1, width: 6 },
    { tool: 'rect_fill', label: 'FILL', shortcut: 'S', x: 52, y: 1, width: 6 },
    { tool: 'text', label: 'TEXT', shortcut: 'T', x: 59, y: 1, width: 6 },
  ];
  
  function get_button_at(x: number, y: number): ToolButton | null {
    for (const btn of buttons) {
      if (x >= btn.x && x < btn.x + btn.width && y === btn.y) {
        return btn;
      }
    }
    return null;
  }
  
  return {
    id: opts.id,
    rect,
    Focusable: true,
    
    Draw(c: Canvas): void {
      const bg_color = get_color_by_name('medium_gray').rgb;
      const border_color = get_color_by_name('dark_gray').rgb;
      const text_color = get_color_by_name('off_white').rgb;
      const selected_bg = get_color_by_name('vivid_blue').rgb;
      const selected_text = get_color_by_name('off_white').rgb;
      
      // Fill background
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });

      draw_module_border(c, {
        rect,
        style: PANEL_BORDER_PRESETS.default_double.style,
        border_rgb: border_color,
        weight_index: PANEL_BORDER_PRESETS.default_double.weight_index,
        header: { text: 'TOOLS' },
      });
      
      // Draw buttons
      for (const btn of buttons) {
        const is_selected = opts.get_current_tool() === btn.tool;
        const btn_color = is_selected ? selected_bg : bg_color;
        const txt_color = is_selected ? selected_text : text_color;
        const weight = is_selected ? 6 : 3;
        
        // Draw button background
        for (let bx = 0; bx < btn.width; bx++) {
          c.set(rect.x0 + btn.x + bx, rect.y0 + btn.y, { 
            char: ' ', 
            rgb: btn_color, 
            style: 'regular' 
          });
        }
        
        // Draw label
        for (let i = 0; i < btn.label.length && i < btn.width; i++) {
          const ch = btn.label.charAt(i);
          c.set(rect.x0 + btn.x + i, rect.y0 + btn.y, { 
            char: ch, 
            rgb: txt_color, 
            style: 'regular',
            weight_index: weight
          });
        }
      }
      
      // Draw title
      const title = 'ASCII PAINTER';
      const title_x = rect.x1 - title.length - 1;
      for (let i = 0; i < title.length; i++) {
        const ch = title.charAt(i);
        c.set(rect.x0 + title_x + i, rect.y0 + 1, { 
          char: ch, 
          rgb: text_color, 
          style: 'regular',
          weight_index: 5
        });
      }
    },
    
    OnPointerDown(e: PointerEvent): void {
      if (e.button !== 0) return;
      
      const rel_x = e.x - rect.x0;
      const rel_y = e.y - rect.y0;
      
      const btn = get_button_at(rel_x, rel_y);
      if (btn) {
        opts.on_tool_select(btn.tool);
      }
    },
    
    OnKeyDown(e: KeyboardEvent): void {
      const key = e.key.toUpperCase();
      
      for (const btn of buttons) {
        if (btn.shortcut === key) {
          opts.on_tool_select(btn.tool);
          return;
        }
      }
    }
  };
}
