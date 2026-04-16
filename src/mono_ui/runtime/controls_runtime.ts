import type { ControlActionDefinition, ControlBinding, ControlsProfile } from './controls_registry.js';
import { control_binding_conflict_key, format_control_binding } from './controls_binding_matcher.js';
import { load_controls_profile, save_controls_profile } from './controls_profile_store.js';

export function create_controls_runtime(options: { data_slot: number; definitions: ControlActionDefinition[] }) {
  const definitions = [...options.definitions];
  const definitions_by_id = new Map(definitions.map((definition) => [definition.id, definition] as const));
  let bindings = new Map<string, ControlBinding | null>(definitions.map((definition) => [definition.id, definition.default_binding ?? null]));
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) {
      try { listener(); } catch { /* ignore */ }
    }
  }

  function get_profile(): ControlsProfile {
    return {
      version: 1,
      bindings: Object.fromEntries([...bindings.entries()]),
    };
  }

  async function load(): Promise<void> {
    const profile = await load_controls_profile(options.data_slot);
    if (!profile) return;
    for (const [action_id, binding] of Object.entries(profile.bindings)) {
      if (!definitions_by_id.has(action_id)) continue;
      bindings.set(action_id, binding ?? null);
    }
    emit();
  }

  async function persist(): Promise<void> {
    await save_controls_profile(options.data_slot, get_profile());
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function get_binding(action_id: string): ControlBinding | null {
    return bindings.get(action_id) ?? null;
  }

  function set_binding(action_id: string, binding: ControlBinding | null): void {
    if (!definitions_by_id.has(action_id)) return;
    bindings.set(action_id, binding);
    emit();
    void persist();
  }

  function get_definitions(system?: 'global' | 'game' | 'painter'): ControlActionDefinition[] {
    return system ? definitions.filter((definition) => definition.system === system || definition.system === 'global') : definitions;
  }

  function get_conflicts(action_id: string): string[] {
    const binding = get_binding(action_id);
    const key = control_binding_conflict_key(binding);
    if (!key) return [];
    return definitions
      .filter((definition) => definition.id !== action_id && !definition.allow_multiple)
      .filter((definition) => control_binding_conflict_key(get_binding(definition.id)) === key)
      .map((definition) => definition.id);
  }

  function get_binding_label(action_id: string): string {
    return format_control_binding(get_binding(action_id));
  }

  return {
    load,
    subscribe,
    get_binding,
    set_binding,
    get_binding_label,
    get_conflicts,
    get_definitions,
  };
}
