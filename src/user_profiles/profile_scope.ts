import type { CameraSettingsAppId } from '../mono_ui/runtime/camera_limits.js';

export const DEFAULT_NAMED_PROFILE_ID = 'default';

export type ProfileScope = {
  slot: number;
  app_id: CameraSettingsAppId;
  profile_id: string;
  base_dir: string;
  files: {
    controls: string;
    ui_customization: string;
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
  return {
    slot,
    app_id,
    profile_id: resolved_profile_id,
    base_dir,
    files: {
      controls: `${base_dir}/controls.json`,
      ui_customization: `${base_dir}/ui_customization.json`,
      module_layouts: `${base_dir}/module_layouts.json`,
      camera_settings: `${base_dir}/camera_settings.json`,
    },
  };
}
