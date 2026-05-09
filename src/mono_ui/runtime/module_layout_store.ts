import type { Rect } from '../types.js';
import { read_slot_json_file, write_slot_json_file } from '../../engine_persistence/slot_json_store.js';
import type { CameraSettingsAppId } from './camera_limits.js';
import type { ProfileScope } from '../../user_profiles/profile_scope.js';

export type ModulePositionData = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type ModulePositions = Record<string, ModulePositionData>;
export type ModuleVisibility = Record<string, boolean>;
export type LayoutSlotId = string;
export type ModuleConfigState = Record<string, unknown>;

export type ModuleLayoutSlotState = {
  positions: ModulePositions;
  visibility: ModuleVisibility;
  module_config?: ModuleConfigState;
};

export type AppLayoutSlotsState = {
  active_slot_id: LayoutSlotId;
  slots: Record<string, ModuleLayoutSlotState>;
};

export type ModuleLayoutFileV1 = {
  version: 1;
  apps: Partial<Record<CameraSettingsAppId, {
    positions: ModulePositions;
    visibility: ModuleVisibility;
  }>>;
};

export type ModuleLayoutFileV2 = {
  version: 2;
  apps: Partial<Record<CameraSettingsAppId, AppLayoutSlotsState>>;
};

export type ModuleLayoutFile = ModuleLayoutFileV1 | ModuleLayoutFileV2;

const MODULE_LAYOUT_FILE_NAME = 'module_layouts.json';
const DEFAULT_LAYOUT_SLOT_ID = 'default';

let current_module_layouts: ModuleLayoutFileV2 = { version: 2, apps: {} };

function clone_rect_data(rect: ModulePositionData): ModulePositionData {
  return { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 };
}

function clone_slot_state(slot: ModuleLayoutSlotState): ModuleLayoutSlotState {
  return {
    positions: Object.fromEntries(Object.entries(slot.positions).map(([key, rect]) => [key, clone_rect_data(rect)])),
    visibility: { ...slot.visibility },
    module_config: slot.module_config ? { ...slot.module_config } : undefined,
  };
}

function sanitize_rect(value: unknown): ModulePositionData | null {
  const candidate = value as Partial<ModulePositionData> | null | undefined;
  if (!candidate) return null;
  const nums = [candidate.x0, candidate.y0, candidate.x1, candidate.y1].map((n) => typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null);
  if (nums.some((n) => n === null)) return null;
  return { x0: nums[0]!, y0: nums[1]!, x1: nums[2]!, y1: nums[3]! };
}

function sanitize_slot_id(value: unknown): LayoutSlotId {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || DEFAULT_LAYOUT_SLOT_ID;
}

function sanitize_slot_state(raw: unknown): ModuleLayoutSlotState {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const raw_positions = source.positions && typeof source.positions === 'object' ? source.positions as Record<string, unknown> : {};
  const raw_visibility = source.visibility && typeof source.visibility === 'object' ? source.visibility as Record<string, unknown> : {};
  const positions: ModulePositions = {};
  const visibility: ModuleVisibility = {};
  for (const [key, value] of Object.entries(raw_positions)) {
    const rect = sanitize_rect(value);
    if (rect) positions[key] = rect;
  }
  for (const [key, value] of Object.entries(raw_visibility)) {
    if (typeof value === 'boolean') visibility[key] = value;
  }
  return {
    positions,
    visibility,
    module_config: source.module_config && typeof source.module_config === 'object'
      ? { ...(source.module_config as Record<string, unknown>) }
      : undefined,
  };
}

function sanitize_module_layout_file_v1(raw: unknown): ModuleLayoutFileV2 {
  const source = raw && typeof raw === 'object' ? raw as Partial<ModuleLayoutFileV1> : {};
  const apps = source.apps && typeof source.apps === 'object' ? source.apps as Record<string, unknown> : {};
  const out: ModuleLayoutFileV2 = { version: 2, apps: {} };
  for (const app_id of ['thaum_painter', 'thaum_world'] as CameraSettingsAppId[]) {
    const app = apps[app_id] && typeof apps[app_id] === 'object' ? apps[app_id] as Record<string, unknown> : {};
    out.apps[app_id] = {
      active_slot_id: DEFAULT_LAYOUT_SLOT_ID,
      slots: {
        [DEFAULT_LAYOUT_SLOT_ID]: sanitize_slot_state(app),
      },
    };
  }
  return out;
}

function sanitize_module_layout_file_v2(raw: unknown): ModuleLayoutFileV2 {
  const source = raw && typeof raw === 'object' ? raw as Partial<ModuleLayoutFileV2> : {};
  const apps = source.apps && typeof source.apps === 'object' ? source.apps as Record<string, unknown> : {};
  const out: ModuleLayoutFileV2 = { version: 2, apps: {} };
  for (const app_id of ['thaum_painter', 'thaum_world'] as CameraSettingsAppId[]) {
    const app = apps[app_id] && typeof apps[app_id] === 'object' ? apps[app_id] as Record<string, unknown> : {};
    const raw_slots = app.slots && typeof app.slots === 'object' ? app.slots as Record<string, unknown> : {};
    const slots: Record<string, ModuleLayoutSlotState> = {};
    for (const [slot_id, slot_state] of Object.entries(raw_slots)) {
      slots[sanitize_slot_id(slot_id)] = sanitize_slot_state(slot_state);
    }
    if (Object.keys(slots).length < 1) {
      slots[DEFAULT_LAYOUT_SLOT_ID] = { positions: {}, visibility: {} };
    }
    const active_slot_id = sanitize_slot_id(app.active_slot_id);
    out.apps[app_id] = {
      active_slot_id: slots[active_slot_id] ? active_slot_id : Object.keys(slots)[0]!,
      slots,
    };
  }
  return out;
}

