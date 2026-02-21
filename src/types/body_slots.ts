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
 * Body slot structure
 * Tracks the slot name, if it's critical (for death checks), and equipped item
 */
export interface BodySlot {
    name: string;              // Slot name (e.g., "hand_left", "chest") - lowercase_snake_case
    critical: boolean;         // Critical slot (death if destroyed)
    item_instance_id: string | null;  // Equipped item instance ID, null if empty
}

/**
 * Actor body slots map
 * Key is the slot name in lowercase_snake_case
 */
export type BodySlots = Record<string, BodySlot>;

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
