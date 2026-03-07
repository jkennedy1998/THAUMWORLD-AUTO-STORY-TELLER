/**
 * ASCII Character Selector Module
 * 
 * A floating, movable module showing a scrollable vertical list
 * of all supported ASCII characters for the painter.
 * Click a character to select it as the brush character.
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent, WheelEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import { draw_module_border, BORDER_STYLES } from '../module_borders.js';
import type { ModuleGizmosConfig, GizmoState } from '../module_gizmos.js';
import { draw_module_gizmos, handle_gizmo_click, create_gizmo_state, is_in_gizmo_area, handle_move_drag, get_resize_edge, handle_resize_drag, handle_global_pointer_down_for_gizmos } from '../module_gizmos.js';

export type CharacterSelectorOptions = {
  id: string;
  rect: Rect;
  selected_char: string;
  on_char_select: (char: string) => void;
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

// Comprehensive character set - Martian Mono + Noto Sans Mono fallbacks
// Organized by category for easier selection
const CHARACTER_SET: string[] = [
  // Block elements (commonly used)
  '█', '▓', '▒', '░', '■', '□', '▪', '▫',
  
  // Box drawing
  '─', '│', '┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼',
  '═', '║', '╔', '╗', '╚', '╝', '╠', '╣', '╦', '╩', '╬',
  
  // Geometric shapes
  '●', '○', '◐', '◑', '◒', '◓', '◔', '◕',
  '▲', '▼', '◀', '▶', '△', '▽', '◁', '▷',
  '◆', '◇', '◈', '○', '◎', '●',
  
  // Basic ASCII symbols
  '!', '"', '#', '$', '%', '&', "'", '(', ')', '*', '+', ',', '-', '.', '/',
  ':', ';', '<', '=', '>', '?', '@',
  '[', '\\', ']', '^', '_', '`',
  '{', '|', '}', '~',
  
  // Math symbols
  '±', '×', '÷', '√', '∞', '∑', '∏', '∫', '∂', '∆', '∇',
  '≈', '≠', '≡', '≤', '≥', '≪', '≫',
  '¼', '½', '¾', '¹', '²', '³', '°', '′', '″',
  
  // Arrows
  '←', '↑', '→', '↓', '↔', '↕',
  '⇐', '⇑', '⇒', '⇓', '⇔', '⇕',
  '↖', '↗', '↘', '↙',
  
  // Currency
  '¢', '£', '¥', '€', '₹', '₽', '₩', '₪', '₫', '₱', '฿',
  
  // Letters (uppercase)
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  
  // Letters (lowercase)
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  
  // Numbers
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  
  // Punctuation
  '¡', '¿', '«', '»', '‹', '›', '„', '“', '”', '‘', '\'',
  '•', '‣', '⁃', '◦',
  
  // Special UI chars
  '☐', '☑', '☒', '✓', '✗',
  '★', '☆', '✦', '✧',
  '♠', '♥', '♦', '♣',
  '♪', '♫', '♭', '♯',
  
  // Other symbols
  '©', '®', '™', '℠', '℗',
  '§', '¶', '†', '‡', '•', '·',
  '…', '―', '–', '—',
  
  // Greek letters
  'α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ',
  'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω',
  'Α', 'Β', 'Γ', 'Δ', 'Ε', 'Ζ', 'Η', 'Θ', 'Ι', 'Κ', 'Λ', 'Μ',
  'Ν', 'Ξ', 'Ο', 'Π', 'Ρ', 'Σ', 'Τ', 'Υ', 'Φ', 'Χ', 'Ψ', 'Ω',
  
  // Box drawing heavy
  '━', '┃', '┏', '┓', '┗', '┛', '┣', '┫', '┳', '┻', '╋',
  
  // Additional blocks
  '▄', '▀', '▌', '▐', '▖', '▗', '▘', '▙', '▚', '▛', '▜', '▝', '▞', '▟',
];

// Grid layout - responsive to module size
const CHAR_SPACING_X = 2;  // Space between chars horizontally
const CHAR_SPACING_Y = 2;  // Space between chars vertically (1 row gap)

// Calculate how many characters fit per row based on width
function get_chars_per_row(width: number): number {
  const inner_width = width - 3; // -3 for borders and padding
  return Math.max(2, Math.floor(inner_width / CHAR_SPACING_X));
}

export function make_character_selector_module(opts: CharacterSelectorOptions): Module {
  // Mutable rect for moving
  let rect = opts.rect;
  
  // Size constraints for resizing
  const MIN_WIDTH = 10;  // Minimum width
  const MAX_WIDTH = 30;  // Maximum width
  const MIN_HEIGHT = 8;  // Minimum height
  const MAX_HEIGHT = 40; // Maximum height
  
  // Gizmo configuration
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };
  
  const gizmo_state: GizmoState = create_gizmo_state();
  
  // Scroll state
  let scroll_offset = 0;
  let selected_char = opts.selected_char;
  
  // Calculate visible rows based on height
  function get_visible_rows(): number {
    const inner_height = rect.y1 - rect.y0 - 2; // -2 for gizmo/title rows
    return Math.max(1, Math.floor(inner_height / CHAR_SPACING_Y));
  }
  
  function get_visible_count(): number {
    return get_visible_rows() * get_chars_per_row(rect.x1 - rect.x0);
  }
  
  function clamp_scroll(): void {
    const chars_per_row = get_chars_per_row(rect.x1 - rect.x0);
    const rows = Math.ceil(CHARACTER_SET.length / chars_per_row);
    const max_scroll = Math.max(0, rows - get_visible_rows());
    scroll_offset = Math.max(0, Math.min(max_scroll, scroll_offset));
  }
  
  // Get character at grid position (row, col)
  function get_char_at(row: number, col: number): string | null {
    const chars_per_row = get_chars_per_row(rect.x1 - rect.x0);
    const char_index = (scroll_offset + row) * chars_per_row + col;
    
    if (char_index >= 0 && char_index < CHARACTER_SET.length) {
      return CHARACTER_SET[char_index]!;
    }
    return null;
  }
  
  // Get grid position from screen coordinates
  function get_grid_pos_from_screen(x: number, y: number): { row: number; col: number } | null {
    const chars_per_row = get_chars_per_row(rect.x1 - rect.x0);
    const start_x = rect.x0 + 2;
    const start_y = rect.y1 - 3;
    
    const col = Math.floor((x - start_x) / CHAR_SPACING_X);
    const row = Math.floor((start_y - y) / CHAR_SPACING_Y);
    
    if (col >= 0 && col < chars_per_row && row >= 0 && row < get_visible_rows()) {
      return { row, col };
    }
    return null;
  }
  
  // Check if coordinates are in the character list area (not gizmo area)
  function is_in_content_area(x: number, y: number): boolean {
    return x > rect.x0 && x < rect.x1 && y > rect.y0 && y < rect.y1 - 1;
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
      const selected_bg = get_color_by_name('vivid_blue').rgb;
      const selected_text = get_color_by_name('off_white').rgb;
      
      // Fill background
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });

      draw_module_border(c, {
        rect,
        style: BORDER_STYLES.double,
        border_rgb: border_color,
        weight_index: 3,
        header: {
          text: 'CHARS',
          reserve_left_cols: 2 + ((gizmo_config.enabled?.length ?? 0) * 2),
        },
      });
      
      // Draw characters in a grid (responsive to width)
      const visible_rows = get_visible_rows();
      const chars_per_row = get_chars_per_row(rect.x1 - rect.x0);
      const start_x = rect.x0 + 2;
      const start_y = rect.y1 - 3;
      
      for (let row = 0; row < visible_rows; row++) {
        for (let col = 0; col < chars_per_row; col++) {
          const char = get_char_at(row, col);
          if (!char) continue;
          
          const char_x = start_x + (col * CHAR_SPACING_X);
          const char_y = start_y - (row * CHAR_SPACING_Y);
          
          if (char_y <= rect.y0) continue;
          
          const is_selected = char === selected_char;
          
          // Draw character
          c.set(char_x, char_y, {
            char: char,
            rgb: is_selected ? selected_text : text_color,
            style: 'regular',
            weight_index: is_selected ? 6 : 4
          });
          
          // Highlight background for selected
          if (is_selected) {
            c.set(char_x, char_y - 1, {
              char: ' ',
              rgb: selected_bg,
              style: 'regular'
            });
          }
        }
      }
      
      // Draw gizmos
      draw_module_gizmos(c, rect, gizmo_config, gizmo_state, 'CHARS');
      
      // Draw scroll indicator if needed
      const total_rows = Math.ceil(CHARACTER_SET.length / chars_per_row);
      if (total_rows > visible_rows) {
        const scroll_percent = scroll_offset / (total_rows - visible_rows);
        const indicator_y = rect.y1 - 3 - Math.floor(scroll_percent * (visible_rows - 1)) * CHAR_SPACING_Y;
        if (indicator_y > rect.y0) {
          c.set(rect.x1 - 1, indicator_y, {
            char: '│',
            rgb: get_color_by_name('pale_yellow').rgb,
            style: 'regular',
            weight_index: 5
          });
        }
      }
    },

    OnGlobalPointerDown(e: PointerEvent): void {
      handle_global_pointer_down_for_gizmos(e, rect, gizmo_config, gizmo_state);
    },

    OnPointerDown(e: PointerEvent): void {
      // Check gizmo area first
      if (is_in_gizmo_area(e.x, e.y, rect)) {
        const gizmo = handle_gizmo_click(e.x, e.y, rect, gizmo_config, gizmo_state);
        if (gizmo === 'move') {
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
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
      
      // Character selection - grid based
      const grid_pos = get_grid_pos_from_screen(e.x, e.y);
      if (grid_pos) {
        const char = get_char_at(grid_pos.row, grid_pos.col);
        if (char) {
          selected_char = char;
          opts.on_char_select(char);
        }
      }
    },

    OnPointerMove(e: PointerEvent): void {
      // Update resize edge hover state
      if (gizmo_state.is_resize_mode && !gizmo_state.is_dragging_resize) {
        gizmo_state.resize_edge = get_resize_edge(e.x, e.y, rect);
      }
    },

    OnDragMove(e: DragEvent): void {
      if (gizmo_state.is_move_mode && gizmo_state.original_rect) {
        const dx = e.x - gizmo_state.move_start_x;
        const dy = e.y - gizmo_state.move_start_y;
        
        const new_rect: Rect = {
          x0: gizmo_state.original_rect.x0 + dx,
          y0: gizmo_state.original_rect.y0 + dy,
          x1: gizmo_state.original_rect.x1 + dx,
          y1: gizmo_state.original_rect.y1 + dy,
        };
        
        rect = new_rect;
        
        if (opts.on_move) {
          opts.on_move(rect);
        }
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
            if (opts.on_move) {
              opts.on_move(rect);
            }
          }
        );
        
        if (new_rect) {
          rect = new_rect;
        }
      }
    },

    OnPointerUp(): void {
      if (gizmo_state.is_move_mode) {
        gizmo_state.is_move_mode = false;
        if (opts.on_move) {
          opts.on_move(rect);
        }
      }
      
      if (gizmo_state.is_dragging_resize) {
        gizmo_state.is_dragging_resize = false;
        gizmo_state.resize_edge = null;
        if (opts.on_move) {
          opts.on_move(rect);
        }
      }
    },

    OnWheel(e: WheelEvent): void {
      const scroll_amount = e.delta_y > 0 ? 1 : -1;
      scroll_offset += scroll_amount;
      clamp_scroll();
    },
  };
}
