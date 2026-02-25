import type { TagInstance } from "../tag_system/registry.js";
import type { ItemInstance } from "../item_instances/store.js";

/**
 * Container entry - reference to an item instance inside a container
 * @deprecated Use ItemInstance directly in Container.contents (inline storage)
 */
export interface ContainerEntry {
    item_instance_id: string;
}

/**
 * Container content entry - wrapped item with instance and definition
 * This is the standardized format for all container contents
 */
export interface ContainerContentEntry {
    instance: ItemInstance;
    definition: {
        id: string;
        name: string;
        description?: string;
        weight?: number;
        weight_mag?: number;
        mag?: number;
        size_mag?: number;
        hardness_mag?: number;
        conductivity_mag?: number;
        tags?: TagInstance[];
        stackable?: boolean;
        max_stack_size?: number;
        display_char?: string;
        valid_body_slots?: string[];
        occupies_slots?: string[];
        slot_shape?: number[][];
        fits_actor_kind?: string[];
    };
    /**
     * Grid position within the container (REQUIRED - unified grid system)
     * x: column (0 to cols-1)
     * y: row (0 to rows-1)
     * All items MUST have grid coordinates - no packed fallback
     */
    grid_x: number;
    grid_y: number;
}

/**
 * Container position for scattered loot
 */
export interface ContainerPosition {
    x: number;
    y: number;
}

/**
 * Container - unified storage for items
 * 
 * Kinds:
 * - "actor": Character inventory (sack, hands, etc.)
 * - "npc": NPC inventory (wallet, shop inventory)
 * - "place": Ground containers (scattered loot, furniture)
 * 
 * Subtypes (for kind: "place"):
 * - "scattered": Loose items dropped on ground (auto-deletes when empty)
 * - undefined: Furniture/chests (persistent)
 */
export interface Container {
    id: string;
    kind: "actor" | "npc" | "place";
    
    /**
     * Subtype for place containers
     * - "scattered": Loose loot, auto-deletes when empty
     * - undefined: Furniture (chests, shelves), persists
     */
    subtype?: "scattered";
    
    /**
     * Position for scattered loot containers
     * Only used when kind === "place" and subtype === "scattered"
     */
    position?: ContainerPosition;
    
    /**
     * Place ID for scattered loot containers
     * Required for kind === "place"
     */
    place_id?: string;
    
    /**
     * Owner reference - who owns the container's contents
     * Format: "actor.<id>", "npc.<id>", or "system"
     */
    owner_ref: string;
    
    /**
     * Interaction range in tiles
     * Default: 1 (touch range - current tile + 8 adjacent)
     */
    interaction_range: number;
    
    /**
     * Capacity constraints
     */
    capacity?: {
        max_weight?: number;
        max_slots?: number;
    };
    
    /**
     * Contents - array of wrapped item entries (stored inline)
     * Each entry contains both the item instance and its definition
     * Format: { instance: ItemInstance, definition: ItemDefinition }
     */
    contents: ContainerContentEntry[];
    
    /**
     * Tags for container properties
     * Examples: [LOCKED], [TRAPPED], etc.
     */
    tags: TagInstance[];
    
    /**
     * UI state - is container currently open for interaction
     * Default: true (containers start open)
     */
    is_open: boolean;
    
    /**
     * Lock state - container requires unlocking before opening
     * Default: false (all containers unlocked for v1)
     * Architecture for future lock picking mechanics
     */
    is_locked: boolean;
}

/**
 * Container lookup result
 */
export type ContainerLookupResult =
    | { ok: true; container: Container; path: string }
    | { ok: false; error: string; todo: string };

/**
 * Build container ID for scattered loot
 * Format: container.place.<place_id>.scattered_<x>_<y>
 */
export function build_scattered_container_id(place_id: string, x: number, y: number): string {
    return `container.place.${place_id}.scattered_${x}_${y}`;
}

/**
 * Parse scattered container ID to extract coordinates
 * Returns null if not a scattered container
 */
