import type { TagInstance } from "../tag_system/registry.js";

/**
 * Container entry - reference to an item instance inside a container
 */
export interface ContainerEntry {
    item_instance_id: string;
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
     * Contents - array of item instance references
     */
    contents: ContainerEntry[];
    
    /**
     * Tags for container properties
     * Examples: [LOCKED], [TRAPPED], etc.
     */
    tags: TagInstance[];
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
