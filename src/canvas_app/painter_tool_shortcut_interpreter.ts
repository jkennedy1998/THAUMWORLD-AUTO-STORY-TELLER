import type { ToolType } from '../ascii_painter/types.js';

export const TOOL_SHORTCUT_DBLTAP_MS = 300;

export type PainterToolSequenceBinding = {
  sequence: string;
  tool: ToolType;
};

export function create_painter_tool_shortcut_interpreter(options: {
  on_assign_primary: (tool: ToolType) => void;
  on_assign_secondary: (tool: ToolType) => void;
  tool_sequences?: PainterToolSequenceBinding[];
}) {
  let pending_tool: ToolType | null = null;
  let pending_tool_run_at_ms = 0;
  let pending_tool_timer: number | null = null;
  let pending_sequence = '';
  let pending_sequence_timer: number | null = null;

  const sequence_bindings = options.tool_sequences ?? [];

  function clear_pending_tool(): void {
    pending_tool = null;
    pending_tool_run_at_ms = 0;
    if (pending_tool_timer !== null) {
      window.clearTimeout(pending_tool_timer);
      pending_tool_timer = null;
    }
  }

  function clear_pending_sequence(): void {
    pending_sequence = '';
    if (pending_sequence_timer !== null) {
      window.clearTimeout(pending_sequence_timer);
      pending_sequence_timer = null;
    }
  }

  function clear_all_pending(): void {
    clear_pending_tool();
    clear_pending_sequence();
  }

  function commit_primary(tool: ToolType): void {
    clear_pending_tool();
    options.on_assign_primary(tool);
  }

  function arm_primary(tool: ToolType): void {
    clear_pending_tool();
    pending_tool = tool;
    pending_tool_run_at_ms = performance.now() + TOOL_SHORTCUT_DBLTAP_MS;
    pending_tool_timer = window.setTimeout(() => {
      if (pending_tool !== tool) return;
      commit_primary(tool);
    }, TOOL_SHORTCUT_DBLTAP_MS);
  }

  function get_tool_for_sequence(sequence: string): ToolType | null {
    return sequence_bindings.find((binding) => binding.sequence === sequence)?.tool ?? null;
  }

  function has_sequence_prefix(sequence: string): boolean {
    return sequence_bindings.some((binding) => binding.sequence.startsWith(sequence));
  }

  function has_sequence_extension(sequence: string): boolean {
    return sequence_bindings.some((binding) => binding.sequence !== sequence && binding.sequence.startsWith(sequence));
  }

  function trigger_resolved_tool(tool: ToolType, mode: 'delayed_primary' | 'commit_primary_now' = 'delayed_primary'): 'pending_primary' | 'assigned_secondary' | 'assigned_primary' {
    const now = performance.now();
    if (pending_tool === tool && now <= pending_tool_run_at_ms) {
      clear_pending_tool();
      options.on_assign_secondary(tool);
      return 'assigned_secondary';
    }
    if (mode === 'commit_primary_now') {
      commit_primary(tool);
      return 'assigned_primary';
    }
    arm_primary(tool);
    return 'pending_primary';
  }

  function commit_pending_sequence(mode: 'delayed_primary' | 'commit_primary_now'): 'pending_primary' | 'assigned_secondary' | 'assigned_primary' | 'ignored' {
    if (!pending_sequence) return 'ignored';
    const sequence = pending_sequence;
    clear_pending_sequence();
    const tool = get_tool_for_sequence(sequence);
    if (!tool) return 'ignored';
    return trigger_resolved_tool(tool, mode);
  }

  function arm_sequence_timer(): void {
    if (pending_sequence_timer !== null) {
      window.clearTimeout(pending_sequence_timer);
      pending_sequence_timer = null;
    }
    const sequence_at_arm = pending_sequence;
    pending_sequence_timer = window.setTimeout(() => {
      if (pending_sequence !== sequence_at_arm) return;
      commit_pending_sequence('commit_primary_now');
    }, TOOL_SHORTCUT_DBLTAP_MS);
  }

  return {
    trigger(tool: ToolType): 'pending_primary' | 'assigned_secondary' | 'assigned_primary' {
      return trigger_resolved_tool(tool);
    },
    trigger_digit(digit: string): 'pending_sequence' | 'pending_primary' | 'assigned_secondary' | 'assigned_primary' | 'ignored' {
      const normalized = String(digit ?? '').trim();
      if (!/^\d$/.test(normalized)) return 'ignored';
      const combined = `${pending_sequence}${normalized}`;
      if (has_sequence_prefix(combined)) {
        pending_sequence = combined;
        arm_sequence_timer();
        const exact_tool = get_tool_for_sequence(combined);
        if (exact_tool && !has_sequence_extension(combined)) {
          clear_pending_sequence();
          return trigger_resolved_tool(exact_tool);
        }
        return 'pending_sequence';
      }
      const committed_previous = commit_pending_sequence('commit_primary_now');
      if (has_sequence_prefix(normalized)) {
        pending_sequence = normalized;
        arm_sequence_timer();
        const exact_tool = get_tool_for_sequence(normalized);
        if (exact_tool && !has_sequence_extension(normalized)) {
          clear_pending_sequence();
          return trigger_resolved_tool(exact_tool);
        }
        return committed_previous === 'ignored' ? 'pending_sequence' : committed_previous;
      }
      return committed_previous;
    },
    flush_pending_primary(): boolean {
      if (pending_sequence) {
        return commit_pending_sequence('commit_primary_now') !== 'ignored';
      }
      if (!pending_tool) return false;
      const tool = pending_tool;
      commit_primary(tool);
      return true;
    },
    has_pending_input(): boolean {
      return Boolean(pending_sequence || pending_tool);
    },
    cancel(): void {
      clear_all_pending();
    },
    dispose(): void {
      clear_all_pending();
    },
  };
}
