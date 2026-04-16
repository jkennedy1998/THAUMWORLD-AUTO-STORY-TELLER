import { debug_log } from '../../shared/debug.js';
import type { AutomationTraceSink, ToolAssistedInputsTraceEvent } from './automation_interfaces.js';

export function create_tool_assisted_inputs_trace_sink(): AutomationTraceSink {
  return {
    emit(event: ToolAssistedInputsTraceEvent, payload: Record<string, unknown> = {}): void {
      const message = `${event} ${JSON.stringify(payload)}`;
      try {
        debug_log('SCRIPT_TRACE', message);
      } catch {
        // ignore
      }
      try {
        console.log(`[SCRIPT_TRACE] ${message}`);
      } catch {
        // ignore
      }
    },
  };
}
