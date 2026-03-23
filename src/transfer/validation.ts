import type { ItemInstance } from "../item_instances/store.js";
import type { ItemDefinition } from "../item_storage/store.js";
import { check_tag_compatibility } from "../equipment/tag_validation.js";
import { debug_log, debug_error } from "../shared/debug.js";
import { can_stack_items_with_spoil_policy } from "../item_storage/stacking.js";

/**
 * Transfer operation types
 */
export type TransferOperation = 
    | { type: 'move'; source_container: string; dest_container: string; item: ItemInstance }
    | { type: 'stack'; source_container: string; dest_container: string; source_item: ItemInstance; target_item: ItemInstance; merged_qty: number }
    | { type: 'swap'; container_a: string; container_b: string; item_a: ItemInstance; item_b: ItemInstance }
    | { type: 'reorder'; container: string; item: ItemInstance; from_slot: number; to_slot: number }
    | { type: 'reject'; reason: string };

/**
 * Result of transfer validation
 */
export interface TransferValidationResult {
    operation: TransferOperation;
    ok: boolean;
    error?: string;
}

/**
 * Check if two items can be stacked together
 * Requirements:
 * - Same def_id
 * - Both stackable
 * - Combined qty <= max_stack_size
 * - Tags match
 */
export function can_stack(
    item_a: ItemInstance,
    def_a: ItemDefinition,
    item_b: ItemInstance,
    def_b: ItemDefinition
): boolean {
    if (!can_stack_items_with_spoil_policy(item_a, def_a, item_b, def_b)) {
        debug_log("transfer", `Cannot stack: policy rejected merge for ${def_a.id} and ${def_b.id}`);
        return false;
    }
    
    debug_log("transfer", `Can stack: ${def_a.id} (${item_a.qty || 1} + ${item_b.qty || 1} <= ${def_a.max_stack_size || 1})`);
    return true;
}

/**
 * Check if two items can be swapped between slots (tag-based)
 */
export function can_swap_items(
    item_a: ItemInstance,
    def_a: ItemDefinition,
    slot_a: string,
    item_b: ItemInstance,
    def_b: ItemDefinition,
    slot_b: string
): boolean {
    function fits(def: ItemDefinition, slot: string): boolean {
        return (
            check_tag_compatibility(def, slot, 'armor').compatible ||
            check_tag_compatibility(def, slot, 'garb').compatible ||
            check_tag_compatibility(def, slot, 'tool').compatible
        );
    }

    const a_fits_b = fits(def_a, slot_b);
    const b_fits_a = fits(def_b, slot_a);
    
    const can_swap = a_fits_b && b_fits_a;
    
    if (can_swap) {
        debug_log("transfer", `Can swap: ${def_a.id} (${slot_a}) <-> ${def_b.id} (${slot_b})`);
    } else {
        debug_log("transfer", `Cannot swap: ${def_a.id} fits ${slot_b}? ${a_fits_b}, ${def_b.id} fits ${slot_a}? ${b_fits_a}`);
    }
    
    return can_swap;
}

/**
 * Validate a transfer operation and determine the operation type
 * 
 * @param item_instance_id The item being transferred
 * @param item_def The item's definition
 * @param from_container_id Source container
 * @param to_container_id Destination container  
 * @param target_item The item at destination (if any)
 * @param target_def Definition of target item (if any)
 * @returns TransferValidationResult with operation type and validation status
 */
export function validate_transfer(
    item_instance_id: string,
    item: ItemInstance,
    item_def: ItemDefinition,
    from_container_id: string,
    to_container_id: string,
    target_item?: ItemInstance,
    target_def?: ItemDefinition
): TransferValidationResult {
    debug_log("transfer", `Validating transfer: ${item_instance_id} from ${from_container_id} to ${to_container_id}`);
    
    // Same container - would need reorder (not yet implemented)
    if (from_container_id === to_container_id) {
        return {
            operation: { type: 'reject', reason: 'Same container transfer not supported. Use reorder instead.' },
            ok: false,
            error: "Cannot transfer item within the same container. Use reorder operation instead."
        };
    }
    
    // Empty destination - simple move
    if (!target_item || !target_def) {
        return {
            operation: { 
                type: 'move', 
                source_container: from_container_id, 
                dest_container: to_container_id, 
                item 
            },
            ok: true
        };
    }
    
    // Destination occupied - check for stacking
    if (can_stack(item, item_def, target_item, target_def)) {
        const merged_qty = (item.qty || 1) + (target_item.qty || 1);
        return {
            operation: {
                type: 'stack',
                source_container: from_container_id,
                dest_container: to_container_id,
                source_item: item,
                target_item: target_item,
                merged_qty: merged_qty
            },
            ok: true
        };
    }
    
    // Can't stack - check for swap (only for body slots)
    // Extract slot names from container IDs
    const slot_a = from_container_id.split('.').pop() || '';
    const slot_b = to_container_id.split('.').pop() || '';
    
    // Only check swap if both are body slots (container.actor.* format)
    if (from_container_id.startsWith('container.') && to_container_id.startsWith('container.')) {
        if (can_swap_items(item, item_def, slot_a, target_item, target_def, slot_b)) {
            return {
                operation: {
                    type: 'swap',
                    container_a: from_container_id,
                    container_b: to_container_id,
                    item_a: item,
                    item_b: target_item
                },
                ok: true
            };
        }
    }
    
    // Can't stack or swap - reject
    return {
        operation: { 
            type: 'reject', 
            reason: `Cannot stack ${item_def.id} with ${target_def.id} and swap not valid` 
        },
        ok: false,
        error: `Cannot place ${item_def.name || item_def.id} here. Target slot occupied by incompatible item.`
    };
}

/**
 * Calculate the resulting quantity when stacking two items
 * @returns The merged quantity or null if cannot stack
 */
export function calculate_stack_qty(
    source_item: ItemInstance,
    target_item: ItemInstance,
    item_def: ItemDefinition
): number | null {
    if (!item_def.stackable) return null;
    
    const max_stack = item_def.max_stack_size || 1;
    const source_qty = source_item.qty || 1;
    const target_qty = target_item.qty || 1;
    const combined = source_qty + target_qty;
    
    if (combined > max_stack) return null;
    
    return combined;
}
