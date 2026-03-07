/**
 * Grid Calculator for Containers
 *
 * IMPORTANT: Grid dimensions must be canonical across server + client.
 * The authoritative algorithm lives in src/types/container.ts (calculate_grid_dimensions).
 */

import { calculate_grid_dimensions as canonical_calculate_grid_dimensions } from "../types/container.js";

/**
 * Calculate grid dimensions from max slots
 * @param max_slots - Maximum number of slots the container can hold
 * @returns Object with cols and rows
 */
export function calculate_grid_dimensions(max_slots: number): { cols: number; rows: number } {
    return canonical_calculate_grid_dimensions(max_slots);
}

/**
 * Calculate grid dimensions from container object
 * Safely handles missing or undefined capacity
 */
export function get_container_grid(container: { capacity?: { max_slots?: number } }): { cols: number; rows: number } {
    const max_slots = container?.capacity?.max_slots || 10;
    return calculate_grid_dimensions(max_slots);
}
