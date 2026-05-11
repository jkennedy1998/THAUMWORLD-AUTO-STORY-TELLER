import { GLOBAL_CONTROLS_PROFILE } from '../mono_ui/runtime/global_controls_profile.js';
import { GAME_CONTROLS_PROFILE } from '../mono_ui/runtime/game_controls_profile.js';
import { PAINTER_CONTROLS_PROFILE } from '../mono_ui/runtime/painter_controls_profile.js';
import { merge_control_definitions } from '../mono_ui/runtime/controls_registry.js';
import { create_controls_runtime } from '../mono_ui/runtime/controls_runtime.js';
import { configure_input_bindings } from '../mono_ui/runtime/input_actions.js';
import { control_binding_matches_keyboard_event } from '../mono_ui/runtime/controls_binding_matcher.js';
import type { ToolType } from '../ascii_painter/types.js';
import type { ProfileScope } from '../user_profiles/profile_scope.js';
import type { PainterToolSequenceBinding } from './painter_tool_shortcut_interpreter.js';

export function create_game_controls_runtime(data_slot: number, opts?: { get_profile_scope?: () => ProfileScope | null }) {
  const runtime = create_controls_runtime({
    data_slot,
    definitions: merge_control_definitions(GLOBAL_CONTROLS_PROFILE, GAME_CONTROLS_PROFILE),
    get_profile_scope: opts?.get_profile_scope,
  });

  function apply_game_bindings(): void {
    const key_code = (action_id: string): string | null => {
      const binding = runtime.get_binding(action_id);
      return binding?.kind === 'keyboard' ? binding.code : null;
    };
    const keyboard: Record<string, 'move_up' | 'move_down' | 'move_left' | 'move_right' | 'jump' | 'cancel'> = {};
    const move_up = key_code('game.move_up');
    const move_down = key_code('game.move_down');
    const move_left = key_code('game.move_left');
    const move_right = key_code('game.move_right');
    const jump = key_code('game.jump');
    const cancel = key_code('global.cancel');
    if (move_up) keyboard[move_up] = 'move_up';
    if (move_down) keyboard[move_down] = 'move_down';
    if (move_left) keyboard[move_left] = 'move_left';
    if (move_right) keyboard[move_right] = 'move_right';
    if (jump) keyboard[jump] = 'jump';
    if (cancel) keyboard[cancel] = 'cancel';
    configure_input_bindings({
      keyboard,
    });
  }

  runtime.subscribe(() => {
    apply_game_bindings();
  });

  return {
    runtime,
    async load(): Promise<void> {
      await runtime.load();
      apply_game_bindings();
    },
  };
}

const PAINTER_TOOL_ACTIONS: Record<ToolType, string> = {
  pencil: 'painter.tool_assign.pencil',
  eraser: 'painter.tool_assign.eraser',
  bucket: 'painter.tool_assign.bucket',
  eyedropper: 'painter.tool_assign.eyedropper',
  line: 'painter.tool_assign.line',
  rect_stroke: 'painter.tool_assign.rect_stroke',
  rect_fill: 'painter.tool_assign.rect_fill',
  text: 'painter.tool_assign.text',
  selectangle: 'painter.tool_assign.selectangle',
  lassoselect: 'painter.tool_assign.lassoselect',
  copy: 'painter.tool_assign.copy',
  paste: 'painter.tool_assign.paste',
  move: 'painter.tool_assign.move',
};

export const PAINTER_TOOL_SEQUENCE_BINDINGS: PainterToolSequenceBinding[] = [
  { sequence: '1', tool: 'pencil' },
  { sequence: '2', tool: 'eraser' },
  { sequence: '3', tool: 'bucket' },
  { sequence: '4', tool: 'eyedropper' },
  { sequence: '5', tool: 'line' },
  { sequence: '6', tool: 'rect_stroke' },
  { sequence: '7', tool: 'rect_fill' },
  { sequence: '8', tool: 'text' },
  { sequence: '9', tool: 'move' },
  { sequence: '10', tool: 'selectangle' },
  { sequence: '11', tool: 'lassoselect' },
  { sequence: '12', tool: 'copy' },
  { sequence: '13', tool: 'paste' },
];

export function create_painter_controls_runtime(data_slot: number, opts?: { get_profile_scope?: () => ProfileScope | null }) {
  const runtime = create_controls_runtime({
    data_slot,
    definitions: merge_control_definitions(GLOBAL_CONTROLS_PROFILE, PAINTER_CONTROLS_PROFILE),
    get_profile_scope: opts?.get_profile_scope,
  });

  return {
    runtime,
    async load(): Promise<void> {
      await runtime.load();
    },
    matches_tool_shortcut(tool: ToolType, e: KeyboardEvent): boolean {
      const action_id = PAINTER_TOOL_ACTIONS[tool];
      return control_binding_matches_keyboard_event(runtime.get_binding(action_id), e);
    },
    get_tool_binding_label(tool: ToolType): string {
      const action_id = PAINTER_TOOL_ACTIONS[tool];
      return runtime.get_binding_label(action_id);
    },
  };
}
