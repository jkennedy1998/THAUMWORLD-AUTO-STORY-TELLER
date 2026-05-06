import { get_color_by_name, nearest_indexed_color, type ColorName } from '../colors.js';
import { read_slot_json_file, write_slot_json_file, write_slot_relative_json_file } from '../../engine_persistence/slot_json_store.js';
import type { Rgb } from '../types.js';
import type { ProfileScope } from '../../user_profiles/profile_scope.js';

export type UiSemanticColorRole =
  | 'background'
  | 'dimmest'
  | 'medium'
  | 'bright'
  | 'vivid'
  | 'right_hand'
  | 'left_hand';

export type UiCustomizationState = {
  version: 1;
  colors: Record<UiSemanticColorRole, Rgb>;
};

type UiCustomizationFile = UiCustomizationState;

const UI_CUSTOMIZATION_FILE_NAME = 'ui_customization.json';

const UI_ROLE_DEFAULTS: Record<UiSemanticColorRole, ColorName> = {
  background: 'off_black',
  dimmest: 'deep_blue',
  medium: 'medium_gray',
  bright: 'pale_gray',
  vivid: 'vivid_cyan',
  right_hand: 'vivid_red',
  left_hand: 'vivid_blue',
};

let current_ui_customization: UiCustomizationState = build_default_ui_customization();

function clone_rgb(rgb: Rgb): Rgb {
  return { r: rgb.r, g: rgb.g, b: rgb.b };
}

function sanitize_rgb(value: unknown, fallback: Rgb): Rgb {
  const candidate = value as Partial<Rgb> | null | undefined;
  const safe = {
    r: Number.isFinite(candidate?.r) ? Math.max(0, Math.min(255, Math.round(candidate!.r as number))) : fallback.r,
    g: Number.isFinite(candidate?.g) ? Math.max(0, Math.min(255, Math.round(candidate!.g as number))) : fallback.g,
    b: Number.isFinite(candidate?.b) ? Math.max(0, Math.min(255, Math.round(candidate!.b as number))) : fallback.b,
  };
  return clone_rgb(nearest_indexed_color(safe).rgb);
}

export function build_default_ui_customization(opts?: { vivid_seed_rgb?: Rgb | null }): UiCustomizationState {
  const colors = Object.fromEntries(
    (Object.keys(UI_ROLE_DEFAULTS) as UiSemanticColorRole[]).map((role) => [role, clone_rgb(get_color_by_name(UI_ROLE_DEFAULTS[role]).rgb)]),
  ) as Record<UiSemanticColorRole, Rgb>;
  if (opts?.vivid_seed_rgb) {
    colors.vivid = clone_rgb(nearest_indexed_color(opts.vivid_seed_rgb).rgb);
  }
  return { version: 1, colors };
}

function sanitize_ui_customization_file(raw: unknown, defaults: UiCustomizationState): UiCustomizationState {
  const source = raw && typeof raw === 'object' ? raw as Partial<UiCustomizationFile> : {};
  const raw_colors = source.colors && typeof source.colors === 'object' ? source.colors : {};
  const colors = {} as Record<UiSemanticColorRole, Rgb>;
  for (const role of Object.keys(UI_ROLE_DEFAULTS) as UiSemanticColorRole[]) {
    colors[role] = sanitize_rgb((raw_colors as Record<string, unknown>)[role], defaults.colors[role]);
  }
  return {
    version: 1,
    colors,
  };
}

export function get_ui_customization_state(): UiCustomizationState {
  return {
    version: 1,
    colors: {
      background: clone_rgb(current_ui_customization.colors.background),
      dimmest: clone_rgb(current_ui_customization.colors.dimmest),
      medium: clone_rgb(current_ui_customization.colors.medium),
      bright: clone_rgb(current_ui_customization.colors.bright),
      vivid: clone_rgb(current_ui_customization.colors.vivid),
      right_hand: clone_rgb(current_ui_customization.colors.right_hand),
      left_hand: clone_rgb(current_ui_customization.colors.left_hand),
    },
  };
}

export function get_ui_semantic_rgb(role: UiSemanticColorRole): Rgb {
  return clone_rgb(current_ui_customization.colors[role]);
}

export function set_ui_customization_state(next: UiCustomizationState): UiCustomizationState {
  current_ui_customization = sanitize_ui_customization_file(next, build_default_ui_customization());
  return get_ui_customization_state();
}

export function set_ui_customization_role_color(role: UiSemanticColorRole, rgb: Rgb): UiCustomizationState {
  const next = get_ui_customization_state();
  next.colors[role] = sanitize_rgb(rgb, next.colors[role]);
  return set_ui_customization_state(next);
}

export async function load_ui_customization_state(slot: number, opts?: { vivid_seed_rgb?: Rgb | null; profile_scope?: ProfileScope | null }): Promise<UiCustomizationState> {
  const defaults = build_default_ui_customization(opts);
  const scoped_response = opts?.profile_scope ? await read_slot_json_file<UiCustomizationFile>(slot, opts.profile_scope.files.ui_customization) : null;
  const response = scoped_response?.data ? scoped_response : await read_slot_json_file<UiCustomizationFile>(slot, UI_CUSTOMIZATION_FILE_NAME);
  if (!response.data) {
    current_ui_customization = defaults;
    await write_slot_json_file(slot, opts?.profile_scope?.files.ui_customization ?? UI_CUSTOMIZATION_FILE_NAME, current_ui_customization).catch(() => null);
    return get_ui_customization_state();
  }
  current_ui_customization = sanitize_ui_customization_file(response.data, defaults);
  if (opts?.profile_scope && !scoped_response?.data) {
    await write_slot_relative_json_file(slot, opts.profile_scope.files.ui_customization, current_ui_customization).catch(() => null);
  }
  return get_ui_customization_state();
}

export async function save_ui_customization_state(slot: number, next: UiCustomizationState, profile_scope?: ProfileScope | null): Promise<UiCustomizationState> {
  const sanitized = set_ui_customization_state(next);
  await write_slot_json_file(slot, profile_scope?.files.ui_customization ?? UI_CUSTOMIZATION_FILE_NAME, sanitized);
  return sanitized;
}

export async function save_ui_customization_role_color(slot: number, role: UiSemanticColorRole, rgb: Rgb, profile_scope?: ProfileScope | null): Promise<UiCustomizationState> {
  const next = set_ui_customization_role_color(role, rgb);
  await write_slot_json_file(slot, profile_scope?.files.ui_customization ?? UI_CUSTOMIZATION_FILE_NAME, next);
  return next;
}

export function get_ui_semantic_role_label(role: UiSemanticColorRole): string {
  switch (role) {
    case 'background': return 'BACKGROUND';
    case 'dimmest': return 'DIMMEST';
    case 'medium': return 'MEDIUM';
    case 'bright': return 'BRIGHT';
    case 'vivid': return 'VIVID';
    case 'right_hand': return 'RIGHT HAND';
    case 'left_hand': return 'LEFT HAND';
  }
}

export function list_ui_semantic_roles(): UiSemanticColorRole[] {
  return ['background', 'dimmest', 'medium', 'bright', 'vivid', 'right_hand', 'left_hand'];
}
