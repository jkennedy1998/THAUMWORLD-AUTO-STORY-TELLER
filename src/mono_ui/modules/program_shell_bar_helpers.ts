import type { ProgramNavAction, ProgramNavTab } from './program_nav_bar_module.js';

export type ProgramShellActionConfig = {
  id: string;
  label: string;
  onPress: () => void | Promise<void>;
  is_active?: () => boolean;
  shortcut?: string;
  shortcut_ctrl?: boolean;
  width?: number;
};

export function get_compact_nav_width(label: string, min = 5): number {
  return Math.max(min, label.length + 1);
}

export function make_command_action(config: ProgramShellActionConfig): ProgramNavAction {
  return {
    id: config.id,
    label: config.label,
    onPress: config.onPress,
    is_active: config.is_active,
    shortcut: config.shortcut,
    shortcut_ctrl: config.shortcut_ctrl,
    width: config.width ?? get_compact_nav_width(config.label),
  };
}

export function make_toggle_action(config: ProgramShellActionConfig): ProgramNavAction {
  return make_command_action(config);
}

export function make_tab(id: string, label: string, items: ProgramNavAction[]): ProgramNavTab {
  return {
    id,
    label,
    width: get_compact_nav_width(label),
    items,
  };
}

export function make_conditional_tab(visible: boolean, tab: ProgramNavTab): ProgramNavTab[] {
  return visible ? [tab] : [];
}

export function compact_toggle_label(label: string): string {
  return label.trim().toUpperCase();
}
