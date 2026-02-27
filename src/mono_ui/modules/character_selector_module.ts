/**
 * ASCII Character Selector Module
 * 
 * A floating, movable module showing a scrollable vertical list
 * of all supported ASCII characters for the painter.
 * Click a character to select it as the brush character.
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent, WheelEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import type { ModuleGizmosConfig, GizmoState } from '../module_gizmos.js';
import { draw_module_gizmos, handle_gizmo_click, create_gizmo_state, is_in_gizmo_area, handle_move_drag } from '../module_gizmos.js';

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

// Width of the module
const MODULE_WIDTH = 6;  // 1 border + 1 padding + 2 for char + 1 padding + 1 border

export function make_character_selector_module(opts: CharacterSelectorOptions): Module {
  // Mutable rect for moving
  let rect = opts.rect;
  
  // Gizmo configuration
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'close'],
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
  
  // Calculate visible characters based on height
  function get_visible_count(): number {
    const inner_height = rect.y1 - rect.y0 - 1; // -1 for gizmo row
    return Math.max(1, inner_height);
  }
  
  function clamp_scroll(): void {
    const max_scroll = Math.max(0, CHARACTER_SET.length - get_visible_count());
    scroll_offset = Math.max(0, Math.min(max_scroll, scroll_offset));
  }
  
  // Get character at screen position (local coordinates)
  function get_char_at(local_y: number): string | null {
    const visible_count = get_visible_count();
    const char_index = scroll_offset + local_y;
    
    if (char_index >= 0 && char_index < CHARACTER_SET.length) {
      return CHARACTER_SET[char_index]!;
    }
    return null;
  }
  
  // Check if coordinates are in the character list area (not gizmo area)
  function is_in_content_area(x: number, y: number): boolean {
    return x > rect.x0 && x < rect.x1 && y > rect.y0 && y < rect.y1;
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
      const title = 'CHARS';
      const title_y = rect.y1 - 1;
      for (let i = 0; i < title.length && i < rect.x1 - rect.x0 - 2; i++) {
        const char = title[i]!;
        c.set(rect.x0 + 3 + i, title_y, { 
          char: char, 
          rgb: text_color, 
          style: 'regular',
          weight_index: 4 
        });
      }
      
      // Draw characters with spacing
      const visible_count = get_visible_count();
      const center_x = Math.floor((rect.x0 + rect.x1) / 2);
      
      for (let i = 0; i < visible_count; i++) {
        const char_index = scroll_offset + i;
        if (char_index >= CHARACTER_SET.length) break;
        
        const char_y = rect.y1 - 2 - (i * 2); // Skip 1 row between chars
        if (char_y <= rect.y0) break;
        
        const char = CHARACTER_SET[char_index]!;
        const is_selected = char === selected_char;
        
        // Draw character
        c.set(center_x, char_y, {
          char: char,
          rgb: is_selected ? selected_text : text_color,
          style: 'regular',
          weight_index: is_selected ? 6 : 4
        });
        
        // Highlight background for selected
        if (is_selected) {
          c.set(center_x, char_y + 1, {
            char: ' ',
            rgb: selected_bg,
            style: 'regular'
          });
        }
      }
      
      // Draw gizmos
      draw_module_gizmos(c, rect, gizmo_config, gizmo_state);
      
      // Draw scroll indicator if needed
      if (CHARACTER_SET.length > visible_count) {
        const scroll_percent = scroll_offset / (CHARACTER_SET.length - visible_count);
        const indicator_y = rect.y1 - 2 - Math.floor(scroll_percent * (visible_count - 1)) * 2;
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
      
      // Check if in content area
      if (!is_in_content_area(e.x, e.y)) return;
      
      // Handle move mode
      if (gizmo_state.is_move_mode) {
        gizmo_state.move_start_x = e.x;
        gizmo_state.move_start_y = e.y;
        return;
      }
      
      // Character selection
      const local_y = Math.floor((rect.y1 - 1 - e.y) / 2);
      const char = get_char_at(local_y);
      
      if (char) {
        selected_char = char;
        opts.on_char_select(char);
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
      }
    },

    OnPointerUp(): void {
      if (gizmo_state.is_move_mode) {
        gizmo_state.is_move_mode = false;
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
