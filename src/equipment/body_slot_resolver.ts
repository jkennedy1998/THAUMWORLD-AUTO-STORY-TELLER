/**
 * Body Slot Resolver
 * 
 * Organizes equipment slots (armor/garb/tool) into a compact grid layout
 * for rendering in the CharacterModule.
 * 
 * Layout per body part (within a square area):
 * ┌───┬───┬───┬───┬───┐
 * │ T │ A │ G │ G │ G │ ...
 * │ O │ R │ A │ A │ A │     (garb expands rightward)
 * │ O │ M │ R │ R │ R │
 * │ L │ O │ B │ B │ B │
 * └───┴───┴───┴───┴───┘
 * 
 * Order: TOOL → ARMOR → GARB (equipped) → GARB (empty placeholder)
 * Garb slots have no gaps - they pack tightly with one extra empty slot for drops
 */

import type { EquipmentSlots, EquipmentSlot } from "../types/body_slots.js";

/**
 * Types of equipment slots
 */
export type SlotType = "tool" | "armor" | "garb";

/**
 * A resolved slot ready for UI rendering
 */
export interface ResolvedSlot {
  /** Body slot name (e.g., "hand_left", "torso") */
  body_slot: string;
  
  /** Slot type classification */
  slot_type: SlotType;
  
  /** For garb slots: position in the garb array (0, 1, 2, ...) */
  garb_index: number | null;
  
  /** Item instance ID or null if empty */
  item_id: string | null;
  
  /** Whether this is a placeholder empty garb slot for drag targeting */
  is_placeholder: boolean;
  
  /** Relative position within the body slot's square area (0,0 is top-left of tool) */
  rel_x: number;
  rel_y: number;
  
  /** Absolute screen position (set by renderer) */
  screen_x: number;
  screen_y: number;
}

/**
 * All slots for a single body part
 */
export interface ResolvedBodySlot {
  /** Body slot name */
  name: string;
  
  /** All resolved slots for this body part */
  slots: ResolvedSlot[];
  
  /** Width of the slot group in characters */
  width: number;
  
  /** Height of the slot group in characters */
  height: number;
}

/**
 * Configuration for slot layout
 */
export interface SlotLayoutConfig {
  /** Width of each slot cell */
  cell_width: number;
  
  /** Height of each slot cell */
  cell_height: number;
  
  /** Gap between slots */
  gap: number;
  
  /** Maximum garb slots to show (null = unlimited) */
  max_garb_slots: number | null;
}

/** Default layout configuration */
export const DEFAULT_SLOT_LAYOUT: SlotLayoutConfig = {
  cell_width: 1,
  cell_height: 1,
  gap: 1,
  max_garb_slots: null, // Unlimited
};

/**
 * Slot type display colors
 */
export const SLOT_TYPE_COLORS = {
  tool: { r: 220, g: 60, b: 60 },    // Red
  armor: { r: 60, g: 120, b: 220 },   // Blue
  garb: { r: 60, g: 180, b: 100 },    // Green
  empty: { r: 60, g: 60, b: 60 },     // Gray (for empty slots)
};

/**
 * Vivid highlight colors for drag-over states
 * Uses indexed color system vivid variants
 */
export const SLOT_HIGHLIGHT_COLORS = {
  tool: { r: 220, g: 52, b: 38 },     // vivid_red (index 14)
  armor: { r: 39, g: 73, b: 208 },    // vivid_blue (index 28)
  garb: { r: 79, g: 157, b: 53 },     // vivid_green (index 24)
};

function extract_item_id(maybe_item: any): string | null {
  if (!maybe_item) return null;
  if (typeof maybe_item === "string") return maybe_item;
  if (typeof maybe_item === "object" && typeof maybe_item.id === "string") return maybe_item.id;
  return null;
}

/**
 * Resolve slots for a single body part
 * 
 * Order: TOOL → ARMOR → GARB (equipped items in order) → GARB (empty placeholder)
 * 
 * @param slot_name - Body slot name (e.g., "hand_left")
 * @param slot_data - The slot data from body_slots
 * @param config - Layout configuration
 * @returns Resolved slots for this body part
 */
export function resolve_body_slot(
  slot_name: string,
  slot_data: EquipmentSlot,
  config: SlotLayoutConfig = DEFAULT_SLOT_LAYOUT
): ResolvedSlot[] {
  const slots: ResolvedSlot[] = [];
  let current_col = 0;

  // Determine which slot types this body part supports
  const supports_tool = ["hand_left", "hand_right"].includes(slot_name);
  
  if (supports_tool) {
    slots.push({
      body_slot: slot_name,
      slot_type: "tool",
      garb_index: null,
      item_id: extract_item_id(slot_data.tool),
      is_placeholder: false,
      rel_x: current_col * (config.cell_width + config.gap),
      rel_y: 0,
      screen_x: 0,
      screen_y: 0,
    });
    current_col++;
  }

  slots.push({
    body_slot: slot_name,
    slot_type: "armor",
    garb_index: null,
    item_id: extract_item_id(slot_data.armor),
    is_placeholder: false,
    rel_x: current_col * (config.cell_width + config.gap),
    rel_y: 0,
    screen_x: 0,
    screen_y: 0,
  });
  current_col++;

  const garb_items: any[] = Array.isArray(slot_data.garb) ? slot_data.garb : [];
  for (let i = 0; i < garb_items.length; i++) {
    const item_id = extract_item_id(garb_items[i]);
    if (!item_id) continue;
    slots.push({
      body_slot: slot_name,
      slot_type: "garb",
      garb_index: i,
      item_id,
      is_placeholder: false,
      rel_x: current_col * (config.cell_width + config.gap),
      rel_y: 0,
      screen_x: 0,
      screen_y: 0,
    });
    current_col++;
  }

  slots.push({
    body_slot: slot_name,
    slot_type: "garb",
    garb_index: garb_items.length,
    item_id: null,
    is_placeholder: true,
    rel_x: current_col * (config.cell_width + config.gap),
    rel_y: 0,
    screen_x: 0,
    screen_y: 0,
  });
  
  return slots;
}

