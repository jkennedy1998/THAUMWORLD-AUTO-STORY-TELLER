import type { CameraSettingsAppId } from '../mono_ui/runtime/camera_limits.js';

export const DEFAULT_NAMED_PROFILE_ID = 'default';

export type ProfileScope = {
  slot: number;
  app_id: CameraSettingsAppId;
  profile_id: string;
  base_dir: string;
  app_base_dir: string;
  legacy_profile_files: {
    controls: string;
    ui_customization: string;
    indexed_palette: string;
    module_layouts: string;
    camera_settings: string;
  };
  files: {
    controls: string;
    ui_customization: string;
    indexed_palette: string;
    module_layouts: string;
    camera_settings: string;
  };
};

function sanitize_profile_id(profile_id: string | null | undefined): string {
  const normalized = String(profile_id ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || DEFAULT_NAMED_PROFILE_ID;
}

export function create_profile_scope(slot: number, app_id: CameraSettingsAppId, profile_id?: string | null): ProfileScope {
  const resolved_profile_id = sanitize_profile_id(profile_id);
  const base_dir = `profiles/${resolved_profile_id}`;
  const app_base_dir = `${base_dir}/apps/${app_id}`;
  return {
    slot,
    app_id,
    profile_id: resolved_profile_id,
    base_dir,
    app_base_dir,
    legacy_profile_files: {
      controls: `${base_dir}/controls.json`,
      ui_customization: `${base_dir}/ui_customization.json`,
      indexed_palette: `${base_dir}/indexed_palette.json`,
      module_layouts: `${base_dir}/module_layouts.json`,
      camera_settings: `${base_dir}/camera_settings.json`,
    },
    files: {
      controls: `${app_base_dir}/controls.json`,
      ui_customization: `${app_base_dir}/ui_customization.json`,
      indexed_palette: `${app_base_dir}/indexed_palette.json`,
      module_layouts: `${app_base_dir}/module_layouts.json`,
      camera_settings: `${app_base_dir}/camera_settings.json`,
    },
  };
}
