/**
 * ASCII Painter File Menu Module
 *
 * Provides save/load/new/exit buttons for file operations.
 */

import type { Canvas, Module, Rect, PointerEvent, Rgb } from '../types.js';
import { get_color_by_name } from '../colors.js';

export type FileMenuOptions = {
  id: string;
  rect: Rect;

  // Callbacks
  on_save: () => void;
  on_load: () => void;
  on_new: () => void;
  on_export_text: () => void;
  on_clear: () => void;
  on_reset_positions?: () => void;
  on_toggle_toolbox?: () => void;
  on_toggle_char_selector?: () => void;
  on_toggle_color_selector?: () => void;
  on_toggle_weight_selector?: () => void;
  on_toggle_brush_preview?: () => void;
  on_toggle_tool_properties?: () => void;
  on_toggle_layer_palette?: () => void;
};

type MenuButton = {
  label: string;
  shortcut: string;
  action: () => void;
  x: number;
  y: number;
  width: number;
};

export function make_file_menu_module(opts: FileMenuOptions): Module {
  const rect = opts.rect;

  const buttons: MenuButton[] = [
    { label: 'NEW', shortcut: 'N', action: opts.on_new, x: 1, y: 0, width: 6 },
    { label: 'SAVE', shortcut: 'S', action: opts.on_save, x: 8, y: 0, width: 6 },
    { label: 'LOAD', shortcut: 'O', action: opts.on_load, x: 15, y: 0, width: 6 },
    { label: 'EXPORT', shortcut: 'E', action: opts.on_export_text, x: 22, y: 0, width: 8 },
    { label: 'CLEAR', shortcut: 'C', action: opts.on_clear, x: 31, y: 0, width: 7 },
  ];
  
  // Add module toggle buttons
  let module_button_x = 50;
  
  if (opts.on_toggle_toolbox) {
    buttons.push({ label: 'TOOLS', shortcut: '', action: opts.on_toggle_toolbox, x: module_button_x, y: 0, width: 7 });
    module_button_x += 8;
  }
  
  if (opts.on_toggle_char_selector) {
    buttons.push({ label: 'CHAR', shortcut: '', action: opts.on_toggle_char_selector, x: module_button_x, y: 0, width: 6 });
    module_button_x += 7;
  }
  
  if (opts.on_toggle_color_selector) {
    buttons.push({ label: 'COLOR', shortcut: '', action: opts.on_toggle_color_selector, x: module_button_x, y: 0, width: 7 });
    module_button_x += 8;
  }
  
  if (opts.on_toggle_weight_selector) {
    buttons.push({ label: 'WEIGHT', shortcut: '', action: opts.on_toggle_weight_selector, x: module_button_x, y: 0, width: 8 });
    module_button_x += 9;
  }
  
  if (opts.on_toggle_brush_preview) {
    buttons.push({ label: 'SWATCH', shortcut: '', action: opts.on_toggle_brush_preview, x: module_button_x, y: 0, width: 8 });
    module_button_x += 9;
  }
  
  if (opts.on_toggle_tool_properties) {
    buttons.push({ label: 'PROPS', shortcut: '', action: opts.on_toggle_tool_properties, x: module_button_x, y: 0, width: 7 });
    module_button_x += 8;
  }
  
  if (opts.on_toggle_layer_palette) {
    buttons.push({ label: 'LAYERS', shortcut: '', action: opts.on_toggle_layer_palette, x: module_button_x, y: 0, width: 8 });
    module_button_x += 9;
  }
  
  // Add reset positions button if callback provided
  if (opts.on_reset_positions) {
    buttons.push({ 
      label: 'RESET', 
      shortcut: '', 
      action: opts.on_reset_positions, 
      x: module_button_x, 
      y: 0, 
      width: 7 
    });
  }

  function get_button_at(x: number, y: number): MenuButton | null {
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
      const bg_color = get_color_by_name('deep_blue').rgb;
      const border_color = get_color_by_name('medium_gray').rgb;
      const text_color = get_color_by_name('off_white').rgb;
      const hover_bg = get_color_by_name('medium_gray').rgb;

      // Fill background
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });

      // Draw border
      for (let x = rect.x0; x <= rect.x1; x++) {
        c.set(x, rect.y0, { char: '─', rgb: border_color, style: 'regular', weight_index: 3 });
        c.set(x, rect.y1, { char: '─', rgb: border_color, style: 'regular', weight_index: 3 });
      }
      for (let y = rect.y0; y <= rect.y1; y++) {
        c.set(rect.x0, y, { char: '│', rgb: border_color, style: 'regular', weight_index: 3 });
        c.set(rect.x1, y, { char: '│', rgb: border_color, style: 'regular', weight_index: 3 });
      }
      c.set(rect.x0, rect.y0, { char: '┌', rgb: border_color, style: 'regular', weight_index: 3 });
      c.set(rect.x1, rect.y0, { char: '┐', rgb: border_color, style: 'regular', weight_index: 3 });
      c.set(rect.x0, rect.y1, { char: '└', rgb: border_color, style: 'regular', weight_index: 3 });
      c.set(rect.x1, rect.y1, { char: '┘', rgb: border_color, style: 'regular', weight_index: 3 });

      // Draw buttons
      for (const btn of buttons) {
        // Draw button background
        for (let bx = 0; bx < btn.width; bx++) {
          c.set(rect.x0 + btn.x + bx, rect.y0 + btn.y + 1, {
            char: ' ',
            rgb: bg_color,
            style: 'regular'
          });
        }

        // Draw label
        for (let i = 0; i < btn.label.length && i < btn.width; i++) {
          const ch = btn.label.charAt(i);
          c.set(rect.x0 + btn.x + i, rect.y0 + btn.y + 1, {
            char: ch,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
          });
        }
      }

      // Draw title
      const title = 'FILE';
      for (let i = 0; i < title.length; i++) {
        const ch = title.charAt(i);
        c.set(rect.x0 + 1 + i, rect.y0, {
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
        btn.action();
      }
    },

    OnKeyDown(e: KeyboardEvent): void {
      // Ctrl+ shortcuts
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toUpperCase();

        for (const btn of buttons) {
          if (btn.shortcut === key) {
            e.preventDefault();
            btn.action();
            return;
          }
        }
      }
    }
  };
}
