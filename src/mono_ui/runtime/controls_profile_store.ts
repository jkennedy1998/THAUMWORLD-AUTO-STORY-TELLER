import type { ControlsProfile } from './controls_registry.js';
import { read_slot_relative_json_file, write_slot_relative_json_file } from '../../engine_persistence/slot_json_store.js';
import type { ProfileScope } from '../../user_profiles/profile_scope.js';

function get_legacy_controls_profile_path(): string {
  return 'profiles/controls.json';
}

async function read_controls_profile<T>(data_slot: number, relative_path: string): Promise<T | null> {
  const result = await read_slot_relative_json_file<T>(data_slot, relative_path);
  return result.data ?? null;
}

function is_controls_profile(value: unknown): value is ControlsProfile {
  return Boolean(value) && typeof value === 'object' && (value as ControlsProfile).version === 1 && typeof (value as ControlsProfile).bindings === 'object';
}

export async function load_controls_profile(data_slot: number, profile_scope?: ProfileScope | null): Promise<ControlsProfile | null> {
  const scoped = profile_scope ? await read_controls_profile<ControlsProfile>(data_slot, profile_scope.files.controls) : null;
  if (is_controls_profile(scoped)) return scoped;
  const legacy_profile = profile_scope ? await read_controls_profile<ControlsProfile>(data_slot, profile_scope.legacy_profile_files.controls) : null;
  if (is_controls_profile(legacy_profile)) {
    if (profile_scope) {
      await write_slot_relative_json_file(data_slot, profile_scope.files.controls, legacy_profile).catch(() => null);
    }
    return legacy_profile;
  }
  const legacy = await read_controls_profile<ControlsProfile>(data_slot, get_legacy_controls_profile_path());
  if (!is_controls_profile(legacy)) return null;
  if (profile_scope) {
    await write_slot_relative_json_file(data_slot, profile_scope.files.controls, legacy).catch(() => null);
  }
  return legacy;
}

export async function save_controls_profile(data_slot: number, profile: ControlsProfile, profile_scope?: ProfileScope | null): Promise<void> {
  await write_slot_relative_json_file(data_slot, profile_scope?.files.controls ?? get_legacy_controls_profile_path(), profile);
}
