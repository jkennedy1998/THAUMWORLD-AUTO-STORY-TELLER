import type { Canvas, Module, Rect, Rgb, PointerEvent, DragEvent } from "../types.js";
import type { Container } from "../../types/container.js";
import type { ItemInstance } from "../../item_instances/store.js";
import type { ItemDefinition } from "../../item_storage/store.js";
import type { EquipmentSlots } from "../../types/body_slots.js";
import { debug_log } from "../../shared/debug.js";
import { PANEL_BORDER_PRESETS, draw_container_box } from "../module_borders.js";
import { get_color_by_name } from "../colors.js";
import { resolve_cell } from "../../render_shaders/resolver.js";
import { make_item_payload, make_slot_payload } from "../../render_shaders/payload_builders.js";
import { draw_render_queue, type RenderRequest } from "../../render_shaders/render_queue.js";
import { ctx_character_slot, ctx_container_ui } from "../../render_shaders/context_builders.js";
import type { ModuleGizmosConfig } from "../module_gizmos.js";
import { make_floating_panel_module } from "./floating_panel_module.js";
import {
  resolve_all_body_slots,
  find_slot_at_position,
  get_slot_container_id,
  type ResolvedSlot,
  type SlotType,
  DEFAULT_SLOT_LAYOUT,
  get_slot_color,
  SLOT_TYPE_COLORS,
  SLOT_HIGHLIGHT_COLORS,
} from "../../equipment/body_slot_resolver.js";
import { has_resolved_tag } from "../../tag_system/canonical_readers.js";
import { tag_key } from "../../tag_system/tag_key.js";
import type { TagInstance } from "../../tag_system/registry.js";

export const CHARACTER_MODULE_TAG_ROWS = 4;
export const CHARACTER_MODULE_TAG_AREA_HEIGHT = CHARACTER_MODULE_TAG_ROWS + 1;

export function get_character_module_tag_row_at(rect: Rect, x: number, y: number, tag_count: number): { kind: "tag"; index: number } | { kind: "add" } | null {
  const x0 = rect.x0 + 6;
  const x1 = rect.x1 - 1;
  const row_start_y = rect.y0 + 2;
  if (x < x0 || x > x1) return null;
  if (y < row_start_y || y >= row_start_y + CHARACTER_MODULE_TAG_ROWS) return null;
  const index = y - row_start_y;
  const visible_tag_rows = Math.max(0, Math.min(tag_count, CHARACTER_MODULE_TAG_ROWS - 1));
  if (index < visible_tag_rows) return { kind: "tag", index };
  if (index === visible_tag_rows) return { kind: "add" };
  return null;
}

// Character module configuration
export type CharacterModuleConfig = {
  id: string;
  rect: Rect;
  
  // Character data
  get_actor_name: () => string;
  get_actor_id: () => string; // Full actor ID (e.g., "henry_actor")
  get_body_slots: () => EquipmentSlots;
  get_equipped_items: () => Map<string, { instance: ItemInstance; definition: ItemDefinition }>;
  get_tags?: () => TagInstance[];
  get_selected_tag_key?: () => string | null;
  
  // Weight data
  get_weight_data: () => {
    current: number;
    max: number;
  };
  
  // Interaction
  get_is_visible: () => boolean;
  on_slot_click?: (slot_name: string, slot_type: SlotType, garb_index: number | null) => void;
  on_select_item?: (slot_name: string, slot_type: SlotType, garb_index: number | null, item: ItemInstance, definition: ItemDefinition) => void;
  on_select_tag?: (tag: TagInstance) => void;
  on_add_tag?: () => void;
  on_drop?: (slot_name: string, slot_type: SlotType, garb_index: number | null, target?: CharacterDropTarget) => Promise<boolean>;
  on_drag_start?: (
    slot_name: string,
    slot_type: SlotType,
    garb_index: number | null,
    item: ItemInstance,
    definition: ItemDefinition,
    container_id: string
  ) => void;
  on_cross_module_drop?: (x: number, y: number) => Promise<boolean>;
  on_slot_hover?: (
    slot_name: string | null,
    slot_type: SlotType | null,
    garb_index: number | null,
    equipped_item: { instance: ItemInstance; definition: ItemDefinition } | null
  ) => void;
  get_highlighted_slots?: () => Array<{ slot_name: string; slot_type: SlotType; garb_index?: number }>;
  on_drag_rejected?: () => void;
  on_invalid_drop?: (message: string) => void;

  // Styling
  border_rgb?: Rgb;
  bg_rgb?: Rgb;
  text_rgb?: Rgb;
  
  // Phase 8: Module Gizmos (close X, move #)
  gizmos?: ModuleGizmosConfig;
  
  // Container sidebar: Equipped containers only
  get_equipped_containers?: () => Array<{
    slot_name: string;
    item_instance: ItemInstance;
    item_definition: ItemDefinition;
    container_id: string;
  }>;
  on_container_click?: (container_id: string) => void;
  // Default container selection (used for pickup routing)
  get_default_container_id?: () => string | null;
  on_set_default_container?: (container_id: string) => void;
  
  // Phase 7: Right-click container opening
  on_open_container?: (container_id: string, slot_name: string) => Promise<void>;
  get_open_containers?: () => Set<string>;
};

