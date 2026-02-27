// Body slot management for actors and NPCs
// Handles equipping/unequipping items to body slots

import type { Container } from "./container.js";

/**
 * Standard body slot names (lowercase_snake_case)
 * This is the canonical naming convention used throughout the system
 */
export const STANDARD_BODY_SLOTS = {
    head: 'head',
    torso: 'torso',
    hand_left: 'hand_left',
    hand_right: 'hand_right',
    leg_left: 'leg_left',
    leg_right: 'leg_right',
} as const;

/**
 * Display names for UI rendering
 * Maps canonical slot names to user-friendly display names
 */
export const SLOT_DISPLAY_NAMES: Record<string, string> = {
    'head': 'HEAD',
    'torso': 'TORSO',
    'hand_left': 'LEFT HAND',
    'hand_right': 'RIGHT HAND',
    'leg_left': 'LEFT LEG',
    'leg_right': 'RIGHT LEG',
};

/**
 * Body slot structure - LEGACY VERSION
 * Simple single-item-per-slot structure
 * @deprecated Use EquipmentSlot for new code
 */
export interface BodySlot {
    name: string;              // Slot name (e.g., "hand_left", "chest") - lowercase_snake_case
    critical: boolean;         // Critical slot (death if destroyed)
    item_instance_id: string | null;  // Equipped item instance ID, null if empty
}

/**
 * Equipment slot structure - NEW VERSION
 * Supports armor/garb/tool separation per body part
 * 
 * Example for hand_left:
 *   armor: "inst_gauntlet_001"       (1 item max)
 *   garb: ["inst_ring_001", ...]     (unlimited items)
 *   tool: "inst_sword_001"           (1 item max)
 */
export interface EquipmentSlot {
    name: string;              // Slot name (e.g., "hand_left", "torso")
    critical: boolean;         // Critical slot (death if destroyed)
    armor: string | null;      // ARMOR slot: Max 1 item
    garb: string[];            // GARB slots: Unlimited items
    tool: string | null;       // TOOL slot: Max 1 item
}

/**
 * Actor body slots map - LEGACY
 * Key is the slot name in lowercase_snake_case
 * @deprecated Use EquipmentSlots for new code
 */
export type BodySlots = Record<string, BodySlot>;

/**
 * Actor equipment slots map - NEW
 * Key is the slot name in lowercase_snake_case
 * Value is EquipmentSlot with armor/garb/tool separation
 */
export type EquipmentSlots = Record<string, EquipmentSlot>;

/**
 * Slot type categories
 * Defines which slot types are valid for each body part
 */
export const SLOT_TYPE_CATEGORIES: Record<string, string[]> = {
    "head": ["armor", "garb"],           // Helmet, hat, crown
    "torso": ["armor", "garb"],          // Chest plate, tunic, shirt
    "hand_left": ["armor", "garb", "tool"],  // Gauntlet, rings, weapon
    "hand_right": ["armor", "garb", "tool"], // Gauntlet, rings, weapon
    "leg_left": ["armor", "garb"],       // Greaves, pants
    "leg_right": ["armor", "garb"]       // Greaves, pants
};

/**
 * Slot type capacity limits
 * Defines max items per slot type
 */
export const SLOT_TYPE_CAPACITY: Record<string, number> = {
    "armor": 1,           // Max 1
    "garb": Infinity,     // Unlimited
    "tool": 1             // Max 1
};

/**
 * Slot type display colors for UI
 */
export const SLOT_TYPE_COLORS = {
    "armor": { r: 60, g: 120, b: 220 },    // Blue
    "garb": { r: 60, g: 180, b: 100 },     // Green
    "tool": { r: 220, g: 60, b: 60 }       // Red
};

/**
 * Equipment validation result
 */
export type EquipValidationResult =
    | { valid: true }
    | { valid: false; reason: string };

/**
 * Check if a slot is empty
 */
export function is_slot_empty(body_slots: BodySlots, slot_name: string): boolean {
    const slot = body_slots[slot_name];
    return !slot || slot.item_instance_id === null;
}

/**
 * Get equipped item instance ID from a slot
 * Returns null if slot is empty or doesn't exist
 */
export function get_equipped_item_id(body_slots: BodySlots, slot_name: string): string | null {
    const slot = body_slots[slot_name];
    return slot?.item_instance_id ?? null;
}

/**
 * Equip an item to a body slot
 * Returns success/failure and previous item if replaced
 */
export function equip_item(
    body_slots: BodySlots,
    slot_name: string,
    item_instance_id: string
): { success: boolean; previous_item_id: string | null; error?: string } {
    const slot = body_slots[slot_name];

    if (!slot) {
        return {
            success: false,
            previous_item_id: null,
            error: `Invalid body slot: ${slot_name}`
        };
    }

    const previous_item_id = slot.item_instance_id;
    slot.item_instance_id = item_instance_id;

    return { success: true, previous_item_id };
}

/**
 * Unequip an item from a body slot
 * Returns the item instance ID that was unequipped
 */
export function unequip_item(
    body_slots: BodySlots,
    slot_name: string
): { success: boolean; item_instance_id: string | null; error?: string } {
    const slot = body_slots[slot_name];

    if (!slot) {
        return {
            success: false,
            item_instance_id: null,
            error: `Invalid body slot: ${slot_name}`
        };
    }

    const item_instance_id = slot.item_instance_id;
    slot.item_instance_id = null;

    return { success: true, item_instance_id };
}

