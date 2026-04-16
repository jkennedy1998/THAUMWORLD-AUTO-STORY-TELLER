import type { ControlActionDefinition } from './controls_registry.js';

export const GLOBAL_CONTROLS_PROFILE: ControlActionDefinition[] = [
  { id: 'global.cancel', label: 'Cancel / Back', category: 'Global', system: 'global', default_binding: { kind: 'keyboard', code: 'Escape' } },
  { id: 'global.ui_scale_up', label: 'UI Scale Up', category: 'Global', system: 'global', default_binding: { kind: 'keyboard', code: 'Equal' } },
  { id: 'global.ui_scale_down', label: 'UI Scale Down', category: 'Global', system: 'global', default_binding: { kind: 'keyboard', code: 'Minus' } },
  { id: 'global.open_controls', label: 'Open Controls', category: 'Global', system: 'global', default_binding: { kind: 'keyboard', code: 'Comma', ctrl: true } },
];