export type CharacterDropTarget = {
  kind: 'body_slot' | 'sidebar_container';
  slot_name: string | null;
  slot_type: SlotType | null;
  garb_index: number | null;
  item_instance_id: string | null;
  container_id: string | null;
};

export function make_character_module(opts: CharacterModuleConfig): Module {
  // Phase 8: Use mutable rect for moving
  let rect = opts.rect;
  
  // Track currently hovered slot (includes slot type info)
  let hover_slot: ResolvedSlot | null = null;
  
  // Layout constants
  const SIDEBAR_WIDTH = 5;
  
  // Phase 7: Track sidebar container boxes
  let sidebar_boxes: Array<{ x0: number; y0: number; x1: number; y1: number; container_id: string }> = [];
  
  // Cache resolved slots for hit detection
  let resolved_slots_cache: Map<string, ResolvedSlot[]> = new Map();

  function get_equipped_item_by_id(item_id: string | null | undefined): { instance: ItemInstance; definition: ItemDefinition } | null {
    if (!item_id) return null;
    const equipped = opts.get_equipped_items();
    return Array.from(equipped.values()).find(item => item.instance.id === item_id) || null;
  }

  function get_sidebar_container_at_position(x: number, y: number): { container_id: string } | null {
    for (const box of sidebar_boxes) {
      if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) {
        return { container_id: box.container_id };
      }
    }
    return null;
  }
  
  // Pan state for body slots area
  let pan_offset = { x: 0, y: 0 };
  let is_panning = false;
  let pan_start = { x: 0, y: 0 };
  let pan_start_offset = { x: 0, y: 0 };
  const BODY_SLOTS_PADDING = 2; // Padding around body slots area

  debug_log("[CharacterModule] Created module:", opts.id);

  /**
   * Get the content area bounds (the red area in the screenshot)
   * This is where body slots are displayed and clipped to
   */
  function get_content_bounds(): { left: number; right: number; top: number; bottom: number } {
    return {
      left: rect.x0 + SIDEBAR_WIDTH,
      right: rect.x1,
      top: rect.y0 + 2 + CHARACTER_MODULE_TAG_AREA_HEIGHT,
      bottom: rect.y1 - 3,  // Above weight bar
    };
  }

  /**
   * Check if a screen position is within the body slots area (excludes sidebar, header, footer)
   */
  function is_in_body_slots_area(x: number, y: number): boolean {
    const bounds = get_content_bounds();
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  }

  /**
   * Calculate pan bounds based on content size vs visible area
   * Ensures at least some portion of content is always visible
   */
  function calculate_pan_bounds(): { min_x: number; max_x: number; min_y: number; max_y: number } {
    const bounds = get_content_bounds();
    const visible_width = bounds.right - bounds.left;
    const visible_height = bounds.bottom - bounds.top;
    
    // Calculate content extents based on body part positions
    // Row 0 (head) is at bottom, Row 3 (legs) is at top
    const row_height = 3;
    const start_y = rect.y1 - 6; // Starting Y for head (bottom-most)
    
    // Content spans from legs (top) to head (bottom)
    // Remember: Y increases downward in this coordinate system
    const head_y = start_y;  // Bottom of content (largest Y)
    const legs_y = start_y - (3 * row_height);  // Top of content (smallest Y)
    
    // Content height (vertical span)
    const content_height = head_y - legs_y + DEFAULT_SLOT_LAYOUT.cell_height;
    
    // Content width - based on widest slot group (hands with many garb slots)
    // Estimate max garb slots and calculate width
    const max_garb_slots = 8; // Reasonable max
    const slot_group_width = (2 + max_garb_slots) * (DEFAULT_SLOT_LAYOUT.cell_width + DEFAULT_SLOT_LAYOUT.gap);
    const content_width = slot_group_width;
    
    // Center X position of content area
    const content_center_x = (bounds.left + bounds.right) / 2;
    const content_left_edge = content_center_x - slot_group_width / 2;
    const content_right_edge = content_center_x + slot_group_width / 2;
    
    // Calculate pan bounds to keep at least one row/column visible
    const min_visible = 3; // At least 3 chars of a slot must be visible
    
    // Content default positions (without pan):
    // - legs_y is the top of content (smallest Y value)
    // - head_y is the center Y of head slot group (largest Y value)
    // When pan_offset.y increases, content moves DOWN (larger Y)
    // When pan_offset.y decreases, content moves UP (smaller Y)
    
    return {
      // Horizontal bounds:
      // min_x: pan left until right edge of content reaches left edge + min_visible
      min_x: bounds.left - content_right_edge + min_visible,
      // max_x: pan right until left edge of content reaches right edge - min_visible  
      max_x: bounds.right - content_left_edge - min_visible,
      
      // Vertical bounds (Y increases downward):
      // min_y: pan up (negative) until bottom of content (head) is visible at top of view
      min_y: bounds.top - head_y + min_visible,
      // max_y: pan down (positive) until top of content (legs) is visible at bottom of view
      max_y: bounds.bottom - legs_y - min_visible,
    };
  }

  /**
   * Clamp a value between min and max
   */
  function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
  }

  /**
   * Get the resolved slot at a screen position (accounting for pan)
   */
  function get_resolved_slot_at_position(x: number, y: number): ResolvedSlot | null {
    if (!opts.get_is_visible()) return null;
    
    // The slot.screen_x/y already include pan_offset
    // So we compare mouse position directly to slot screen position
    
    // Search through all resolved slots
    for (const slots of resolved_slots_cache.values()) {
      for (const slot of slots) {
        // Check if position is within the slot's 3x3 area
        const half_width = Math.floor(DEFAULT_SLOT_LAYOUT.cell_width / 2);
        const half_height = Math.floor(DEFAULT_SLOT_LAYOUT.cell_height / 2);
        
        if (
          x >= slot.screen_x - half_width &&
          x <= slot.screen_x + half_width &&
          y >= slot.screen_y - half_height &&
          y <= slot.screen_y + half_height
        ) {
          return slot;
        }
      }
    }
    
    return null;
  }

  function get_drop_target_at_position(x: number, y: number): CharacterDropTarget | null {
    const sidebar = get_sidebar_container_at_position(x, y);
    if (sidebar) {
      const container = opts.get_equipped_containers?.().find((entry) => entry.container_id === sidebar.container_id) ?? null;
      return {
        kind: 'sidebar_container',
        slot_name: container?.slot_name ?? null,
        slot_type: null,
        garb_index: null,
        item_instance_id: container?.item_instance?.id ?? null,
        container_id: sidebar.container_id,
      };
    }

    const slot = get_resolved_slot_at_position(x, y);
    if (!slot) return null;
    return {
      kind: 'body_slot',
      slot_name: slot.body_slot,
      slot_type: slot.slot_type,
      garb_index: slot.garb_index,
      item_instance_id: slot.item_id ?? null,
      container_id: slot.item_id ? get_slot_container_id(opts.get_actor_id(), slot) : null,
    };
  }

  /**
   * Draw a single equipment slot (simplified - just a character)
   */
  function draw_equipment_slot(
    rq: RenderRequest[],
    slot: ResolvedSlot,
    equipped_item: { instance: ItemInstance; definition: ItemDefinition } | undefined,
    is_hovered: boolean,
    is_highlighted: boolean
  ): void {
    const bounds = get_content_bounds();
    
    const x = slot.screen_x;
    const y = slot.screen_y;
    
    // Skip if outside content bounds
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
      return;
    }
    
      if (equipped_item) {
        // Draw the equipped item character
        
        const container_id = get_slot_container_id(opts.get_actor_id(), slot);
        const is_open = opts.get_open_containers?.().has(container_id) ?? false;
      
      // Check if item is in tool slot but doesn't have TOOL tag
      const is_tool_slot = slot.slot_type === 'tool';
      const has_tool_tag = has_resolved_tag((equipped_item.instance as any), 'TOOL') || Array.isArray((equipped_item.definition as any)?.tags) && (equipped_item.definition as any).tags.some((tag: any) => String(tag?.name ?? '').trim().toUpperCase() === 'TOOL');
      const is_non_tool_in_tool_slot = is_tool_slot && !has_tool_tag;

      rq.push({
        pass: 'item',
        x,
        y,
        order: 0,
        key: equipped_item.instance.id,
        payload: make_item_payload(equipped_item.instance, equipped_item.definition) as any,
        ctx: ctx_character_slot({
          hovered: is_non_tool_in_tool_slot ? false : is_hovered,
          highlighted: is_highlighted,
          selected: is_non_tool_in_tool_slot ? false : is_open,
          tool_mismatch: is_non_tool_in_tool_slot,
        }),
      });
    } else {
      rq.push({
        pass: 'ui',
        x,
        y,
        order: 0,
        key: `slot:${slot.body_slot}:${slot.slot_type}:${slot.garb_index ?? 'x'}`,
        payload: make_slot_payload({
          id: `slot:${slot.body_slot}:${slot.slot_type}:${slot.garb_index ?? 'x'}`,
          slot_type: slot.slot_type,
          is_placeholder: slot.is_placeholder,
        }) as any,
        ctx: ctx_character_slot({ hovered: is_hovered, highlighted: is_highlighted }),
      });
    }
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: () => opts.get_actor_name(),
    gizmos: opts.gizmos,
    is_visible: opts.get_is_visible,
    background: { rgb: opts.bg_rgb ?? { r: 20, g: 20, b: 20 } },
    border: {
      style: PANEL_BORDER_PRESETS.default_double.style,
      border_rgb: opts.border_rgb ?? { r: 150, g: 150, b: 150 },
      weight_index: PANEL_BORDER_PRESETS.default_double.weight_index,
      text_rgb: opts.text_rgb ?? { r: 220, g: 220, b: 220 },
      divider_at_col: 5,
      divider_mode: 'full_height',
      reserve_left_cols: 2 + ((opts.gizmos?.enabled?.length ?? 0) * 2),
    },
    resize: opts.gizmos ? {
      min_width: 30,
      min_height: 16,
      max_width: 160,
      max_height: 80,
    } : undefined,
    draw_content(c: Canvas, next_rect: Rect): void {
      rect = next_rect;
      const actor_name = opts.get_actor_name();
      const body_slots = opts.get_body_slots();
      const equipped = opts.get_equipped_items();
      const tags = opts.get_tags?.() ?? [];
      const selected_tag_key = opts.get_selected_tag_key?.() ?? null;
      const weight = opts.get_weight_data();
      const now_ms = Date.now();
      const rq: RenderRequest[] = [];

      void actor_name;
      
      // Draw container sidebar
      sidebar_boxes = [];
      if (opts.get_equipped_containers) {
        const equipped_containers = opts.get_equipped_containers();
        const default_container_id = opts.get_default_container_id?.() ?? null;
        const box_width = 3;
        const box_height = 3;
        const gap = 1;
        const sidebar_x = rect.x0 + 1;
        let sidebar_y = rect.y1 - 3 - box_height;
        
        for (let i = 0; i < equipped_containers.length && sidebar_y >= rect.y0 + 2; i++) {
          const container_info = equipped_containers[i];
          if (container_info?.container_id) {
            const is_open = opts.get_open_containers?.().has(container_info.container_id) || false;
            const is_default = default_container_id === container_info.container_id;

            const shaded = resolve_cell(
              make_item_payload(container_info.item_instance, container_info.item_definition),
              {
                ...ctx_container_ui({ default_container: is_default, selected: is_open }),
                x: sidebar_x + 1,
                y: sidebar_y + 1,
                time_ms: Date.now(),
              },
            );

            const border_color: Rgb = is_default
              ? { r: 255, g: 255, b: 100 }
              : { r: 100, g: 100, b: 100 };
            
            draw_container_box(
              c,
              { x0: sidebar_x, y0: sidebar_y, x1: sidebar_x + box_width - 1, y1: sidebar_y + box_height - 1 },
              shaded.char,
              shaded.rgb,
              border_color,
              3
            );

            // draw_container_box can't accept per-center weight/style yet; enforce shaded cell at center.
            c.set(sidebar_x + 1, sidebar_y + 1, {
              char: shaded.char,
              rgb: shaded.rgb,
              style: shaded.style,
              weight_index: shaded.weight_index,
            });
            
            // Hitbox covers the full sidebar width so clicks are forgiving.
            sidebar_boxes.push({
              x0: rect.x0 + 1,
              y0: sidebar_y,
              x1: rect.x0 + SIDEBAR_WIDTH - 1,
              y1: sidebar_y + box_height - 1,
              container_id: container_info.container_id
            });
            
            sidebar_y -= (box_height + gap);
          }
        }
      }

      const tag_area_x = rect.x0 + SIDEBAR_WIDTH + 1;
      const tag_area_width = Math.max(1, rect.x1 - tag_area_x);
      const visible_tags = tags.slice(0, Math.max(0, CHARACTER_MODULE_TAG_ROWS - 1));
      for (let i = 0; i < CHARACTER_MODULE_TAG_ROWS; i += 1) {
        const row_y = rect.y0 + 2 + i;
        const tag = visible_tags[i] ?? null;
        const is_add = i === visible_tags.length;
        let text = "";
        let rgb = get_color_by_name("medium_gray").rgb;
        let weight_index = 1;
        if (tag) {
          const key = tag_key(tag as any);
          const selected = key === selected_tag_key;
          text = `${selected ? ">" : " "}${String(tag.name ?? "")} ${Math.max(0, Math.floor(Number((tag as any).mag ?? 0) || 0))}`;
          rgb = selected ? get_color_by_name("vivid_yellow").rgb : get_color_by_name("off_white").rgb;
          weight_index = selected ? 3 : 2;
        } else if (is_add) {
          text = "+ add tag";
          rgb = get_color_by_name("vivid_green").rgb;
          weight_index = 2;
        } else {
          text = ".";
        }
        const clipped = text.slice(0, tag_area_width - 1);
        for (let j = 0; j < clipped.length; j += 1) {
          c.set(tag_area_x + j, row_y, {
            char: clipped[j]!,
            rgb,
            style: "regular",
            weight_index,
          });
        }
      }

      // Draw weight bar
      const weight_y = rect.y0 + 1;
      const weight_pct = weight.max > 0 ? weight.current / weight.max : 0;
      const bar_width = rect.x1 - rect.x0 - SIDEBAR_WIDTH - 4;
      const filled_width = Math.floor(bar_width * Math.min(weight_pct, 1));
      
      let weight_color: Rgb;
      if (weight_pct < 0.5) weight_color = { r: 100, g: 200, b: 100 };
      else if (weight_pct < 0.75) weight_color = { r: 200, g: 200, b: 100 };
      else weight_color = { r: 200, g: 100, b: 100 };
      
      const bar_x = rect.x0 + SIDEBAR_WIDTH + 2;
      for (let i = 0; i < bar_width; i++) {
        const char = i < filled_width ? "=" : "-";
        c.set(bar_x + i, weight_y, { 
          char, 
          rgb: i < filled_width ? weight_color : { r: 60, g: 60, b: 60 }, 
          style: "regular", 
          weight_index: 1 
        });
      }
      
      const weight_text = `${Math.floor(weight.current)}/${Math.floor(weight.max)}`;
      const content_center = rect.x0 + SIDEBAR_WIDTH + Math.floor((rect.x1 - rect.x0 - SIDEBAR_WIDTH + 1) / 2);
      const text_x = content_center - Math.floor(weight_text.length / 2);
      for (let i = 0; i < weight_text.length; i++) {
        c.set(text_x + i, weight_y - 1, { 
          char: weight_text.charAt(i), 
          rgb: weight_color, 
          style: "regular", 
          weight_index: 2 
        });
      }
      
      // Resolve and draw body slots
      const available_width = rect.x1 - rect.x0 - SIDEBAR_WIDTH;
      const content_start_x = rect.x0 + SIDEBAR_WIDTH;
      const content_width = available_width;
      
      // Resolve all slots
      resolved_slots_cache = resolve_all_body_slots(body_slots);
      
      // Layout positions for body parts (matching original layout)
      const body_part_positions: Record<string, { col: number; row: number }> = {
        head: { col: 0.5, row: 0 },
        hand_left: { col: 0, row: 1 },
        hand_right: { col: 1, row: 1 },
        torso: { col: 0.5, row: 2 },
        leg_left: { col: 0, row: 3 },
        leg_right: { col: 1, row: 3 },
      };
      
      const col_width = Math.floor(content_width / 2);
      const row_height = 3; // Space for slot + label + padding
      const start_y = rect.y1 - 6; // Start above weight bar
      
      // Get highlighted slots
      const highlighted = opts.get_highlighted_slots?.() ?? [];
      
      // Draw each body part's slot group
      resolved_slots_cache.forEach((slots, slot_name) => {
        const position = body_part_positions[slot_name];
        if (!position) return;
        
        // Calculate base position for this body part
        const base_x = content_start_x + Math.floor(position.col * col_width) + Math.floor(col_width / 2);
        const base_y = start_y - Math.floor(position.row * row_height);
        
        // Center the slot group horizontally
        const group_width = slots.length * (DEFAULT_SLOT_LAYOUT.cell_width + DEFAULT_SLOT_LAYOUT.gap) - DEFAULT_SLOT_LAYOUT.gap;
        const group_start_x = base_x - Math.floor(group_width / 2);
        
        // Draw each slot in the group
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          if (!slot) continue;
          
          // Calculate screen position with pan offset
          slot.screen_x = group_start_x + Math.floor(DEFAULT_SLOT_LAYOUT.cell_width / 2) + i * (DEFAULT_SLOT_LAYOUT.cell_width + DEFAULT_SLOT_LAYOUT.gap) + pan_offset.x;
          slot.screen_y = base_y + pan_offset.y;
          
          // Get equipped item for this slot
          let equipped_item: { instance: ItemInstance; definition: ItemDefinition } | undefined;
          if (slot.item_id) {
            // Find the item by instance ID
            equipped_item = Array.from(equipped.values()).find(item => item.instance.id === slot.item_id);
          }
          
          // Check if highlighted
          const is_highlighted = highlighted.some(h => 
            h.slot_name === slot.body_slot && 
            h.slot_type === slot.slot_type &&
            (h.garb_index === undefined || h.garb_index === slot.garb_index)
          );
          
          // Check if hovered
          const is_hovered = hover_slot?.body_slot === slot.body_slot &&
                            hover_slot?.slot_type === slot.slot_type &&
                            hover_slot?.garb_index === slot.garb_index;
          
          // Draw the slot
          draw_equipment_slot(rq, slot, equipped_item, is_hovered, is_highlighted);
        }
        
        // Draw body part label below the slot group
        const label_map: Record<string, string> = {
          head: "HEAD",
          torso: "TORSO",
          hand_left: "L.HAND",
          hand_right: "R.HAND",
          leg_left: "L.LEG",
          leg_right: "R.LEG",
        };
        const label = label_map[slot_name] || slot_name.slice(0, 6).toUpperCase();
        const label_x = base_x - Math.floor(label.length / 2) + pan_offset.x;
        const label_y = base_y + 2 + pan_offset.y;
        
        // Check if any slot in this group is hovered
        const group_hovered = slots.some(s => 
          hover_slot?.body_slot === s.body_slot &&
          hover_slot?.slot_type === s.slot_type &&
          hover_slot?.garb_index === s.garb_index
        );
        
        const label_rgb = group_hovered ? { r: 255, g: 255, b: 100 } : { r: 150, g: 150, b: 150 };
        
        // Clip labels to content bounds
        const bounds = get_content_bounds();
        for (let i = 0; i < label.length; i++) {
          const px = label_x + i;
          const py = label_y;
          if (px >= bounds.left && px <= bounds.right && py >= bounds.top && py <= bounds.bottom) {
            c.set(px, py, {
              char: label.charAt(i),
              rgb: label_rgb,
              style: "regular",
              weight_index: group_hovered ? 2 : 1,
            });
          }
        }
      });

      // Flush equipment-slot glyphs (keeps ordering deterministic and voxel-friendly).
      draw_render_queue(c, rq, { now_ms, pass_order: ['ui', 'item'] });

    },
    on_pointer_move_content(e: PointerEvent): void {
      const new_hover = get_resolved_slot_at_position(e.x, e.y);
      
      if (
        new_hover?.body_slot !== hover_slot?.body_slot ||
        new_hover?.slot_type !== hover_slot?.slot_type ||
        new_hover?.garb_index !== hover_slot?.garb_index
      ) {
        hover_slot = new_hover;
        
        // Find equipped item
        let equipped_item: { instance: ItemInstance; definition: ItemDefinition } | null = null;
        const hover_item_id = hover_slot?.item_id;
        if (hover_item_id) {
          const equipped = opts.get_equipped_items();
          equipped_item = Array.from(equipped.values()).find(item => item.instance.id === hover_item_id) || null;
        }

        if (hover_slot) {
          debug_log(`[CharacterModule] Hover: ${hover_slot.body_slot}.${hover_slot.slot_type}${hover_slot.garb_index !== null ? `.${hover_slot.garb_index}` : ''}`);
        }
        
        opts.on_slot_hover?.(
          hover_slot?.body_slot ?? null,
          hover_slot?.slot_type ?? null,
          hover_slot?.garb_index ?? null,
          equipped_item
        );
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      // Sidebar click debugging (helps diagnose "clicking sidebar does nothing")
      try {
        if (sidebar_boxes.length > 0) {
          let min_x0 = sidebar_boxes[0]!.x0;
          let max_x1 = sidebar_boxes[0]!.x1;
          let min_y0 = sidebar_boxes[0]!.y0;
          let max_y1 = sidebar_boxes[0]!.y1;
          for (const b of sidebar_boxes) {
            if (b.x0 < min_x0) min_x0 = b.x0;
            if (b.x1 > max_x1) max_x1 = b.x1;
            if (b.y0 < min_y0) min_y0 = b.y0;
            if (b.y1 > max_y1) max_y1 = b.y1;
          }
          const in_sidebar_band = e.x >= min_x0 && e.x <= max_x1 && e.y >= min_y0 && e.y <= max_y1;
          if (in_sidebar_band) {
            debug_log(`[CharacterModule] PointerDown in sidebar band at (${e.x},${e.y}) button=${e.button} clicks=${e.click_count} boxes=${sidebar_boxes.length}`);
          }
        }
      } catch {
        // ignore
      }
      // Check sidebar clicks
      for (const box of sidebar_boxes) {
        if (e.x >= box.x0 && e.x <= box.x1 && e.y >= box.y0 && e.y <= box.y1) {
          debug_log(`[CharacterModule] Sidebar hitbox matched: ${box.container_id} @(${box.x0},${box.y0})-(${box.x1},${box.y1})`);
          if (e.button === 2) {
            debug_log(`[CharacterModule] Right-clicked sidebar container: ${box.container_id}`);
            void opts.on_open_container?.(box.container_id, 'sidebar');
          } else {
            if (e.click_count === 2) {
              debug_log(`[CharacterModule] Double-clicked sidebar container (set default): ${box.container_id}`);
              opts.on_set_default_container?.(box.container_id);
              void opts.on_open_container?.(box.container_id, 'sidebar');
            } else {
              debug_log(`[CharacterModule] Clicked sidebar container: ${box.container_id}`);
              void opts.on_container_click?.(box.container_id);
            }
          }
          return;
        }
      }

      // Extra debug: click in sidebar band but did not match a box.
      try {
        if (sidebar_boxes.length > 0) {
          let min_x0 = sidebar_boxes[0]!.x0;
          let max_x1 = sidebar_boxes[0]!.x1;
          let min_y0 = sidebar_boxes[0]!.y0;
          let max_y1 = sidebar_boxes[0]!.y1;
          for (const b of sidebar_boxes) {
            if (b.x0 < min_x0) min_x0 = b.x0;
            if (b.x1 > max_x1) max_x1 = b.x1;
            if (b.y0 < min_y0) min_y0 = b.y0;
            if (b.y1 > max_y1) max_y1 = b.y1;
          }
          const in_sidebar_band = e.x >= min_x0 && e.x <= max_x1 && e.y >= min_y0 && e.y <= max_y1;
          if (in_sidebar_band) {
            debug_log(`[CharacterModule] Sidebar click did not match any box at (${e.x},${e.y})`);
          }
        }
      } catch {
        // ignore
      }
      
      // Get clicked slot
      const slot = get_resolved_slot_at_position(e.x, e.y);
      const tag_hit = get_character_module_tag_row_at(rect, e.x, e.y, opts.get_tags?.().length ?? 0);
      if (tag_hit) {
        const tags = opts.get_tags?.() ?? [];
        if (tag_hit.kind === "add") {
          opts.on_add_tag?.();
          return;
        }
        const tag = tags[tag_hit.index] ?? null;
        if (tag) opts.on_select_tag?.(tag);
        return;
      }
      if (!slot) return;
      
      // Right-click opens container if item has container_data
      if (e.button === 2) {
        if (slot.item_id) {
          const found_item = get_equipped_item_by_id(slot.item_id);
          if (found_item) {
            const is_container = has_resolved_tag((found_item.instance as any), 'CONTAINER') || Array.isArray((found_item.definition as any)?.tags) && (found_item.definition as any).tags.some((tag: any) => String(tag?.name ?? '').trim().toUpperCase() === 'CONTAINER');
            if (is_container) {
              const container_id = get_slot_container_id(opts.get_actor_id(), slot);
              debug_log(`[CharacterModule] Right-clicked container: ${container_id}`);
              void opts.on_open_container?.(container_id, slot.body_slot);
              return;
            }
          }
        }
        return;
      }
      
      // Left-click
      debug_log(`[CharacterModule] Clicked: ${slot.body_slot}.${slot.slot_type}${slot.garb_index !== null ? `.${slot.garb_index}` : ''}`);
      if (slot.item_id) {
        const found_item = get_equipped_item_by_id(slot.item_id);
        if (found_item) {
          opts.on_select_item?.(slot.body_slot, slot.slot_type, slot.garb_index, found_item.instance, found_item.definition);
        }
      }
      opts.on_slot_click?.(slot.body_slot, slot.slot_type, slot.garb_index);
    },
    on_pointer_leave_content(): void {
      hover_slot = null;
      opts.on_slot_hover?.(null, null, null, null);
    },
    on_drag_start_content(e: DragEvent): void {
      debug_log(`[CharacterModule] OnDragStart called at (${e.start_x}, ${e.start_y})`);

      // Get the slot where drag started
      const slot = get_resolved_slot_at_position(e.start_x, e.start_y);
      debug_log(`[CharacterModule] Drag slot detection: ${slot?.body_slot}.${slot?.slot_type}`);
      
      // If no slot was clicked but we're in the body slots area, start panning
      if (!slot) {
        if (is_in_body_slots_area(e.start_x, e.start_y)) {
          is_panning = true;
          pan_start = { x: e.start_x, y: e.start_y };
          pan_start_offset = { x: pan_offset.x, y: pan_offset.y };
          debug_log(`[CharacterModule] Started panning at (${e.start_x}, ${e.start_y})`);
        } else {
          debug_log(`[CharacterModule] Drag rejected - no slot at position`);
        }
        return;
      }

      // Get equipped item
      if (!slot.item_id) {
        debug_log(`[CharacterModule] Cannot drag - slot is empty`);
        return;
      }

      const equipped_item = get_equipped_item_by_id(slot.item_id);
      
      if (!equipped_item) {
        debug_log(`[CharacterModule] Cannot find equipped item for slot`);
        return;
      }

      const container_id = get_slot_container_id(opts.get_actor_id(), slot);
      
      debug_log(`[CharacterModule] Drag started: ${equipped_item.definition.name} from ${container_id}`);

      opts.on_drag_start?.(
        slot.body_slot,
        slot.slot_type,
        slot.garb_index,
        equipped_item.instance,
        equipped_item.definition,
        container_id
      );
    },
    on_drag_move_content(e: DragEvent): void {
      // Handle panning
      if (is_panning) {
        const dx = e.x - pan_start.x;
        const dy = e.y - pan_start.y;
        
        // Calculate new offset
        let new_x = pan_start_offset.x + dx;
        let new_y = pan_start_offset.y + dy;
        
        // Apply bounds to keep content visible
        const bounds = calculate_pan_bounds();
        new_x = clamp(new_x, bounds.min_x, bounds.max_x);
        new_y = clamp(new_y, bounds.min_y, bounds.max_y);
        
        pan_offset.x = new_x;
        pan_offset.y = new_y;
        debug_log(`[CharacterModule] Panning: offset (${pan_offset.x}, ${pan_offset.y}), bounds:`, bounds);
        return;
      }

    },
    on_drag_end_content(e: DragEvent): void {
      debug_log(`[CharacterModule] OnDragEnd at (${e.x}, ${e.y})`);

      // Handle panning end
      if (is_panning) {
        is_panning = false;
        debug_log(`[CharacterModule] Panning ended at offset (${pan_offset.x}, ${pan_offset.y})`);
        return;
      }

      // Check if drop is within our rect
      const within_rect = e.x >= rect.x0 && e.x <= rect.x1 && e.y >= rect.y0 && e.y <= rect.y1;
      
      if (within_rect) {
        const target = get_drop_target_at_position(e.x, e.y);
        
        if (!target || !target.slot_name) {
          debug_log(`[CharacterModule] Drop on invalid character target at (${e.x}, ${e.y})`);
          opts.on_invalid_drop?.('Cannot drop item there');
          opts.on_drag_rejected?.();
          return;
        }

        debug_log(`[CharacterModule] Drop target: ${target.kind}:${target.container_id ?? `${target.slot_name}.${target.slot_type}`}`);

        if (opts.on_drop) {
          void opts.on_drop(target.slot_name, target.slot_type ?? 'tool', target.garb_index, target).then((success: boolean) => {
            debug_log(`[CharacterModule] Drop ${success ? 'successful' : 'failed'}`);
          });
        }
        return;
      }
      
      // Drop outside module - let parent handle
      opts.on_cross_module_drop?.(e.x, e.y);
    },
  });
}
