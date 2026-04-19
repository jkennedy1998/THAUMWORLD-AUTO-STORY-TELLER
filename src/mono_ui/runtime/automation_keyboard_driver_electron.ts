import type { AutomationInputDriver } from './automation_interfaces.js';

export function create_tool_assisted_inputs_keyboard_driver_electron(): AutomationInputDriver {
  return {
    backend_kind: 'electron_authoritative',
    send_keydown(action): void {
      const runtime_api = (window as any).TOOL_ASSISTED_INPUTS_RUNTIME;
      if (typeof runtime_api?.inject_ui_key === 'function') {
        runtime_api.inject_ui_key('keydown', action);
        return;
      }
      if (typeof runtime_api?.inject_gameplay_key === 'function') {
        runtime_api.inject_gameplay_key('keydown', {
          code: action.code,
          key: action.key ?? '',
          repeat: false,
        });
        return;
      }
      (window as Window).electronAPI?.toolAssistedInputsSendKeyboardEvent?.({
        type: 'keydown',
        code: action.code,
        key: action.key ?? '',
      });
    },
    send_keyup(action): void {
      const runtime_api = (window as any).TOOL_ASSISTED_INPUTS_RUNTIME;
      if (typeof runtime_api?.inject_ui_key === 'function') {
        runtime_api.inject_ui_key('keyup', action);
        return;
      }
      if (typeof runtime_api?.inject_gameplay_key === 'function') {
        runtime_api.inject_gameplay_key('keyup', {
          code: action.code,
          key: action.key ?? '',
          repeat: false,
        });
        return;
      }
      (window as Window).electronAPI?.toolAssistedInputsSendKeyboardEvent?.({
        type: 'keyup',
        code: action.code,
        key: action.key ?? '',
      });
    },
    send_text(action): void {
      const runtime_api = (window as any).TOOL_ASSISTED_INPUTS_RUNTIME;
      if (typeof runtime_api?.inject_text_input === 'function') {
        runtime_api.inject_text_input(action);
      }
    },
    reset(): void {
      (window as Window).electronAPI?.toolAssistedInputsResetKeyboard?.();
    },
  };
}
