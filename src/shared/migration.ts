/**
 * Grid Utilities
 * 
 * Utility functions for working with grid coordinates in containers.
 * Migration is complete - these are now just helper functions.
 */

import type { ContainerContentEntry } from "../types/container.js";
import { calculate_grid_dimensions } from "../types/container.js";

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
    
    return null;
}