function sanitize_module_layout_file(raw: unknown): ModuleLayoutFileV2 {
  const version = raw && typeof raw === 'object' && typeof (raw as any).version === 'number'
    ? Math.floor((raw as any).version)
    : 1;
  return version >= 2 ? sanitize_module_layout_file_v2(raw) : sanitize_module_layout_file_v1(raw);
}

function ensure_app_layout(app_id: CameraSettingsAppId): AppLayoutSlotsState {
  const existing = current_module_layouts.apps[app_id];
  if (existing) return existing;
  const next: AppLayoutSlotsState = {
    active_slot_id: DEFAULT_LAYOUT_SLOT_ID,
    slots: {
      [DEFAULT_LAYOUT_SLOT_ID]: { positions: {}, visibility: {} },
    },
  };
  current_module_layouts.apps[app_id] = next;
  return next;
}

function ensure_app_slot(app_id: CameraSettingsAppId, layout_slot_id?: LayoutSlotId | null): ModuleLayoutSlotState {
  const app = ensure_app_layout(app_id);
  const slot_id = sanitize_slot_id(layout_slot_id ?? app.active_slot_id);
  if (!app.slots[slot_id]) app.slots[slot_id] = { positions: {}, visibility: {} };
  if (!app.active_slot_id || !app.slots[app.active_slot_id]) app.active_slot_id = slot_id;
  return app.slots[slot_id]!;
}

export function get_default_module_layout_slot_id(): LayoutSlotId {
  return DEFAULT_LAYOUT_SLOT_ID;
}

export function get_active_module_layout_slot_id(app_id: CameraSettingsAppId): LayoutSlotId {
  return sanitize_slot_id(ensure_app_layout(app_id).active_slot_id);
}

export function get_module_layout_state(app_id: CameraSettingsAppId, layout_slot_id?: LayoutSlotId | null): { positions: ModulePositions; visibility: ModuleVisibility } {
  const slot = ensure_app_slot(app_id, layout_slot_id);
  return {
    positions: Object.fromEntries(Object.entries(slot.positions).map(([key, rect]) => [key, clone_rect_data(rect)])),
    visibility: { ...slot.visibility },
  };
}

function require_profile_scope(profile_scope?: ProfileScope | null): ProfileScope {
  if (!profile_scope) {
    throw new Error('module layout persistence requires a profile scope');
  }
  return profile_scope;
}

async function read_module_layout_file(slot: number, profile_scope?: ProfileScope | null): Promise<ModuleLayoutFileV2> {
  const scoped = require_profile_scope(profile_scope);
  const response = await read_slot_json_file<ModuleLayoutFile>(slot, scoped.files.module_layouts);
  return response.data ? sanitize_module_layout_file(response.data) : { version: 2, apps: {} };
}

export async function load_active_module_layout(slot: number, app_id: CameraSettingsAppId, profile_scope?: ProfileScope | null): Promise<{ positions: ModulePositions; visibility: ModuleVisibility }> {
  current_module_layouts = await read_module_layout_file(slot, profile_scope);
  return get_module_layout_state(app_id);
}

export async function save_active_module_layout(slot: number, app_id: CameraSettingsAppId, next: { positions: ModulePositions; visibility: ModuleVisibility }, profile_scope?: ProfileScope | null): Promise<void> {
  const scoped = require_profile_scope(profile_scope);
  const active_slot_id = get_active_module_layout_slot_id(app_id);
  const slot_state = ensure_app_slot(app_id, active_slot_id);
  slot_state.positions = Object.fromEntries(Object.entries(next.positions).map(([key, rect]) => [key, clone_rect_data(rect)]));
  slot_state.visibility = { ...next.visibility };
  await write_slot_json_file(slot, scoped.files.module_layouts, current_module_layouts);
}

export async function reset_active_module_layout(slot: number, app_id: CameraSettingsAppId, profile_scope?: ProfileScope | null): Promise<void> {
  const scoped = require_profile_scope(profile_scope);
  const active_slot_id = get_active_module_layout_slot_id(app_id);
  ensure_app_layout(app_id).slots[active_slot_id] = { positions: {}, visibility: {} };
  await write_slot_json_file(slot, scoped.files.module_layouts, current_module_layouts);
}

export async function set_active_module_layout_slot_id(slot: number, app_id: CameraSettingsAppId, layout_slot_id: LayoutSlotId, profile_scope?: ProfileScope | null): Promise<void> {
  const scoped = require_profile_scope(profile_scope);
  const app = ensure_app_layout(app_id);
  const slot_id = sanitize_slot_id(layout_slot_id);
  ensure_app_slot(app_id, slot_id);
  app.active_slot_id = slot_id;
  await write_slot_json_file(slot, scoped.files.module_layouts, current_module_layouts);
}

export async function load_module_layouts(slot: number, app_id: CameraSettingsAppId, profile_scope?: ProfileScope | null): Promise<{ positions: ModulePositions; visibility: ModuleVisibility }> {
  return load_active_module_layout(slot, app_id, require_profile_scope(profile_scope));
}

export async function save_module_layouts(slot: number, app_id: CameraSettingsAppId, next: { positions: ModulePositions; visibility: ModuleVisibility }, profile_scope?: ProfileScope | null): Promise<void> {
  await save_active_module_layout(slot, app_id, next, require_profile_scope(profile_scope));
}

export async function reset_module_layouts(slot: number, app_id: CameraSettingsAppId, profile_scope?: ProfileScope | null): Promise<void> {
  await reset_active_module_layout(slot, app_id, require_profile_scope(profile_scope));
}

export function rect_to_layout_data(rect: Rect): ModulePositionData {
  return { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 };
}
