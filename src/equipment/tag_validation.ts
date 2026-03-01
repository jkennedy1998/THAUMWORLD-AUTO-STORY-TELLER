/**
 * Tag-based equipment validation
 * 
 * Validates equipment compatibility using ARMOR/GARB/TOOL tags
 * Replaces/extends the valid_body_slots array approach
 */

import type { ItemDefinition } from "../item_storage/store.js";
import type { TagInstance } from "../tag_system/registry.js";

/**
 * Result of tag compatibility check
 */
export interface TagCompatibilityResult {
    compatible: boolean;
    slot_type: "armor" | "garb" | "tool" | null;
    reason?: string;
}

/**
 * Check if an item can equip to a specific slot type
 * 
 * @param item_def - The item definition to check
 * @param target_slot_name - The body slot name (e.g., "hand_left", "torso")
 * @param target_slot_type - The slot type ("armor", "garb", "tool")
 * @returns Compatibility result with slot type and reason if rejected
 */
export function check_tag_compatibility(
    item_def: ItemDefinition,
    target_slot_name: string,
    target_slot_type: string
): TagCompatibilityResult {
    // Get item's equipment tags
    const has_armor = item_def.tags?.some((t: TagInstance) => t.name === "ARMOR");
    const has_garb = item_def.tags?.some((t: TagInstance) => t.name === "GARB");
    const has_tool = item_def.tags?.some((t: TagInstance) => t.name === "TOOL");
    
    // TOOL slot: ANY item can be held in hand tool slots
    // This allows holding non-tool items (weapons, food, misc items)
    if (target_slot_type === "tool") {
        return { compatible: true, slot_type: "tool" };
    }
    
    // ARMOR and GARB check body_slot metadata
    const armor_tag = item_def.tags?.find((t: TagInstance) => t.name === "ARMOR");
    const garb_tag = item_def.tags?.find((t: TagInstance) => t.name === "GARB");
    
    // Check ARMOR compatibility
    if (target_slot_type === "armor" && armor_tag) {
        // ARMOR must match body slot (e.g., helmet → head, chest plate → torso)
        // Check for both generic categories AND specific slot names
        const armor_slot = armor_tag.meta?.find((m: string) => 
            ["head", "torso", "hand", "leg"].includes(m) ||
            ["head", "torso", "hand_left", "hand_right", "leg_left", "leg_right"].includes(m)
        );
        
        if (armor_slot) {
            // Check if armor slot matches target
            // Supports: generic "leg" matching "leg_left", OR specific "leg_left" matching "leg_left"
            if (target_slot_name.includes(armor_slot) || armor_slot.includes(target_slot_name)) {
                return { compatible: true, slot_type: "armor" };
            }
        }
        
        return {
            compatible: false,
            slot_type: null,
            reason: `ARMOR tagged for ${armor_slot}, not compatible with ${target_slot_name}`
        };
    }
    
    // Check GARB compatibility
    if (target_slot_type === "garb" && garb_tag) {
        // GARB must match body slot
        // Check for both generic categories AND specific slot names
        const garb_slot = garb_tag.meta?.find((m: string) =>
            ["head", "torso", "hand", "leg"].includes(m) ||
            ["head", "torso", "hand_left", "hand_right", "leg_left", "leg_right"].includes(m)
        );
        
        if (garb_slot) {
            // Check if garb slot matches target
            // Supports: generic "leg" matching "leg_left", OR specific "leg_left" matching "leg_left"
            if (target_slot_name.includes(garb_slot) || garb_slot.includes(target_slot_name)) {
                return { compatible: true, slot_type: "garb" };
            }
        }
        
        return {
            compatible: false,
            slot_type: null,
            reason: `GARB tagged for ${garb_slot}, not compatible with ${target_slot_name}`
        };
    }
    
    return {
        compatible: false,
        slot_type: null,
        reason: `Item not compatible with ${target_slot_type} slot on ${target_slot_name}`
    };
}

/**
 * Get the primary slot type for an item
 * Used for pickup routing when no explicit destination specified
 * 
 * Priority: TOOL > ARMOR > GARB > TOOL (fallback for non-equipped items)
 * 
 * @param item_def - The item definition
 * @returns The slot type ("armor", "garb", "tool") or null if no equipment tags
 */
export function get_primary_slot_type(item_def: ItemDefinition): "armor" | "garb" | "tool" | null {
    if (item_def.tags?.some((t: TagInstance) => t.name === "TOOL")) return "tool";
    if (item_def.tags?.some((t: TagInstance) => t.name === "ARMOR")) return "armor";
    if (item_def.tags?.some((t: TagInstance) => t.name === "GARB")) return "garb";
    // Items without equipment tags can still be held in tool slots
    return "tool";
}

/**
 * Check all compatible slot types for an item
 * 
 * @param item_def - The item definition
 * @returns Array of compatible slot types
 */
export function get_compatible_slot_types(item_def: ItemDefinition): string[] {
    const compatible: string[] = [];
    
    if (item_def.tags?.some((t: TagInstance) => t.name === "ARMOR")) compatible.push("armor");
    if (item_def.tags?.some((t: TagInstance) => t.name === "GARB")) compatible.push("garb");
    // All items can be held in tool slots (hand slots)
    compatible.push("tool");
    
    return compatible;
}

/**
 * Check backward compatibility with valid_body_slots
 * 
 * This allows items without equipment tags to still work
 * during the transition period.
 * 
 * @param item_def - The item definition
 * @param slot_name - The slot name to check
 * @returns True if item is compatible via legacy system
 */
export function check_legacy_compatibility(
    item_def: ItemDefinition,
    slot_name: string
): boolean {
    // Check if item has any equipment tags
    const has_equip_tags = item_def.tags?.some((t: TagInstance) =>
        ["ARMOR", "GARB", "TOOL"].includes(t.name)
    );
    
    // If no equipment tags, fall back to valid_body_slots
    if (!has_equip_tags && item_def.valid_body_slots) {
        return item_def.valid_body_slots.includes(slot_name);
    }
    
    return false;
}

/**
 * Check if an item has any equipment-related tags
 * 
 * @param item_def - The item definition
 * @returns True if item has ARMOR, GARB, or TOOL tags
 */
export function has_equipment_tags(item_def: ItemDefinition): boolean {
    return item_def.tags?.some((t: TagInstance) =>
        ["ARMOR", "GARB", "TOOL"].includes(t.name)
    ) ?? false;
}

/**
 * Get equipment tag details for an item
 * 
 * @param item_def - The item definition
 * @returns Object with armor, garb, tool tag details or null
 */
export function get_equipment_tags(item_def: ItemDefinition): {
    armor: TagInstance | null;
    garb: TagInstance | null;
    tool: TagInstance | null;
} {
    return {
        armor: item_def.tags?.find((t: TagInstance) => t.name === "ARMOR") ?? null,
        garb: item_def.tags?.find((t: TagInstance) => t.name === "GARB") ?? null,
        tool: item_def.tags?.find((t: TagInstance) => t.name === "TOOL") ?? null
    };
}