/**
 * Initialize body slots from kind.parts
 * Used during actor creation
 * Slot names should be provided in lowercase_snake_case
 */
export function initialize_body_slots(
    parts: Array<{ slot: string; critical?: boolean }> | undefined
): BodySlots {
    const slots: BodySlots = {};

    if (!parts || parts.length === 0) {
        return slots;
    }

    for (const part of parts) {
        // Convert to lowercase_snake_case (normalize spaces to underscores)
        const name = String(part.slot ?? "")
            .toLowerCase()
            .replace(/\s+/g, '_');
        if (!name) continue;

        slots[name] = {
            name,
            critical: Boolean(part.critical),
            item_instance_id: null,  // Empty by default
        };
    }

    return slots;
}

/**
 * Get all occupied slots (slots with equipped items)
 */
export function get_occupied_slots(body_slots: BodySlots): BodySlot[] {
    return Object.values(body_slots).filter(slot => slot.item_instance_id !== null);
}

/**
 * Get all empty slots
 */
export function get_empty_slots(body_slots: BodySlots): BodySlot[] {
    return Object.values(body_slots).filter(slot => slot.item_instance_id === null);
}

/**
 * Check if an item is equipped anywhere on the body
 */
export function is_item_equipped(body_slots: BodySlots, item_instance_id: string): boolean {
    return Object.values(body_slots).some(
        slot => slot.item_instance_id === item_instance_id
    );
}

/**
 * Find which slot an item is equipped in
 * Returns null if item is not equipped
 */
export function find_item_slot(
    body_slots: BodySlots,
    item_instance_id: string
): string | null {
    for (const [slot_name, slot] of Object.entries(body_slots)) {
        if (slot.item_instance_id === item_instance_id) {
            return slot_name;
        }
    }
    return null;
}

// ============================================================================
// BACKWARD COMPATIBILITY HELPERS
// These functions work with BOTH old (BodySlot) and new (EquipmentSlot) formats
// ============================================================================

/**
 * Check if body_slots uses new EquipmentSlot format
 * (has armor/garb/tool fields instead of item_instance_id)
 */
export function is_equipment_slot_format(body_slots: Record<string, any>): boolean {
    const first_slot = Object.values(body_slots)[0];
    return first_slot && ('armor' in first_slot || 'garb' in first_slot || 'tool' in first_slot);
}

/**
 * Get equipped item ID from a slot - works with BOTH formats
 * Returns null if slot is empty or doesn't exist
 */
export function get_slot_item_id(body_slots: Record<string, any>, slot_name: string): string | null {
    const slot = body_slots[slot_name];
    if (!slot) return null;

    // NEW format: check armor/garb/tool fields
    if ('armor' in slot || 'garb' in slot || 'tool' in slot) {
        // Return first equipped item found (priority: tool > armor > first garb)
        if (slot.tool) return slot.tool;
        if (slot.armor) return slot.armor;
        if (slot.garb && slot.garb.length > 0) return slot.garb[0];
        return null;
    }

    // OLD format: use item_instance_id
    return slot.item_instance_id ?? null;
}

/**
 * Get all equipped item IDs from a slot - works with BOTH formats
 * Returns array of item IDs (empty array if slot is empty)
 */
export function get_slot_all_item_ids(body_slots: Record<string, any>, slot_name: string): string[] {
    const slot = body_slots[slot_name];
    if (!slot) return [];

    // NEW format: collect all items from armor/garb/tool
    if ('armor' in slot || 'garb' in slot || 'tool' in slot) {
        const items: string[] = [];
        if (slot.tool) items.push(slot.tool);
        if (slot.armor) items.push(slot.armor);
        if (slot.garb && Array.isArray(slot.garb)) {
            items.push(...slot.garb);
        }
        return items;
    }

    // OLD format: return single item or empty
    return slot.item_instance_id ? [slot.item_instance_id] : [];
}

/**
 * Check if slot is empty - works with BOTH formats
 */
export function is_slot_empty_compat(body_slots: Record<string, any>, slot_name: string): boolean {
    return get_slot_item_id(body_slots, slot_name) === null;
}

/**
 * Find which slot contains an item - works with BOTH formats
 * Returns slot name or null if not found
 */
export function find_item_slot_compat(body_slots: Record<string, any>, item_instance_id: string): string | null {
    for (const [slot_name, slot] of Object.entries(body_slots)) {
        const items = get_slot_all_item_ids(body_slots, slot_name);
        if (items.includes(item_instance_id)) {
            return slot_name;
        }
    }
    return null;
}

/**
 * Check if item is equipped anywhere - works with BOTH formats
 */
export function is_item_equipped_compat(body_slots: Record<string, any>, item_instance_id: string): boolean {
    return find_item_slot_compat(body_slots, item_instance_id) !== null;
}

/**
 * Get all occupied slots - works with BOTH formats
 */
export function get_occupied_slots_compat(body_slots: Record<string, any>): Array<{ slot_name: string; item_ids: string[] }> {
    const occupied: Array<{ slot_name: string; item_ids: string[] }> = [];

    for (const slot_name of Object.keys(body_slots)) {
        const item_ids = get_slot_all_item_ids(body_slots, slot_name);
        if (item_ids.length > 0) {
            occupied.push({ slot_name, item_ids });
        }
    }

    return occupied;
}
