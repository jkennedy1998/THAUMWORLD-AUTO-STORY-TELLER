import type { AutomationPointerDriver, ToolAssistedInputsPointerBase, ToolAssistedInputsScriptAction } from './automation_interfaces.js';

export function create_tool_assisted_inputs_pointer_driver_runtime(): AutomationPointerDriver {
  function get_runtime_api(): any {
    return (window as any).TOOL_ASSISTED_INPUTS_RUNTIME;
  }

  return {
    move(action: ToolAssistedInputsPointerBase): void {
      get_runtime_api()?.inject_pointer_move?.(action);
    },
    down(action: ToolAssistedInputsPointerBase): void {
      get_runtime_api()?.inject_pointer_down?.(action);
    },
    up(action: ToolAssistedInputsPointerBase): void {
      get_runtime_api()?.inject_pointer_up?.(action);
    },
    click(action: ToolAssistedInputsPointerBase, click_count: 1 | 2): void {
      get_runtime_api()?.inject_pointer_click?.(action, click_count);
    },
    context_menu(action: ToolAssistedInputsPointerBase): void {
      get_runtime_api()?.inject_context_menu?.(action);
    },
    drag(action: Extract<ToolAssistedInputsScriptAction, { type: 'pointer_drag' }>): void {
      get_runtime_api()?.inject_pointer_drag?.(action);
    },
    wheel(action: Extract<ToolAssistedInputsScriptAction, { type: 'wheel' }>): void {
      get_runtime_api()?.inject_wheel?.(action);
    },
  };
}
