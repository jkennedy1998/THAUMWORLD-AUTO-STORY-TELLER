import type { EngineLaunchAppId, PersistedLaunchRecordV1 } from './types.js';

function get_launch_record_key(app_id: EngineLaunchAppId, slot: number): string {
  return `thaumworld_launch_state:${app_id}:slot:${slot}`;
}

export function load_launch_record(app_id: EngineLaunchAppId, slot: number): PersistedLaunchRecordV1 | null {
  try {
    const raw = window.localStorage.getItem(get_launch_record_key(app_id, slot));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedLaunchRecordV1;
    if (!parsed || parsed.version !== 1 || parsed.app_id !== app_id || parsed.slot !== slot) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function save_launch_record(record: PersistedLaunchRecordV1): void {
  try {
    window.localStorage.setItem(get_launch_record_key(record.app_id, record.slot), JSON.stringify(record));
  } catch {
    // ignore persistence failure
  }
}

export function clear_launch_record(app_id: EngineLaunchAppId, slot: number): void {
  try {
    window.localStorage.removeItem(get_launch_record_key(app_id, slot));
  } catch {
    // ignore persistence failure
  }
}
