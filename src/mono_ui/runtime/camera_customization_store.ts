import type { CameraConfig } from '../../ascii_painter/voxel_space.js';
import { read_slot_json_file, write_slot_json_file } from '../../engine_persistence/slot_json_store.js';
import { get_camera_limit_profile, sanitize_camera_config_for_app, type CameraSettingsAppId } from './camera_limits.js';

export type CameraSettingsFile = {
  version: 1;
  apps: Partial<Record<CameraSettingsAppId, Partial<CameraConfig>>>;
};

const CAMERA_SETTINGS_FILE_NAME = 'camera_settings.json';

let current_camera_settings: CameraSettingsFile = { version: 1, apps: {} };

function clone_partial_camera_config(value: Partial<CameraConfig> | null | undefined): Partial<CameraConfig> {
  return value ? JSON.parse(JSON.stringify(value)) as Partial<CameraConfig> : {};
}

function sanitize_camera_settings_file(raw: unknown): CameraSettingsFile {
  const source = raw && typeof raw === 'object' ? raw as Partial<CameraSettingsFile> : {};
  const apps = source.apps && typeof source.apps === 'object' ? source.apps : {};
  return {
    version: 1,
    apps: {
      thaum_painter: sanitize_camera_config_for_app('thaum_painter', (apps as Record<string, unknown>).thaum_painter as Partial<CameraConfig> | undefined),
      thaum_world: sanitize_camera_config_for_app('thaum_world', (apps as Record<string, unknown>).thaum_world as Partial<CameraConfig> | undefined),
    },
  };
}

export function get_camera_settings_for_app(app_id: CameraSettingsAppId): Partial<CameraConfig> {
  return clone_partial_camera_config(current_camera_settings.apps[app_id]);
}

export async function load_camera_settings(slot: number, app_id: CameraSettingsAppId): Promise<Partial<CameraConfig>> {
  const response = await read_slot_json_file<CameraSettingsFile>(slot, CAMERA_SETTINGS_FILE_NAME);
  current_camera_settings = response.data ? sanitize_camera_settings_file(response.data) : { version: 1, apps: {} };
  return get_camera_settings_for_app(app_id);
}

export async function save_camera_settings(slot: number, app_id: CameraSettingsAppId, partial: Partial<CameraConfig>): Promise<Partial<CameraConfig>> {
  const next = sanitize_camera_config_for_app(app_id, {
    ...current_camera_settings.apps[app_id],
    ...partial,
  });
  current_camera_settings = {
    version: 1,
    apps: {
      ...current_camera_settings.apps,
      [app_id]: next,
    },
  };
  await write_slot_json_file(slot, CAMERA_SETTINGS_FILE_NAME, current_camera_settings);
  return clone_partial_camera_config(next);
}

export async function reset_camera_settings(slot: number, app_id: CameraSettingsAppId): Promise<void> {
  current_camera_settings = {
    version: 1,
    apps: {
      ...current_camera_settings.apps,
      [app_id]: {},
    },
  };
  await write_slot_json_file(slot, CAMERA_SETTINGS_FILE_NAME, current_camera_settings);
}

export function get_camera_slider_specs_for_app(app_id: CameraSettingsAppId): ReturnType<typeof get_camera_limit_profile> {
  return get_camera_limit_profile(app_id);
}
