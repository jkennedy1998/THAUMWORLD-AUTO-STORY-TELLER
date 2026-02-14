import { debug_pipeline } from "./debug.js";

/**
 * Structured debug event helper.
 *
 * Prefer this over `console.log` for runtime traces so logs stay consistent
 * and machine/LLM readable.
 */
export function debug_event(
  component: string,
  event: string,
  fields?: Record<string, unknown>
): void {
  debug_pipeline(component, event, fields);
}
