// Inline Item Types - Unified storage architecture
// Items stored directly in body_slots/ground as full objects (not IDs)

import type { TagInstance } from "../tag_system/registry.js";

/**
 * Inline Item - Full item object stored directly in body_slots/ground
 * No more ID references, no more container lookups
 */
export interface InlineItem {
    id: string;                    // Unique instance ID (UUID)
    def_id: string;                // Reference to item definition
    name: string;                  // Display name (copied from def for quick access)
    qty: number;                   // Stack quantity (default: 1)
    weight: number;                // Individual item weight (total = qty * weight)
    tags: TagInstance[];           // Item tags (including CONTAINER tag)
    contents?: InlineItem[];       // Nested items (only present if CONTAINER tag exists)
    container_capacity?: {         // Capacity limits (only for containers)
        max_slots?: number;
        max_weight?: number;
    };
}

/**
 * Body slot with inline items (armor/garb/tool)
 * Each slot type can hold different item configurations
 */
export interface InlineBodySlot {
    name: string;                  // Slot name (e.g., "hand_left", "torso")
    critical: boolean;             // Critical slot (death if destroyed)
    armor: InlineItem | null;      // ARMOR slot: Max 1 item
    garb: InlineItem[];            // GARB slots: Unlimited items (including sacks)
    tool: InlineItem | null;       // TOOL slot: Max 1 item
}

/**
 * Ground storage for places
 * Items stored inline, no container lookups needed
 */
export interface InlineGround {
    main: InlineItem[];            // Items without specific position
    scattered: Record<string, InlineItem[]>;  // Key = "x_y", items at that position
}

/**
 * Path to an item within body_slots
 * Used for transfers and lookups
 * Examples:
 *   - "hand_right.tool" → item in right hand
 *   - "leg_left.garb.0" → first garb item on left leg (could be sack)
 *   - "leg_left.garb.0.contents.2" → third item inside that sack
 */
export type ItemPath = string;

/**
 * Parse an item path into components
 * Example: "leg_left.garb.0.contents.2" → ['leg_left', 'garb', '0', 'contents', '2']
 */
export function parse_item_path(path: string): string[] {
    return path.split('.');
}

/**
 * Build an item path from components
 */
export function build_item_path(...components: string[]): string {
    return components.join('.');
}

/**
 * Check if an item is a container (has CONTAINER tag)
 */
export function is_container_item(item: InlineItem): boolean {
    return item.tags.some(tag => tag.name === 'CONTAINER');
}

/**
 * Get container capacity from item
 * Returns null if not a container
 */
export function get_container_capacity(item: InlineItem): { max_slots?: number; max_weight?: number } | null {
    if (!is_container_item(item)) return null;
    return item.container_capacity || null;
}

/**
 * Calculate total weight of an item (including contents if container)
 */
export function calculate_item_weight(item: InlineItem): number {
    const base_weight = item.weight * item.qty;
    
    if (item.contents && item.contents.length > 0) {
        const contents_weight = item.contents.reduce((sum, child) => 
            sum + calculate_item_weight(child), 0
        );
        return base_weight + contents_weight;
    }
    
    return base_weight;
}

/**
 * Calculate total weight of all items in body slots
 */
export function calculate_body_slots_weight(body_slots: Record<string, InlineBodySlot>): number {
    let total = 0;
    
    for (const slot of Object.values(body_slots)) {
        if (slot.armor) total += calculate_item_weight(slot.armor);
        if (slot.tool) total += calculate_item_weight(slot.tool);
        for (const garb_item of slot.garb) {
            total += calculate_item_weight(garb_item);
        }
    }
    
    return total;
}

/**
 * Find an item by ID within body_slots (deep search including container contents)
 * Returns the item and its path, or null if not found
 */
export function find_item_in_body_slots(
    body_slots: Record<string, InlineBodySlot>,
    item_id: string
): { item: InlineItem; path: string } | null {
    for (const [slot_name, slot] of Object.entries(body_slots)) {
        // Check armor
        if (slot.armor?.id === item_id) {
            return { item: slot.armor, path: `${slot_name}.armor` };
        }
        
        // Check tool
        if (slot.tool?.id === item_id) {
            return { item: slot.tool, path: `${slot_name}.tool` };
        }
        
        // Check garb (including nested containers)
        for (let i = 0; i < slot.garb.length; i++) {
            const garb_item = slot.garb[i]!;
            if (garb_item.id === item_id) {
                return { item: garb_item, path: `${slot_name}.garb.${i}` };
            }
            
            // Deep search in container contents
            if (garb_item.contents) {
                const found = find_item_in_contents(garb_item.contents, item_id, `${slot_name}.garb.${i}.contents`);
                if (found) return found;
            }
        }
    }
    
    return null;
}

/**
 * Deep search within container contents
 */
function find_item_in_contents(
    contents: InlineItem[],
    item_id: string,
    base_path: string
): { item: InlineItem; path: string } | null {
    for (let i = 0; i < contents.length; i++) {
        const item = contents[i]!;
        if (item.id === item_id) {
            return { item, path: `${base_path}.${i}` };
        }
        
        if (item.contents) {
            const found = find_item_in_contents(item.contents, item_id, `${base_path}.${i}.contents`);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Get all items from a body slot (flattened list with paths)
 */
export function get_slot_items(
    body_slots: Record<string, InlineBodySlot>,
    slot_name: string
): Array<{ item: InlineItem; path: string; slot_type: 'armor' | 'garb' | 'tool' }> {
    const result: Array<{ item: InlineItem; path: string; slot_type: 'armor' | 'garb' | 'tool' }> = [];
    const slot = body_slots[slot_name];
    
    if (!slot) return result;
    
    if (slot.armor) {
        result.push({ item: slot.armor, path: `${slot_name}.armor`, slot_type: 'armor' });
    }
    
    if (slot.tool) {
        result.push({ item: slot.tool, path: `${slot_name}.tool`, slot_type: 'tool' });
    }
    
    slot.garb.forEach((item, index) => {
        result.push({ item, path: `${slot_name}.garb.${index}`, slot_type: 'garb' });
    });
    
    return result;
}

/**
 * Check if a slot is empty (no items in any category)
 */
export function is_slot_empty(slot: InlineBodySlot): boolean {
    return !slot.armor && !slot.tool && slot.garb.length === 0;
}

/**
 * Count total items in a slot (including container contents)
 */
export function count_slot_items(slot: InlineBodySlot): number {
    let count = 0;
    if (slot.armor) count++;
    if (slot.tool) count++;
    count += slot.garb.length;
    return count;
}
