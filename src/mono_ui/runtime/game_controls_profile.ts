import type { ControlActionDefinition } from './controls_registry.js';

export const GAME_CONTROLS_PROFILE: ControlActionDefinition[] = [
  { id: 'game.move_up', label: 'Move Up', category: 'Movement', system: 'game', default_binding: { kind: 'keyboard', code: 'KeyW' } },
  { id: 'game.move_down', label: 'Move Down', category: 'Movement', system: 'game', default_binding: { kind: 'keyboard', code: 'KeyS' } },
  { id: 'game.move_left', label: 'Move Left', category: 'Movement', system: 'game', default_binding: { kind: 'keyboard', code: 'KeyA' } },
  { id: 'game.move_right', label: 'Move Right', category: 'Movement', system: 'game', default_binding: { kind: 'keyboard', code: 'KeyD' } },
  { id: 'game.jump', label: 'Jump', category: 'Movement', system: 'game', default_binding: { kind: 'keyboard', code: 'Space' } },
  { id: 'game.view.swing_left', label: 'Swing View Left', category: 'Camera', system: 'game', default_binding: { kind: 'keyboard', code: 'Numpad4' } },
  { id: 'game.view.swing_right', label: 'Swing View Right', category: 'Camera', system: 'game', default_binding: { kind: 'keyboard', code: 'Numpad6' } },
  { id: 'game.view.swing_up', label: 'Swing View Up', category: 'Camera', system: 'game', default_binding: { kind: 'keyboard', code: 'Numpad8' } },
  { id: 'game.view.swing_down', label: 'Swing View Down', category: 'Camera', system: 'game', default_binding: { kind: 'keyboard', code: 'Numpad2' } },
  { id: 'game.view.roll_left', label: 'Roll View Left', category: 'Camera', system: 'game', default_binding: { kind: 'keyboard', code: 'Numpad7' } },
  { id: 'game.view.roll_right', label: 'Roll View Right', category: 'Camera', system: 'game', default_binding: { kind: 'keyboard', code: 'Numpad9' } },
  { id: 'game.view.depth_prev', label: 'Focus Depth Previous', category: 'Camera', system: 'game', default_binding: { kind: 'keyboard', code: 'Numpad1' } },
  { id: 'game.view.depth_next', label: 'Focus Depth Next', category: 'Camera', system: 'game', default_binding: { kind: 'keyboard', code: 'Numpad3' } },
];