export function parse_scattered_container_id(container_id: string): { place_id: string; x: number; y: number } | null {
    const match = container_id.match(/^container\.place\.(.+)\.scattered_(\d+)_(\d+)$/);
    if (!match) return null;
    
    const [, place_id, x_str, y_str] = match;
    if (!place_id || !x_str || !y_str) return null;
    
    return {
        place_id,
        x: parseInt(x_str, 10),
        y: parseInt(y_str, 10)
    };
}

/**
 * Calculate distance between two tile positions
 * Returns distance in tiles (for range validation)
 */
export function calculate_tile_distance(a: ContainerPosition, b: ContainerPosition): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if position is within interaction range
 * Touch range = 1 tile (current tile + all adjacent tiles)
 */
export function is_within_range(actor_pos: ContainerPosition, target_pos: ContainerPosition, range: number = 1): boolean {
    const distance = calculate_tile_distance(actor_pos, target_pos);
    return distance <= range;
}

/**
 * Calculate optimal grid dimensions for container UI
 * Finds rectangle that fits total_slots with minimal perimeter
 * Prefers landscape orientation (more columns than rows)
 * 
 * Examples:
 * - 5 slots -> 3x2 (last slot empty)
 * - 7 slots -> 3x3 (2 slots empty)
 * - 10 slots -> 5x2
 * - 12 slots -> 4x3
 * 
 * @param total_slots - Total number of slots to display
 * @returns Grid dimensions { cols, rows }
 */
export function calculate_grid_dimensions(total_slots: number): { cols: number; rows: number } {
    if (total_slots <= 0) return { cols: 1, rows: 1 };
    if (total_slots === 1) return { cols: 1, rows: 1 };
    if (total_slots === 2) return { cols: 2, rows: 1 };
    
    // Find the factor pair closest to square, preferring landscape
    let best_cols = total_slots;
    let best_rows = 1;
    let best_diff = total_slots - 1;
    
    for (let cols = Math.ceil(Math.sqrt(total_slots)); cols <= total_slots; cols++) {
        const rows = Math.ceil(total_slots / cols);
        const diff = Math.abs(cols - rows);
        
        // Prefer this layout if:
        // 1. It's more square (smaller diff), OR
        // 2. Same diff but more landscape-oriented
        if (diff < best_diff || (diff === best_diff && cols > best_cols)) {
            best_diff = diff;
            best_cols = cols;
            best_rows = rows;
        }
    }
    
    return { cols: best_cols, rows: best_rows };
}

/**
 * Get total slot count for a container
 * Uses capacity.max_slots if available, otherwise calculates from tags
 * Formula: slots = 5 * CONTAINER_MAG tag value
 * 
 * @param container - The container to get slot count for
 * @returns Total number of slots
 */
export function get_container_slot_count(container: Container): number {
    // If capacity.max_slots is set, use it
    if (container.capacity?.max_slots !== undefined) {
        return container.capacity.max_slots;
    }
    
    // Otherwise calculate from CONTAINER_MAG tag
    const container_mag_tag = container.tags.find(tag => tag.name === "CONTAINER_MAG");
    if (container_mag_tag) {
        return 5 * container_mag_tag.mag;
    }
    
    // Default: 5 slots (MAG 1)
    return 5;
}

/**
 * Apply defaults to container object
 * Ensures all required fields exist with sensible defaults
 * 
 * @param container - Partial container data (from JSON)
 * @returns Container with all required fields populated
 */
export function apply_container_defaults(container: Partial<Container>): Container {
    return {
        id: container.id ?? "unknown",
        kind: container.kind ?? "actor",
        owner_ref: container.owner_ref ?? "system",
        interaction_range: container.interaction_range ?? 1,
        contents: container.contents ?? [],
        tags: container.tags ?? [],
        is_open: container.is_open ?? true,
        is_locked: container.is_locked ?? false,
        // Optional fields
        subtype: container.subtype,
        position: container.position,
        place_id: container.place_id,
        capacity: container.capacity,
    } as Container;
}
