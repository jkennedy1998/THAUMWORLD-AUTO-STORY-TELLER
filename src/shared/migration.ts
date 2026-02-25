/**
 * Grid Coordinate Migration Utilities
 * 
 * This module handles migration from packed array storage to unified grid coordinates.
 * All items MUST have grid_x and grid_y coordinates.
 */

import type { ContainerContentEntry } from "../types/container.js";
import { debug_log, debug_warn, debug_error } from "./debug.js";
import { calculate_grid_dimensions } from "../types/container.js";

/**
 * Configuration for migration debugging
 */
export const MIGRATION_CONFIG = {
    DEBUG_MIGRATION: true,
    LOG_EVERY_ITEM: false,  // Set to true for verbose logging
};

/**
 * Ensure all items in a container have grid coordinates.
 * This function migrates items from packed array storage to grid coordinates.
 * 
 * @param contents - Array of container content entries
 * @param container_id - Container ID for logging
 * @param max_slots - Maximum slots in container (for calculating grid dimensions)
 * @returns Number of items migrated
 */
export function ensure_grid_coordinates(
    contents: ContainerContentEntry[],
    container_id: string,
    max_slots: number
): number {
    if (MIGRATION_CONFIG.DEBUG_MIGRATION) {
        debug_log("[MIGRATION] === Starting migration check ===");
        debug_log("[MIGRATION] Container:", container_id);
        debug_log("[MIGRATION] Item count:", contents.length);
        debug_log("[MIGRATION] Max slots:", max_slots);
    }

    // Calculate grid dimensions
    const { cols } = calculate_grid_dimensions(max_slots);
    
    if (MIGRATION_CONFIG.DEBUG_MIGRATION) {
        debug_log("[MIGRATION] Grid columns:", cols);
    }

    let migrated_count = 0;
    let already_had_coords = 0;

    contents.forEach((entry, index) => {
        // Check if item already has coordinates
        if (entry.grid_x === undefined || entry.grid_y === undefined) {
            const old_grid_x = entry.grid_x;
            const old_grid_y = entry.grid_y;
            
            // Assign coordinates based on array index
            entry.grid_x = index % cols;
            entry.grid_y = Math.floor(index / cols);
            migrated_count++;
            
            if (MIGRATION_CONFIG.DEBUG_MIGRATION) {
                if (MIGRATION_CONFIG.LOG_EVERY_ITEM) {
                    debug_log("[MIGRATION] Migrated item", entry.instance.def_id, 
                        "at index", index, "-> grid(" + entry.grid_x + "," + entry.grid_y + ")");
                }
                
                // Warn if item had partial coordinates
                if (old_grid_x !== undefined || old_grid_y !== undefined) {
                    debug_warn("[MIGRATION] Item had partial coordinates:", 
                        entry.instance.def_id,
                        "grid_x=" + old_grid_x, 
                        "grid_y=" + old_grid_y,
                        "-> fixed to grid(" + entry.grid_x + "," + entry.grid_y + ")");
                }
            }
        } else {
            already_had_coords++;
            
            if (MIGRATION_CONFIG.LOG_EVERY_ITEM && MIGRATION_CONFIG.DEBUG_MIGRATION) {
                debug_log("[MIGRATION] Item already has coordinates:", entry.instance.def_id,
                    "grid(" + entry.grid_x + "," + entry.grid_y + ")");
            }
        }
    });

    if (MIGRATION_CONFIG.DEBUG_MIGRATION) {
        if (migrated_count > 0) {
            debug_log("[MIGRATION] === Migration complete ===");
            debug_log("[MIGRATION] Migrated:", migrated_count, "items");
            debug_log("[MIGRATION] Already had coordinates:", already_had_coords, "items");
            debug_log("[MIGRATION] Total:", contents.length, "items");
        } else {
            debug_log("[MIGRATION] === No migration needed ===");
            debug_log("[MIGRATION] All", contents.length, "items already have coordinates");
        }
    }

    return migrated_count;
}

/**
 * Recursively ensure grid coordinates for all items including nested containers.
 * This handles container items that have their own container_data.
 * 
 * @param contents - Array of container content entries
 * @param container_id - Container ID for logging
 * @param max_slots - Maximum slots in container
 * @returns Total number of items migrated (including nested)
 */
