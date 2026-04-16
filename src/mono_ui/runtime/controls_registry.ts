export type ControlBinding =
  | { kind: 'keyboard'; code: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
  | { kind: 'pointer_button'; button: 'primary' | 'secondary' | 'auxiliary' }
  | { kind: 'pointer_gesture'; gesture: 'drag_primary' | 'drag_secondary' | 'hover' }
  | { kind: 'wheel'; direction: 'up' | 'down' | 'left' | 'right'; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };

export type ControlActionDefinition = {
  id: string;
  label: string;
  category: string;
  system: 'global' | 'game' | 'painter';
  context?: string;
  default_binding: ControlBinding | null;
  allow_multiple?: boolean;
};

export type ControlsProfile = {
  version: 1;
  bindings: Record<string, ControlBinding | null>;
};

export function merge_control_definitions(...groups: ControlActionDefinition[][]): ControlActionDefinition[] {
  const out: ControlActionDefinition[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const def of group) {
      if (seen.has(def.id)) continue;
      seen.add(def.id);
      out.push(def);
    }
  }
  return out;
}
