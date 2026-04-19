import type { AutomationInputDriver } from './automation_interfaces.js';

function get_runtime_api(): any {
  return (window as any).TOOL_ASSISTED_INPUTS_RUNTIME ?? null;
}

export function create_tool_assisted_inputs_keyboard_driver_shared_runtime(): AutomationInputDriver {
  return {
    backend_kind: 'shared_runtime_fallback',
    send_keydown(action): void {
      get_runtime_api()?.inject_ui_key?.('keydown', action);
    },
    send_keyup(action): void {
      get_runtime_api()?.inject_ui_key?.('keyup', action);
    },
    send_text(action): void {
      get_runtime_api()?.inject_text_input?.(action);
    },
    reset(): void {
      get_runtime_api()?.reset_keyboard?.();
    },
  };
}
