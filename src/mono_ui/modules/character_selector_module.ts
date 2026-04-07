/**
 * ASCII Character Selector Module
 * 
 * A floating, movable module showing a scrollable vertical list
 * of all supported ASCII characters for the painter.
 * Click a character to select it as the brush character.
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent, WheelEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';

export type CharacterSelectorOptions = {
  id: string;
  rect: Rect;
  selected_char?: string;
  get_selected_char?: () => string;
  get_left_selected_char?: () => string;
  get_right_selected_char?: () => string;
  on_char_select: (char: string, button: number) => void;
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
  // Size constraints for resizing
  const MIN_WIDTH = 10;  // Minimum width
  const MAX_WIDTH = 30;  // Maximum width
  const MIN_HEIGHT = 8;  // Minimum height
  const MAX_HEIGHT = 40; // Maximum height
  
  // Gizmo configuration
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };
  
  // Scroll state
  let scroll_offset = 0;
  let selected_char = opts.selected_char ?? opts.get_selected_char?.() ?? '█';
  
  // Calculate visible rows based on height
  function get_visible_rows(rect: Rect): number {
    const inner_height = rect.y1 - rect.y0 - 2; // -2 for gizmo/title rows
    return Math.max(1, Math.floor(inner_height / CHAR_SPACING_Y));
  }
  
  function clamp_scroll(rect: Rect): void {
    const chars_per_row = get_chars_per_row(rect.x1 - rect.x0);
    const rows = Math.ceil(CHARACTER_SET.length / chars_per_row);
    const max_scroll = Math.max(0, rows - get_visible_rows(rect));
    scroll_offset = Math.max(0, Math.min(max_scroll, scroll_offset));
  }
  
  // Get character at grid position (row, col)
  function get_char_at(rect: Rect, row: number, col: number): string | null {
    const chars_per_row = get_chars_per_row(rect.x1 - rect.x0);
    const char_index = (scroll_offset + row) * chars_per_row + col;
    
    if (char_index >= 0 && char_index < CHARACTER_SET.length) {
      return CHARACTER_SET[char_index]!;
    }
    return null;
  }
  
  // Get grid position from screen coordinates
  function get_grid_pos_from_screen(rect: Rect, x: number, y: number): { row: number; col: number } | null {
    const chars_per_row = get_chars_per_row(rect.x1 - rect.x0);
    const start_x = rect.x0 + 2;
    const start_y = rect.y1 - 3;
    
    const col = Math.floor((x - start_x) / CHAR_SPACING_X);
    const row = Math.floor((start_y - y) / CHAR_SPACING_Y);
    
    if (col >= 0 && col < chars_per_row && row >= 0 && row < get_visible_rows(rect)) {
      return { row, col };
    }
    return null;
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: 'CHARS',
    gizmos: gizmo_config,
    background: { rgb: get_color_by_name('off_black').rgb },
    resize: {
      min_width: MIN_WIDTH,
      min_height: MIN_HEIGHT,
      max_width: MAX_WIDTH,
      max_height: MAX_HEIGHT,
    },
    draw_content(c: Canvas, rect: Rect): void {
      selected_char = opts.get_selected_char?.() ?? selected_char;
      const bg_color = get_color_by_name('off_black').rgb;
      const text_color = get_color_by_name('off_white').rgb;
      const selected_bg = get_color_by_name('vivid_blue').rgb;
      const selected_text = get_color_by_name('off_white').rgb;
      const left_selected_char = opts.get_left_selected_char?.() ?? selected_char;
      const right_selected_char = opts.get_right_selected_char?.() ?? selected_char;
      
      // Fill background
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });

      // Draw characters in a grid (responsive to width)
      const visible_rows = get_visible_rows(rect);
      const chars_per_row = get_chars_per_row(rect.x1 - rect.x0);
      const start_x = rect.x0 + 2;
      const start_y = rect.y1 - 3;
      
      for (let row = 0; row < visible_rows; row++) {
        for (let col = 0; col < chars_per_row; col++) {
          const char = get_char_at(rect, row, col);
          if (!char) continue;
          
          const char_x = start_x + (col * CHAR_SPACING_X);
          const char_y = start_y - (row * CHAR_SPACING_Y);
          
          if (char_y <= rect.y0) continue;
          
          const is_selected = char === selected_char;
          const is_left = char === left_selected_char;
          const is_right = char === right_selected_char;
          
          // Draw character
          c.set(char_x, char_y, {
            char: char,
            rgb: is_selected ? selected_text : text_color,
            style: 'regular',
            weight_index: is_selected ? 3 : 2
          });
          
          // Highlight background for selected
          if (is_selected) {
            c.set(char_x, char_y - 1, {
              char: ' ',
              rgb: selected_bg,
              style: 'regular'
            });
          }

          if ((is_left || is_right) && char_y - 1 > rect.y0) {
            const marker_char = is_left && is_right ? 'B' : is_left ? 'L' : 'R';
            const marker_rgb = is_left && is_right
              ? get_color_by_name('vivid_yellow').rgb
              : is_left
                ? get_color_by_name('vivid_blue').rgb
                : get_color_by_name('vivid_red').rgb;
            c.set(char_x, char_y - 1, {
              char: marker_char,
              rgb: marker_rgb,
              style: 'regular',
              weight_index: 2,
            });
          }
        }
      }
      
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
            weight_index: 2
          });
        }
      }
    },
    on_pointer_down_content(e: PointerEvent, rect: Rect): void {
      // Character selection - grid based
      const grid_pos = get_grid_pos_from_screen(rect, e.x, e.y);
      if (grid_pos) {
          const char = get_char_at(rect, grid_pos.row, grid_pos.col);
          if (char) {
            selected_char = char;
            opts.on_char_select(char, e.button);
          }
        }
      },
    on_wheel_content(e: WheelEvent, rect: Rect): void {
      const scroll_amount = e.delta_y > 0 ? 1 : -1;
      scroll_offset += scroll_amount;
      clamp_scroll(rect);
    },
  });
}
