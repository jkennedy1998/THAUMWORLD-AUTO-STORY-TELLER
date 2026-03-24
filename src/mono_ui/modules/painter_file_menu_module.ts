/**
 * ASCII Painter File Menu Module
 *
 * Provides save/load/new/exit buttons for file operations.
 */

import type { Module, Rect } from '../types.js';
import { make_screen_overlay_bar_module } from './screen_overlay_bar_module.js';

export type FileMenuOptions = {
  id: string;
  rect: Rect;

  // Callbacks
  on_save: () => void;
  on_load: () => void;
  on_new: () => void;
  on_export_text?: () => void;
  on_clear: () => void;
  on_reset_positions?: () => void;
  on_reset_camera?: () => void;
  on_toggle_toolbox?: () => void;
  on_toggle_char_selector?: () => void;
  on_toggle_color_selector?: () => void;
  on_toggle_weight_selector?: () => void;
  on_toggle_brush_preview?: () => void;
  on_toggle_tool_properties?: () => void;
  on_toggle_layer_palette?: () => void;
  on_toggle_camera?: () => void;
  get_status_text?: () => string;
  get_screen_size?: () => { width: number; height: number };
};

export function make_file_menu_module(opts: FileMenuOptions): Module {
  const buttons: Array<{ id: string; label: string; shortcut?: string; shortcut_ctrl?: boolean; onPress: () => void; width: number }> = [
    { id: 'new', label: 'NEW', shortcut: 'N', shortcut_ctrl: true, onPress: opts.on_new, width: 6 },
    { id: 'save', label: 'SAVE', shortcut: 'S', shortcut_ctrl: true, onPress: opts.on_save, width: 6 },
    { id: 'load', label: 'LOAD', shortcut: 'O', shortcut_ctrl: true, onPress: opts.on_load, width: 6 },
    { id: 'clear', label: 'CLEAR', shortcut: 'C', shortcut_ctrl: true, onPress: opts.on_clear, width: 7 },
  ];

  if (opts.on_toggle_toolbox) buttons.push({ id: 'tools', label: 'TOOLS', onPress: opts.on_toggle_toolbox, width: 7 });
  if (opts.on_toggle_char_selector) buttons.push({ id: 'char', label: 'CHAR', onPress: opts.on_toggle_char_selector, width: 6 });
  if (opts.on_toggle_color_selector) buttons.push({ id: 'color', label: 'COLOR', onPress: opts.on_toggle_color_selector, width: 7 });
  if (opts.on_toggle_weight_selector) buttons.push({ id: 'weight', label: 'WEIGHT', onPress: opts.on_toggle_weight_selector, width: 8 });
  if (opts.on_toggle_brush_preview) buttons.push({ id: 'swatch', label: 'SWATCH', onPress: opts.on_toggle_brush_preview, width: 8 });
  if (opts.on_toggle_tool_properties) buttons.push({ id: 'props', label: 'PROPS', onPress: opts.on_toggle_tool_properties, width: 7 });
  if (opts.on_toggle_layer_palette) buttons.push({ id: 'layers', label: 'LAYERS', onPress: opts.on_toggle_layer_palette, width: 8 });
  if (opts.on_toggle_camera) buttons.push({ id: 'camera', label: 'CAMERA', onPress: opts.on_toggle_camera, width: 8 });
  if (opts.on_reset_positions) buttons.push({ id: 'reset', label: 'RESET', onPress: opts.on_reset_positions, width: 7 });
  if (opts.on_reset_camera) buttons.push({ id: 'camdef', label: 'CAM-DEF', onPress: opts.on_reset_camera, width: 9 });

  return make_screen_overlay_bar_module({
    id: opts.id,
    title: 'PAINTER',
    get_screen_size: opts.get_screen_size ?? (() => ({ width: opts.rect.x1 - opts.rect.x0 + 1, height: opts.rect.y1 - opts.rect.y0 + 1 })),
    default_expanded: true,
    get_status_text: opts.get_status_text,
    buttons: () => buttons,
  });
}
