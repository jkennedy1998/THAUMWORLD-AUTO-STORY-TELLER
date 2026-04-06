import type { Module } from '../types.js';
import { make_screen_overlay_bar_module } from './screen_overlay_bar_module.js';

export type ProgramNavAction = {
  id: string;
  label: string | (() => string);
  width?: number;
  shortcut?: string;
  shortcut_ctrl?: boolean;
  onPress: () => void | Promise<void>;
  is_active?: () => boolean;
};

export type ProgramNavTab = {
  id: string;
  label: string | (() => string);
  width?: number;
  items?: ProgramNavAction[] | (() => ProgramNavAction[]);
  is_visible?: () => boolean;
};

export type ProgramNavBarOptions = {
  id: string;
  get_screen_size: () => { width: number; height: number };
  get_insets?: () => { left?: number; right?: number; top?: number; bottom?: number };
  get_status_text?: () => string;
  get_is_visible?: () => boolean;
  get_is_expanded?: () => boolean;
  set_is_expanded?: (expanded: boolean) => void;
  default_expanded?: boolean;
  collapsed_height?: number;
  expanded_height?: number;
  inset_left?: number;
  inset_right?: number;
  inset_top?: number;
  inset_bottom?: number;
  tabs: () => ProgramNavTab[];
};

export function make_program_nav_bar_module(opts: ProgramNavBarOptions): Module {
  return make_screen_overlay_bar_module({
    id: opts.id,
    get_screen_size: opts.get_screen_size,
    get_insets: opts.get_insets,
    get_status_text: opts.get_status_text,
    get_is_visible: opts.get_is_visible,
    get_is_expanded: opts.get_is_expanded,
    set_is_expanded: opts.set_is_expanded,
    default_expanded: opts.default_expanded,
    collapsed_height: opts.collapsed_height,
    expanded_height: opts.expanded_height,
    inset_left: opts.inset_left,
    inset_right: opts.inset_right,
    inset_top: opts.inset_top,
    inset_bottom: opts.inset_bottom,
    buttons: () => {
      const first_visible_tab = opts.tabs().find((tab) => tab.is_visible ? tab.is_visible() : true);
      if (!first_visible_tab?.items) return [];
      return typeof first_visible_tab.items === 'function' ? first_visible_tab.items() : first_visible_tab.items;
    },
    tabs: opts.tabs,
  });
}
