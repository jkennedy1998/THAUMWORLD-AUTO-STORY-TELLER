/**
 * Global Time System
 * 
 * Manages game time for all movement and actions.
 * Supports pause/play for timed events.
 * Movement speeds are based on character stats (tiles per turn).
 */

import { debug_log } from "./debug.js";

// Time constants
export const TICK_RATE_MS = 50; // 20Hz update rate
export const MS_PER_TURN = 6000; // 6 seconds per turn (for visualization)

// Global time state
let is_paused = false;
let current_time = 0; // Time in milliseconds
let last_update = Date.now();

// Callbacks for time updates
const time_callbacks: Array<(delta_ms: number) => void> = [];

// Interval handle
let interval_id: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the global time system
 */
export function init_global_time(): void {
  if (interval_id) return;
  
  last_update = Date.now();
  interval_id = setInterval(() => {
    update_time();
  }, TICK_RATE_MS);
  
  debug_log("GlobalTime", "Initialized", { tick_rate_ms: TICK_RATE_MS });
}

/**
 * Stop the global time system
 */
export function stop_global_time(): void {
  if (interval_id) {
    clearInterval(interval_id);
    interval_id = null;
  }
}

/**
 * Update time - called every tick
 */
function update_time(): void {
  if (is_paused) return;
  
  const now = Date.now();
  const delta_ms = now - last_update;
  last_update = now;
  
  current_time += delta_ms;
  
  // Notify all subscribers
  for (const callback of time_callbacks) {
    callback(delta_ms);
  }
}

/**
 * Pause time (for timed events)
 */
export function pause_time(): void {
  is_paused = true;
  debug_log("GlobalTime", "Paused", { current_time });
}

/**
 * Resume time
 */
export function resume_time(): void {
  is_paused = false;
  last_update = Date.now();
  debug_log("GlobalTime", "Resumed", { current_time });
}

/**
 * Check if time is paused
 */
export function is_time_paused(): boolean {
  return is_paused;
}

/**
 * Get current time in milliseconds
 */
export function get_current_time(): number {
  return current_time;
}

/**
 * Register a callback for time updates
 */
export function on_time_update(callback: (delta_ms: number) => void): void {
  time_callbacks.push(callback);
}

/**
 * Unregister a callback
 */
export function off_time_update(callback: (delta_ms: number) => void): void {
  const index = time_callbacks.indexOf(callback);
  if (index >= 0) {
    time_callbacks.splice(index, 1);
  }
}

/**
 * Convert walk speed (tiles per turn) to milliseconds per tile
 * Characters typically have 4 tiles per turn for walking
 */
export function tiles_per_turn_to_mspt(tiles_per_turn: number): number {
  if (tiles_per_turn <= 0) return MS_PER_TURN; // Default 1 tile per turn
  return MS_PER_TURN / tiles_per_turn;
}

/**
 * Get default walk speed (4 tiles per turn)
 */
export function get_default_walk_speed(): number {
  return 4; // 4 tiles per turn
}

/**
 * Format time for display
 */
export function format_time(ms: number): string {
  const turns = Math.floor(ms / MS_PER_TURN);
  const remainder = ms % MS_PER_TURN;
  const percent = Math.floor((remainder / MS_PER_TURN) * 100);
  return `Turn ${turns} (${percent}%)`;
}