/**
 * Resolve all body slots for an actor
 * 
 * @param body_slots - The actor's body_slots map
 * @param config - Layout configuration
 * @returns Map of slot name to resolved slots
 */
export function resolve_all_body_slots(
  body_slots: EquipmentSlots,
  config: SlotLayoutConfig = DEFAULT_SLOT_LAYOUT
): Map<string, ResolvedSlot[]> {
  const resolved = new Map<string, ResolvedSlot[]>();
  
  for (const [slot_name, slot_data] of Object.entries(body_slots)) {
    if (slot_data) {
      const slots = resolve_body_slot(slot_name, slot_data, config);
      resolved.set(slot_name, slots);
    }
  }
  
  return resolved;
}

/**
 * Find a resolved slot at a screen position
 * 
 * @param resolved_slots - All resolved slots
 * @param x - Screen x coordinate
 * @param y - Screen y coordinate
 * @param tolerance - Tolerance in characters (default: 0 = must be exact)
 * @returns The resolved slot or null if not found
 */
export function find_slot_at_position(
  resolved_slots: Map<string, ResolvedSlot[]>,
  x: number,
  y: number,
  tolerance: number = 0
): ResolvedSlot | null {
  for (const slots of resolved_slots.values()) {
    for (const slot of slots) {
      const dx = Math.abs(slot.screen_x - x);
      const dy = Math.abs(slot.screen_y - y);
      if (dx <= tolerance && dy <= tolerance) {
        return slot;
      }
    }
  }
  return null;
}

/**
 * Get the container ID for a resolved slot
 * Used for drag-and-drop operations
 * 
 * Format: container.{actor_id}.{body_slot}.{slot_type}[.{garb_index}]
 * Examples:
 *   - container.henry_actor.hand_left.tool
 *   - container.henry_actor.torso.armor
 *   - container.henry_actor.hand_left.garb.0
 *   - container.henry_actor.hand_left.garb.2
 * 
 * @param actor_id - The actor's ID
 * @param slot - The resolved slot
 * @returns Container ID string
 */
export function get_slot_container_id(actor_id: string, slot: ResolvedSlot): string {
  // Phase 5 inline path IDs
  // body_slots.<body_slot>.<slot_type>[.<garb_index>]
  if (slot.slot_type === "garb" && slot.garb_index !== null) {
    return `body_slots.${slot.body_slot}.${slot.slot_type}.${slot.garb_index}`;
  }
  return `body_slots.${slot.body_slot}.${slot.slot_type}`;
}

/**
 * Parse a container ID to extract slot information
 * 
 * @param container_id - Container ID string
 * @returns Parsed info or null if invalid
 */
export function parse_slot_container_id(container_id: string): {
  body_slot: string;
  slot_type: SlotType;
  garb_index: number | null;
} | null {
  const match = container_id.match(/^body_slots\.(\w+)\.(tool|armor|garb)(?:\.(\d+))?$/);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  return {
    body_slot: match[1]!,
    slot_type: match[2] as SlotType,
    garb_index: match[3] ? parseInt(match[3], 10) : null,
  };
}

/**
 * Check if a container ID represents a body slot (not a nested item container)
 */
export function is_body_slot_container_id(container_id: string): boolean {
  return container_id.startsWith("body_slots.");
}

/**
 * Get slot color based on type and state
 */
export function get_slot_color(
  slot_type: SlotType,
  is_empty: boolean,
  is_highlighted: boolean = false
): { r: number; g: number; b: number } {
  if (is_highlighted) {
    // Use vivid colors from indexed color system for highlights
    return SLOT_HIGHLIGHT_COLORS[slot_type];
  }
  
  if (is_empty) {
    // Empty slots - brighter colors for visibility
    switch (slot_type) {
      case "tool": return { r: 180, g: 60, b: 60 }; // Bright red
      case "armor": return { r: 60, g: 120, b: 220 }; // Bright blue
      case "garb": return { r: 60, g: 200, b: 100 }; // Bright green
    }
  }
  
  return SLOT_TYPE_COLORS[slot_type];
}

/**
 * Calculate total width of a resolved slot group
 */
export function get_slot_group_width(
  slots: ResolvedSlot[],
  config: SlotLayoutConfig = DEFAULT_SLOT_LAYOUT
): number {
  if (slots.length === 0) return 0;
  
  const max_col = Math.max(...slots.map(s => s.rel_x));
  return max_col + config.cell_width;
}
