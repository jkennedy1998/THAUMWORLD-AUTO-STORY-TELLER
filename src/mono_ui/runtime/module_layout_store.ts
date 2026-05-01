import type { Rect } from '../types.js';
import { read_slot_json_file, write_slot_json_file } from '../../engine_persistence/slot_json_store.js';
import type { CameraSettingsAppId } from './camera_limits.js';

export type ModulePositionData = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type ModulePositions = Record<string, ModulePositionData>;
export type ModuleVisibility = Record<string, boolean>;

export type ModuleLayoutFile = {
  version: 1;
  apps: Partial<Record<CameraSettingsAppId, {
    positions: ModulePositions;
    visibility: ModuleVisibility;
  }>>;
};

const MODULE_LAYOUT_FILE_NAME = 'module_layouts.json';

let current_module_layouts: ModuleLayoutFile = { version: 1, apps: {} };

function clone_rect_data(rect: ModulePositionData): ModulePositionData {
  return { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 };
}

function sanitize_rect(value: unknown): ModulePositionData | null {
  const candidate = value as Partial<ModulePositionData> | null | undefined;
  if (!candidate) return null;
  const nums = [candidate.x0, candidate.y0, candidate.x1, candidate.y1].map((n) => typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null);
  if (nums.some((n) => n === null)) return null;
  return { x0: nums[0]!, y0: nums[1]!, x1: nums[2]!, y1: nums[3]! };
}

function sanitize_module_layout_file(raw: unknown): ModuleLayoutFile {
  const source = raw && typeof raw === 'object' ? raw as Partial<ModuleLayoutFile> : {};
  const apps = source.apps && typeof source.apps === 'object' ? source.apps as Record<string, unknown> : {};
  const out: ModuleLayoutFile = { version: 1, apps: {} };
  for (const app_id of ['thaum_painter', 'thaum_world'] as CameraSettingsAppId[]) {
    const app = apps[app_id] && typeof apps[app_id] === 'object' ? apps[app_id] as Record<string, unknown> : {};
    const raw_positions = app.positions && typeof app.positions === 'object' ? app.positions as Record<string, unknown> : {};
    const raw_visibility = app.visibility && typeof app.visibility === 'object' ? app.visibility as Record<string, unknown> : {};
    const positions: ModulePositions = {};
    const visibility: ModuleVisibility = {};
    for (const [key, value] of Object.entries(raw_positions)) {
      const rect = sanitize_rect(value);
      if (rect) positions[key] = rect;
    }
    for (const [key, value] of Object.entries(raw_visibility)) {
      if (typeof value === 'boolean') visibility[key] = value;
    }
    out.apps[app_id] = { positions, visibility };
  }
  return out;
}

function ensure_app_layout(app_id: CameraSettingsAppId): { positions: ModulePositions; visibility: ModuleVisibility } {
  const existing = current_module_layouts.apps[app_id];
  if (existing) return existing;
  const next = { positions: {}, visibility: {} };
  current_module_layouts.apps[app_id] = next;
  return next;
}

export function get_module_layout_state(app_id: CameraSettingsAppId): { positions: ModulePositions; visibility: ModuleVisibility } {
  const app = ensure_app_layout(app_id);
  return {
    positions: Object.fromEntries(Object.entries(app.positions).map(([key, rect]) => [key, clone_rect_data(rect)])),
    visibility: { ...app.visibility },
  };
}

export async function load_module_layouts(slot: number, app_id: CameraSettingsAppId): Promise<{ positions: ModulePositions; visibility: ModuleVisibility }> {
  const response = await read_slot_json_file<ModuleLayoutFile>(slot, MODULE_LAYOUT_FILE_NAME);
  current_module_layouts = response.data ? sanitize_module_layout_file(response.data) : { version: 1, apps: {} };
  return get_module_layout_state(app_id);
}

export async function save_module_layouts(slot: number, app_id: CameraSettingsAppId, next: { positions: ModulePositions; visibility: ModuleVisibility }): Promise<void> {
  const app = ensure_app_layout(app_id);
  app.positions = Object.fromEntries(Object.entries(next.positions).map(([key, rect]) => [key, clone_rect_data(rect)]));
  app.visibility = { ...next.visibility };
  await write_slot_json_file(slot, MODULE_LAYOUT_FILE_NAME, current_module_layouts);
}

export async function reset_module_layouts(slot: number, app_id: CameraSettingsAppId): Promise<void> {
  current_module_layouts.apps[app_id] = { positions: {}, visibility: {} };
  await write_slot_json_file(slot, MODULE_LAYOUT_FILE_NAME, current_module_layouts);
}

export function rect_to_layout_data(rect: Rect): ModulePositionData {
  return { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 };
}
