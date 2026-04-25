import type { DragPayload } from './interaction_payload_runtime.js';
import type { PayloadCompatibilityAdapter, PayloadCompatibilityResult } from './interaction_capabilities_runtime.js';
import type { ResolvedTarget } from './interaction_target_runtime.js';

export async function evaluate_payload_compatibility(args: {
  adapter: PayloadCompatibilityAdapter | null | undefined;
  payload: DragPayload | null | undefined;
  target: ResolvedTarget | null | undefined;
}): Promise<PayloadCompatibilityResult> {
  if (!args.adapter || !args.payload || !args.target) {
    return {
      considered: false,
      accepted: false,
      reason: 'missing_compatibility_inputs',
    };
  }
  return await args.adapter.evaluate_payload_for_target(args.payload, args.target);
}

export function make_default_unhandled_compatibility(reason: string = 'unhandled_target'): PayloadCompatibilityResult {
  return {
    considered: false,
    accepted: false,
    reason,
  };
}
