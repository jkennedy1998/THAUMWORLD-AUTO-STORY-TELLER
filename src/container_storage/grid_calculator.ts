/**
 * Grid Calculator for Containers
 * 
 * Calculates grid dimensions (cols x rows) from container capacity.max_slots.
 * No need to store grid_dimensions in container data - it's derived dynamically.
 * 
 * Examples:
 * - 1 slot → 1x1
 * - 2-5 slots → Nx1 (single row)
 * - 6-10 slots → 5x2
 * - 11-20 slots → 5x4
 * - 21-50 slots → 10x5
 * - 50+ slots → 10xN (up to 10 cols, expand rows)
 */

/**
 * Calculate grid dimensions from max slots
 * @param max_slots - Maximum number of slots the container can hold
 * @returns Object with cols and rows
 */
export function calculate_grid_dimensions(max_slots: number): { cols: number; rows: number } {
    // Ensure valid input
    const slots = Math.max(1, max_slots);
    
    // 1 slot: single cell
    if (slots <= 1) return { cols: 1, rows: 1 };
    
    // 2-5 slots: single row, expand columns
    if (slots <= 5) return { cols: slots, rows: 1 };
    
    // 6-10 slots: 5x2 grid (standard small container)
    if (slots <= 10) return { cols: 5, rows: 2 };
    
    // 11-20 slots: 5x4 grid (medium container)
    if (slots <= 20) return { cols: 5, rows: 4 };
    
    // 21-50 slots: 10x5 grid (large container)
    if (slots <= 50) return { cols: 10, rows: 5 };
    
    // 50+ slots: 10 columns, expand rows as needed
    const rows = Math.ceil(slots / 10);
    return { cols: 10, rows };
}

/**
 * Calculate grid dimensions from container object
 * Safely handles missing or undefined capacity
 */
export function get_container_grid(container: { capacity?: { max_slots?: number } }): { cols: number; rows: number } {
    const max_slots = container?.capacity?.max_slots || 10;
    return calculate_grid_dimensions(max_slots);
}
