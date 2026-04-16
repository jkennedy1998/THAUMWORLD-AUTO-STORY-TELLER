import type { ControlActionDefinition } from './controls_registry.js';

export const GAME_CONTROLS_PROFILE: ControlActionDefinition[] = [
  { id: 'game.move_up', label: 'Move Up', category: 'Movement', system: 'game', default_binding: { kind: 'keyboard', code: 'KeyW' } },
  { id: 'game.move_down', label: 'Move Down', category: 'Movement', system: 'game', default_binding: { kind: 'keyboard', code: 'KeyS' } },
  { id: 'game.move_left', label: 'Move Left', category: 'Movement', system: 'game', default_binding: { kind: 'keyboard', code: 'KeyA' } },
  { id: 'game.move_right', label: 'Move Right', category: 'Movement', system: 'game', default_binding: { kind: 'keyboard', code: 'KeyD' } },
  { id: 'game.jump', label: 'Jump', category: 'Movement', system: 'game', default_binding: { kind: 'keyboard', code: 'Space' } },
];
