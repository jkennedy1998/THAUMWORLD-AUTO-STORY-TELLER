import type { SlotType } from '../../equipment/body_slot_resolver.js';
import type { ItemDefinition } from '../../item_storage/store.js';
import type { PayloadCompatibilityAdapter, PayloadCompatibilityResult } from './interaction_capabilities_runtime.js';
import { make_default_unhandled_compatibility } from './interaction_compatibility_runtime.js';
import type { DragPayload, ResolvedTarget } from './interaction_runtime_types.js';

export type CompatibleSlot = {
  slot_name: string;
  slot_type: SlotType;
  garb_index?: number;
};

export function create_item_payload_compatibility_adapter(args: {
  get_compatible_slots_for_item: (payload: Extract<DragPayload, { payload_kind: 'item' }>, target: ResolvedTarget) => Promise<CompatibleSlot[]>;
}): PayloadCompatibilityAdapter {
  return {
    evaluate_payload_for_target: async (payload: DragPayload, target: ResolvedTarget): Promise<PayloadCompatibilityResult> => {
      if (payload.payload_kind !== 'item') {
        return { considered: false, accepted: false, reason: 'unsupported_payload_kind' };
      }

      if (target.target_type === 'equipment_slot') {
        const compatible = await args.get_compatible_slots_for_item(payload, target);
        const accepted = compatible.some((slot) => (
          slot.slot_name === target.slot_name
          && slot.slot_type === target.slot_type
          && (slot.garb_index ?? null) === (target.garb_index ?? null)
        ));
        return {
          considered: true,
          accepted,
          highlight_kind: accepted ? 'legal_target' : 'illegal_target',
          reason: accepted ? null : 'slot_incompatible',
        };
      }

      if (target.target_type === 'inventory_slot') {
        return {
          considered: true,
          accepted: true,
          highlight_kind: 'inventory_target',
          reason: null,
        };
      }

      return make_default_unhandled_compatibility('unsupported_target_type');
    },
  };
}
