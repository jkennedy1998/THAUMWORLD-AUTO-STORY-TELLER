import type { ControlsProfile } from './controls_registry.js';

function get_controls_profile_path(data_slot_dir: string): string {
  return `${data_slot_dir.replace(/\\/g, '/')}/profiles/controls.json`;
}

export async function load_controls_profile(data_slot: number): Promise<ControlsProfile | null> {
  const data_slot_dir = await (window as Window).electronAPI?.getDataSlotDir?.(data_slot);
  if (!data_slot_dir) return null;
  const result = await (window as Window).electronAPI?.readFile?.(get_controls_profile_path(data_slot_dir));
  if (!result?.success || typeof result.content !== 'string') return null;
  try {
    const parsed = JSON.parse(result.content) as ControlsProfile;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || typeof parsed.bindings !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function save_controls_profile(data_slot: number, profile: ControlsProfile): Promise<void> {
  const data_slot_dir = await (window as Window).electronAPI?.getDataSlotDir?.(data_slot);
  if (!data_slot_dir) return;
  await (window as Window).electronAPI?.writeFileAtomic?.(get_controls_profile_path(data_slot_dir), JSON.stringify(profile, null, 2));
}
