import type { ToolType } from '../ascii_painter/types.js';

const TOOL_SHORTCUT_DBLTAP_MS = 300;

export function create_painter_tool_shortcut_interpreter(options: {
  on_assign_primary: (tool: ToolType) => void;
  on_assign_secondary: (tool: ToolType) => void;
}) {
  let pending_tool: ToolType | null = null;
  let pending_run_at_ms = 0;
  let pending_timer: number | null = null;

  function clear_pending(): void {
    pending_tool = null;
    pending_run_at_ms = 0;
    if (pending_timer !== null) {
      window.clearTimeout(pending_timer);
      pending_timer = null;
    }
  }

  function commit_primary(tool: ToolType): void {
    clear_pending();
    options.on_assign_primary(tool);
  }

  function arm_primary(tool: ToolType): void {
    clear_pending();
    pending_tool = tool;
    pending_run_at_ms = performance.now() + TOOL_SHORTCUT_DBLTAP_MS;
    pending_timer = window.setTimeout(() => {
      if (pending_tool !== tool) return;
      commit_primary(tool);
    }, TOOL_SHORTCUT_DBLTAP_MS);
  }

  return {
    trigger(tool: ToolType): 'pending_primary' | 'assigned_secondary' {
      const now = performance.now();
      if (pending_tool === tool && now <= pending_run_at_ms) {
        clear_pending();
        options.on_assign_secondary(tool);
        return 'assigned_secondary';
      }
      arm_primary(tool);
      return 'pending_primary';
    },
    cancel(): void {
      clear_pending();
    },
    dispose(): void {
      clear_pending();
    },
  };
}
