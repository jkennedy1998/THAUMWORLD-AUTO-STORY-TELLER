import { handle_keydown, handle_keyup, reset_all } from './input_actions.js';
import type { AutomationInputDriver } from './automation_interfaces.js';

function make_keyboard_event(type: 'keydown' | 'keyup', code: string, key: string): KeyboardEvent {
  return new KeyboardEvent(type, {
    code,
    key,
    bubbles: false,
    cancelable: true,
  });
}

export function create_tool_assisted_inputs_keyboard_driver_shared_runtime(): AutomationInputDriver {
  return {
    backend_kind: 'shared_runtime_fallback',
    send_keydown(action): void {
      handle_keydown(make_keyboard_event('keydown', action.code, action.key ?? ''), {
        typing: false,
        window_focused: document.hasFocus(),
        active_element_id: (document.activeElement as HTMLElement | null)?.id ?? null,
        focused_owner_id: null,
      });
    },
    send_keyup(action): void {
      handle_keyup(make_keyboard_event('keyup', action.code, action.key ?? ''), {
        typing: false,
        window_focused: document.hasFocus(),
        active_element_id: (document.activeElement as HTMLElement | null)?.id ?? null,
        focused_owner_id: null,
      });
    },
    reset(): void {
      reset_all();
    },
  };
}