export function ensure_grid_coordinates_recursive(
    contents: ContainerContentEntry[],
    container_id: string,
    max_slots: number
): number {
    let total_migrated = 0;
    
    // Migrate top-level items
    total_migrated += ensure_grid_coordinates(contents, container_id, max_slots);
    
    // Recursively migrate nested containers
    contents.forEach((entry, index) => {
        if (entry.instance.container_data) {
            const nested_container_id = `item.${entry.instance.id}`;
            const nested_max_slots = entry.instance.container_data.capacity?.max_slots || 
                entry.instance.container_data.contents?.length || 10;
            
            if (MIGRATION_CONFIG.DEBUG_MIGRATION) {
                debug_log("[MIGRATION] Processing nested container:", nested_container_id);
            }
            
            const nested_migrated = ensure_grid_coordinates_recursive(
                entry.instance.container_data.contents || [],
                nested_container_id,
                nested_max_slots
            );
            
            total_migrated += nested_migrated;
        }
    });
    
    return total_migrated;
}

/**
 * Validate that all items have valid grid coordinates.
 * Throws an error if any item is missing coordinates.
 * 
 * @param contents - Array of container content entries
 * @param container_id - Container ID for error messages
 * @throws Error if validation fails
 */
export function validate_grid_coordinates(
    contents: ContainerContentEntry[],
    container_id: string
): void {
    const missing_coords = contents.filter(
        entry => entry.grid_x === undefined || entry.grid_y === undefined
    );
    
    if (missing_coords.length > 0) {
        const item_names = missing_coords.map(e => e.instance.def_id).join(", ");
        debug_error("[MIGRATION] Validation failed for container", container_id);
        debug_error("[MIGRATION] Items missing coordinates:", item_names);
        throw new Error(
            `Container ${container_id} has ${missing_coords.length} items without grid coordinates: ${item_names}`
        );
    }
}

/**
 * Find the first empty grid position in a container.
 * Useful for placing new items.
 * 
 * @param contents - Array of container content entries
 * @param cols - Number of columns in grid
 * @param max_slots - Maximum slots in container
 * @returns Grid coordinates { x, y } or null if container is full
 */
export function find_empty_grid_position(
    contents: ContainerContentEntry[],
    cols: number,
    max_slots: number
): { x: number; y: number } | null {
    const rows = Math.ceil(max_slots / cols);
    
    // Create a set of occupied positions
    const occupied = new Set(
        contents.map(entry => `${entry.grid_x},${entry.grid_y}`)
    );
    
    // Find first empty position
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (!occupied.has(`${x},${y}`)) {
                return { x, y };
            }
        }
    }
    
    // Container is full
    return null;
}

/**
 * Check if a grid position is valid (within bounds and not occupied).
 * 
 * @param contents - Array of container content entries
 * @param x - Grid X coordinate
 * @param y - Grid Y coordinate
 * @param cols - Number of columns
 * @param max_slots - Maximum slots
 * @returns Object with valid flag and optional error message
 */
export function is_valid_grid_position(
    contents: ContainerContentEntry[],
    x: number,
    y: number,
    cols: number,
    max_slots: number
): { valid: boolean; error?: string; occupied_by?: string } {
    // Check bounds
    const rows = Math.ceil(max_slots / cols);
    
    if (x < 0 || x >= cols) {
        return { valid: false, error: `X coordinate ${x} out of bounds (0-${cols - 1})` };
    }
    
    if (y < 0 || y >= rows) {
        return { valid: false, error: `Y coordinate ${y} out of bounds (0-${rows - 1})` };
    }
    
    // Check if position is occupied
    const slot_index = y * cols + x;
    if (slot_index >= max_slots) {
        return { valid: false, error: `Position (${x},${y}) exceeds max_slots ${max_slots}` };
    }
    
    const occupied = contents.find(
        entry => entry.grid_x === x && entry.grid_y === y
    );
    
    if (occupied) {
        return { 
            valid: false, 
            error: `Position (${x},${y}) is occupied`,
            occupied_by: occupied.instance.def_id
        };
    }
    
    return { valid: true };
}