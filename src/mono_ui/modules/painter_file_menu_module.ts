/**
 * ASCII Painter File Menu Module
 *
 * Provides save/load/new/exit buttons for file operations.
 */

import type { Module, Rect } from '../types.js';
import { make_program_nav_bar_module, type ProgramNavAction } from './program_nav_bar_module.js';
import { make_command_action, make_tab, make_toggle_action } from './program_shell_bar_helpers.js';

export type FileMenuOptions = {
  id: string;
  rect: Rect;

  // Callbacks
  on_save?: () => void;
  on_load?: () => void;
  on_new?: () => void;
  on_export_text?: () => void;
  on_clear: () => void;
  on_rename_painting?: () => void;
  on_quit_painting?: () => void;
  on_reset_positions?: () => void;
  on_reset_camera?: () => void;
  on_toggle_toolbox?: () => void;
  on_toggle_char_selector?: () => void;
  on_toggle_color_selector?: () => void;
  on_toggle_color_block?: () => void;
  on_toggle_brush_preview?: () => void;
  on_toggle_tool_properties?: () => void;
  on_toggle_customization?: () => void;
  on_toggle_indexed_palette?: () => void;
  on_toggle_layer_palette?: () => void;
  on_toggle_camera?: () => void;
  on_toggle_controls?: () => void;
  get_is_host?: () => boolean;
  get_status_text?: () => string;
  get_screen_size?: () => { width: number; height: number };
  get_insets?: () => { left?: number; right?: number; top?: number; bottom?: number };
};

export function make_file_menu_module(opts: FileMenuOptions): Module {
  const module_items: ProgramNavAction[] = [];
  if (opts.on_toggle_toolbox) module_items.push(make_toggle_action({ id: 'tools', label: 'TOOLS', onPress: opts.on_toggle_toolbox }));
  if (opts.on_toggle_char_selector) module_items.push(make_toggle_action({ id: 'char', label: 'CHAR', onPress: opts.on_toggle_char_selector }));
  if (opts.on_toggle_color_selector) module_items.push(make_toggle_action({ id: 'color', label: 'COLOR', onPress: opts.on_toggle_color_selector }));
  if (opts.on_toggle_color_block) module_items.push(make_toggle_action({ id: 'color_block', label: 'BLOCK', onPress: opts.on_toggle_color_block }));
  if (opts.on_toggle_brush_preview) module_items.push(make_toggle_action({ id: 'swatch', label: 'SWATCH', onPress: opts.on_toggle_brush_preview }));
  if (opts.on_toggle_tool_properties) module_items.push(make_toggle_action({ id: 'props', label: 'PROPS', onPress: opts.on_toggle_tool_properties }));
  if (opts.on_toggle_customization) module_items.push(make_toggle_action({ id: 'custom', label: 'CUSTOM', onPress: opts.on_toggle_customization }));
  if (opts.on_toggle_indexed_palette) module_items.push(make_toggle_action({ id: 'indexed_palette', label: 'IPAL', onPress: opts.on_toggle_indexed_palette }));
  if (opts.on_toggle_layer_palette) module_items.push(make_toggle_action({ id: 'layers', label: 'LAYERS', onPress: opts.on_toggle_layer_palette }));
  if (opts.on_toggle_camera) module_items.push(make_toggle_action({ id: 'camera', label: 'CAMERA', onPress: opts.on_toggle_camera }));
  if (opts.on_toggle_controls) module_items.push(make_toggle_action({ id: 'controls', label: 'CTRLS', onPress: opts.on_toggle_controls }));

  return make_program_nav_bar_module({
    id: opts.id,
    get_screen_size: opts.get_screen_size ?? (() => ({ width: opts.rect.x1 - opts.rect.x0 + 1, height: opts.rect.y1 - opts.rect.y0 + 1 })),
    get_insets: opts.get_insets,
    default_expanded: true,
    get_status_text: opts.get_status_text,
    tabs: () => {
      const is_host = opts.get_is_host ? opts.get_is_host() : true;
      const ascii_items: ProgramNavAction[] = [];
      if (is_host && opts.on_new) ascii_items.push(make_command_action({ id: 'new', label: 'NEW', shortcut: 'N', shortcut_ctrl: true, onPress: opts.on_new }));
      if (is_host && opts.on_save) ascii_items.push(make_command_action({ id: 'save', label: 'SAVE', shortcut: 'S', shortcut_ctrl: true, onPress: opts.on_save }));
      if (is_host && opts.on_load) ascii_items.push(make_command_action({ id: 'load', label: 'LOAD', shortcut: 'O', shortcut_ctrl: true, onPress: opts.on_load }));
      ascii_items.push(make_command_action({ id: 'clear', label: 'CLEAR', shortcut: 'C', shortcut_ctrl: true, onPress: opts.on_clear }));

      const system_items: ProgramNavAction[] = [];
      if (is_host && opts.on_rename_painting) system_items.push(make_command_action({ id: 'rename', label: 'RENAME', onPress: opts.on_rename_painting }));
      if (opts.on_quit_painting) system_items.push(make_command_action({ id: 'quit', label: 'QUIT', onPress: opts.on_quit_painting }));
      if (opts.on_reset_positions) system_items.push(make_command_action({ id: 'reset', label: 'RESET', onPress: opts.on_reset_positions }));
      if (opts.on_reset_camera) system_items.push(make_command_action({ id: 'camdef', label: 'CAM-DEF', onPress: opts.on_reset_camera }));
      return [
        make_tab('ascii', 'ASCII', ascii_items),
        make_tab('modules', 'MODULES', module_items),
        make_tab('system', 'SYSTEM', system_items),
      ];
    },
  });
}
