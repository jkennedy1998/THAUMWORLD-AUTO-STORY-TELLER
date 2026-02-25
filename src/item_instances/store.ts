import type { TagInstance } from "../tag_system/registry.js";
import type { ContainerContentEntry } from "../types/container.js";

/**
 * @deprecated ItemInstanceLookupResult is no longer needed with inline storage.
 * Items are now directly accessed from container.contents arrays.
 */
export type ItemInstanceLookupResult =
    | { ok: true; instance: ItemInstance; path: string }
    | { ok: false; error: string; todo: string };

/**
 * Container data for items with the CONTAINER tag
 * Items with container_data can hold other items inside them (nested containers)
 * Contents are stored in wrapped format {instance, definition, grid_x, grid_y}
 */
export interface ContainerData {
    capacity: {
        max_slots: number;
        max_weight: number;
    };
    contents: ContainerContentEntry[];
    is_open: boolean;
    is_locked: boolean;
}

/**
 * Item Instance - represents a specific item in the game world
 * 
 * With entity-centric storage, ItemInstances are stored inline in container.contents
 * arrays within entity files (NPCs, Actors, Places).
 * 
 * The container_id and owner_ref fields are maintained for backward compatibility
 * but are not used in the new system (ownership is implicit by location in entity.containers).
 * 
 * NEW: Items with the CONTAINER tag automatically have container_data, allowing them
 * to hold other items. This enables nested containers (e.g., a pouch holding a sword).
 */
export interface ItemInstance {
    id: string;
    def_id: string;
    qty: number;
    condition?: "pristine" | "good" | "worn" | "damaged" | "broken";
    tags: TagInstance[];
    /** @deprecated Use container location in entity.containers instead */
    container_id: string;
    /** @deprecated Ownership is implicit in entity.containers structure */
    owner_ref: string;
    /** 
     * Container data for items with CONTAINER tag
     * When present, this item can hold other items inside it
     */
    container_data?: ContainerData;
}

/**
 * Create an inline item instance helper
 * Use this to create items directly in container.contents arrays
 * 
 * Note: This function does NOT save to a separate file. The item should be
 * added to a container's contents array and the entity saved.
 * 
 * @example
 * const item = create_inline_item("coin", 10, "npc.gunther", "container.gunther.wallet");
 * container.contents.push(item);
 * save_container(slot, container);
 */
export function create_inline_item(
    def_id: string,
    qty: number = 1,
    owner_ref: string = "system",
    container_id: string = "",
    condition: ItemInstance["condition"] = "good"
): ItemInstance {
    return {
        id: generate_instance_id(),
        def_id,
        qty: Math.max(1, qty),
        condition,
        tags: [],
        container_id,
        owner_ref
    };
}

/**
 * Check if an item is a container type based on its tags
 */
export function is_container_item(item: ItemInstance): boolean {
    return item.tags.some(tag => tag.name === "CONTAINER");
}

/**
 * Add container_data to an item instance
 * Call this after creating items with the CONTAINER tag
 * 
 * @param item - The item to add container_data to (mutated in place)
 * @param max_slots - Maximum slots (default: 10)
 * @param max_weight - Maximum weight in grams (default: 5000)
 */
export function add_container_to_item(
    item: ItemInstance,
    max_slots: number = 10,
    max_weight: number = 5000
): void {
    item.container_data = {
        capacity: {
            max_slots,
            max_weight
        },
        contents: [],
        is_open: true,
        is_locked: false
    };
    
    // Ensure the CONTAINER tag exists
    if (!item.tags.some(tag => tag.name === "CONTAINER")) {
        item.tags.push({ name: "CONTAINER", mag: 1, meta: [], info: [] });
    }
}

/**
 * Create an inline item instance with container_data
 * Use this when creating container items (bags, pouches, etc.)
 * 
 * @example
 * const sack = create_container_item("small_sack", 1, "actor.henry", "container.henry.leg_left");
 * // sack.container_data is automatically created
 */
export function create_container_item(
    def_id: string,
    qty: number = 1,
    owner_ref: string = "system",
    container_id: string = "",
    max_slots: number = 10,
    max_weight: number = 5000
): ItemInstance {
    const item = create_inline_item(def_id, qty, owner_ref, container_id);
    add_container_to_item(item, max_slots, max_weight);
    return item;
}

/**
 * Generate a unique item instance ID
 * Format: inst_<8-char-base32>
 */
function generate_instance_id(): string {
    // Simple base32-ish random string generator
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let result = "inst_";
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * @deprecated All item instance file operations have been removed.
 * 
 * Items are now stored inline in entity.containers with the following benefits:
 * - O(1) access instead of O(n) file scanning
 * - No orphaned items (items always exist in a container)
 * - Atomic saves (save entity = save all items)
 * - Better data consistency
 * 
 * Migration completed: All items moved from item_instances/ directory
 * into entity.containers inline storage.
 * 
 * Use these functions instead:
 * - container_storage/store.ts:load_container() - Load container with items
 * - container_storage/store.ts:add_item_to_container() - Add item to container
 * - container_storage/store.ts:remove_item_from_container() - Remove item
 * - container_storage/store.ts:transfer_item_between_containers() - Transfer items
 * - container_storage/store.ts:find_item_in_entity_containers() - Find item by ID
 */
export const _DEPRECATED_ITEM_OPERATIONS_REMOVED = true;
