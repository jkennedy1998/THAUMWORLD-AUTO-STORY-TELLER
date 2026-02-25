import type { Canvas, Module, Rect, Rgb, PointerEvent, DragEvent } from "../types.js";
import type { Container } from "../../types/container.js";
import type { ItemInstance } from "../../item_instances/store.js";
import type { ItemDefinition } from "../../item_storage/store.js";
import type { BodySlots, BodySlot } from "../../types/body_slots.js";
import { debug_log } from "../../shared/debug.js";
import { draw_module_border, BORDER_STYLES, draw_horizontal_divider, draw_container_box } from "../module_borders.js";
import type { ModuleGizmosConfig, GizmoState } from "../module_gizmos.js";
import { draw_module_gizmos, handle_gizmo_click, create_gizmo_state, is_in_gizmo_area } from "../module_gizmos.js";

// Character module configuration
export type CharacterModuleConfig = {
  id: string;
  rect: Rect;
  
  // Character data
  get_actor_name: () => string;
  get_actor_id: () => string; // Full actor ID (e.g., "henry_actor")
  get_body_slots: () => BodySlots;
  get_equipped_items: () => Map<string, { instance: ItemInstance; definition: ItemDefinition }>;
  
  // Weight data
  get_weight_data: () => {
    current: number;
    max: number;
  };
  
  // Interaction
  get_is_visible: () => boolean;
  on_slot_click?: (slot_name: string) => void;
  on_drop?: (slot_name: string) => Promise<boolean>; // Returns true if drop was successful
  on_drag_start?: (slot_name: string, item: ItemInstance, definition: ItemDefinition, container_id: string) => void;
  on_cross_module_drop?: (x: number, y: number) => Promise<boolean>; // Handle drops outside the module (unequip)
  on_slot_hover?: (slot_name: string | null, equipped_item: { instance: ItemInstance; definition: ItemDefinition } | null) => void; // Report hover state for debug display
  get_highlighted_slots?: () => string[]; // Slots to highlight as compatible targets
  // Drag visualization
  on_drag_move?: (x: number, y: number) => void;
  render_drag_ghost?: (c: Canvas) => void;
  on_drag_rejected?: () => void;

  // Styling
  border_rgb?: Rgb;
  bg_rgb?: Rgb;
  text_rgb?: Rgb;
  
  // Phase 8: Module Gizmos (close X, move #)
  gizmos?: ModuleGizmosConfig;
  
  // Container sidebar: Equipped containers only (items in body slots that are container types)
  get_equipped_containers?: () => Array<{
    slot_name: string;
    item_instance: ItemInstance;
    item_definition: ItemDefinition;
    container_id: string;
  }>;
  on_container_click?: (container_id: string) => void;
  
  // Phase 7: Right-click container opening
  on_open_container?: (container_id: string, slot_name: string) => Promise<void>;
  get_open_containers?: () => Set<string>; // Returns set of open container IDs
};

export function make_character_module(opts: CharacterModuleConfig): Module {
  // Phase 8: Use mutable rect for moving
  let rect = opts.rect;
  let hover_slot_name: string | null = null;
  let last_logged_actor: string | null = null;
  
  // Phase 8: Gizmo state
  const gizmo_state: GizmoState = create_gizmo_state();
  
  // Layout constants
  const SIDEBAR_WIDTH = 5;  // Width of container sidebar (divider at col 5)
  
  // Phase 7: Track sidebar container boxes for click detection
  let sidebar_boxes: Array<{ x0: number; y0: number; x1: number; y1: number; container_id: string }> = [];

  debug_log("[CharacterModule] Created module:", opts.id);

  function get_slot_at_position(x: number, y: number): string | null {
    if (!opts.get_is_visible()) return null;
    
    const body_slots = opts.get_body_slots();
    const slot_names = Object.keys(body_slots);
    
    // Layout with horizontal hand sub-slots:
    // Row 0: HEAD (centered)
    // Row 1: LEFT HAND (- -) | RIGHT HAND (- -)  [tool | equipment side by side]
    // Row 2: TORSO (centered)
    // Row 3: LEFT LEG | RIGHT LEG
    
    // Available width excludes sidebar
    const available_width = rect.x1 - rect.x0 - SIDEBAR_WIDTH;
    const col_width = Math.floor(available_width / 2);
    const start_y = rect.y1 - 4;
    const content_start_x = rect.x0 + SIDEBAR_WIDTH;
    
    // Check each slot position - MUST MATCH draw loop
    const check_slot = (slot_name: string, col: number, row: number, x_offset: number = 0) => {
      const slot_x = content_start_x + Math.floor(col * col_width) + Math.floor(col_width / 2) + x_offset;
      const slot_y = start_y - Math.floor(row * 2);
      // Item is drawn at (slot_x, slot_y) in draw_body_slot
      if (x === slot_x && y === slot_y) {
        return slot_name;
      }
      return null;
    };
    
    // Check all slots (using lowercase_snake_case for internal naming)
    let result = check_slot("head", 0.5, 0);
    if (result) return result;
    
    // LEFT HAND - two sub-slots side by side (x_offset: -1 and +1)
    result = check_slot("hand_left", 0, 1, -1); // tool slot
    if (result) return result;
    
    result = check_slot("hand_left", 0, 1, 1); // equipment slot
    if (result) return result;
    
    // RIGHT HAND - two sub-slots side by side (x_offset: -1 and +1)
    result = check_slot("hand_right", 1, 1, -1); // tool slot
    if (result) return result;
    
    result = check_slot("hand_right", 1, 1, 1); // equipment slot
    if (result) return result;
    
    result = check_slot("torso", 0.5, 2);
    if (result) return result;
    
    result = check_slot("leg_left", 0, 3);
    if (result) return result;
    
    result = check_slot("leg_right", 1, 3);
    if (result) return result;
    
    return null;
  }

  function draw_body_slot(
    c: Canvas,
    slot_name: string,
    slot: BodySlot,
    equipped_item: { instance: ItemInstance; definition: ItemDefinition } | undefined,
    x: number,
    y: number,
    is_hovered: boolean,
    slot_type: "tool" | "equipment" | "normal" = "normal",
    skip_label: boolean = false,
    is_highlighted: boolean = false
  ): void {
    const text = opts.text_rgb ?? { r: 200, g: 200, b: 200 };

    // Determine color based on slot type and highlight state
    let empty_color: { r: number; g: number; b: number };
    if (is_highlighted) {
      // Bright green for highlighted compatible slots
      empty_color = { r: 0, g: 200, b: 0 };
    } else if (slot_type === "tool") {
      // Brighter red for tool slots (was {r:80, g:0, b:0})
      empty_color = { r: 180, g: 60, b: 60 };
    } else if (slot_type === "equipment") {
      // Brighter blue for equipment slots (was {r:0, g:0, b:80})
      empty_color = { r: 60, g: 120, b: 220 };
    } else {
      // Default gray
      empty_color = { r: 60, g: 60, b: 60 };
    }

    // Draw slot label (abbreviated) - map lowercase names to display abbreviations
    // slot_name is lowercase_snake_case (e.g., "hand_left", "torso")
    let label: string;
    switch (slot_name) {
      case 'head':
        label = 'HED';
        break;
      case 'torso':
        label = 'TRSO';
        break;
      case 'hand_left':
        label = 'LHA';
        break;
      case 'hand_right':
        label = 'RHA';
        break;
      case 'leg_left':
        label = 'LLEG';
        break;
      case 'leg_right':
        label = 'RLEG';
        break;
      default:
        label = slot_name.slice(0, 4).toUpperCase();
    }

    // Label color: bright green if highlighted, white normally, yellow if hovered
    let label_rgb: { r: number; g: number; b: number };
    if (is_highlighted) {
      label_rgb = { r: 0, g: 255, b: 100 };
    } else if (is_hovered) {
      label_rgb = { r: 255, g: 255, b: 100 };
    } else {
      label_rgb = { r: 150, g: 150, b: 150 };
    }

    // Draw label BELOW the item slot (y=0 is bottom, so y+1 is visually below)
    // Skip label for hand sub-slots (drawn separately)
    if (!skip_label) {
      for (let i = 0; i < label.length && i < 3; i++) {
        const char = label.charAt(i);
        c.set(x + i, y + 1, {
          char,
          rgb: label_rgb,
          style: "regular",
          weight_index: is_hovered || is_highlighted ? 5 : 3
        });
      }
    }

    // Phase 7: Determine display character color with container state
    let char_rgb: { r: number; g: number; b: number };
    
    // Check if equipped item is a container
    const is_container = equipped_item?.definition.tags?.some(tag => 
      ['CONTAINER', 'BAG', 'SACK', 'POUCH', 'BACKPACK', 'WALLET', 'CHEST', 'BOX'].includes(tag.name.toUpperCase())
    );
    
    // Check if this container is currently open
    const container_id = equipped_item ? `container.${opts.get_actor_id()}.${slot_name}` : null;
    const is_open = container_id && opts.get_open_containers ? opts.get_open_containers().has(container_id) : false;
    
    // Apply color priority: Hovered > Open (purple) > Container (orange) > Normal
    if (is_hovered) {
      char_rgb = { r: 255, g: 255, b: 100 }; // Yellow hover
    } else if (is_open) {
      char_rgb = { r: 180, g: 100, b: 220 }; // Purple - container is open
    } else if (is_container) {
      char_rgb = { r: 255, g: 165, b: 0 }; // Orange - is a container
    } else if (is_highlighted) {
      char_rgb = { r: 0, g: 255, b: 100 }; // Green highlight
    } else {
      char_rgb = text; // Normal text color
    }

    // Draw item or empty indicator at the slot position (this is what gets hovered)
    if (equipped_item) {
      const char = equipped_item.definition.display_char ||
                   equipped_item.definition.name?.charAt(0).toLowerCase() ||
                   "?";

      c.set(x, y, {
        char,
        rgb: char_rgb,
        style: "regular",
        weight_index: is_hovered || is_highlighted ? 6 : 5
      });

      if (is_hovered) {
        debug_log(`[CharacterModule] Hovered ${slot_name}: ${equipped_item.definition.name}`);
      }
    } else {
      // Empty slot with type-specific color
      c.set(x, y, {
        char: "-",
        rgb: empty_color,
        style: "regular",
        weight_index: 2
      });
    }
  }

  return {
    id: opts.id,
    get rect() { return rect; },  // Phase 8: Use getter for mutable rect
    Focusable: true,

    Draw(c: Canvas): void {
      if (!opts.get_is_visible()) {
        return;
      }

      const actor_name = opts.get_actor_name();
      const body_slots = opts.get_body_slots();
      const equipped = opts.get_equipped_items();
      const weight = opts.get_weight_data();
      
      // Debug logging - only log when character changes (module opened/updated)
      if (actor_name !== last_logged_actor) {
        debug_log(`[CharacterModule] Drawing character: ${actor_name}`);
        debug_log(`[CharacterModule] Body slots: ${Object.keys(body_slots).length}`);
        debug_log(`[CharacterModule] Equipped items: ${equipped.size}`);
        const available_slots = Object.keys(body_slots);
        if (available_slots.length > 0) {
          debug_log(`[CharacterModule] Drawing ${available_slots.length} body slots:`, available_slots.join(", "));
        }
        last_logged_actor = actor_name;
      }
      
      // Phase 1 & 2: Draw border with header
      draw_module_border(c, {
        rect,
        style: BORDER_STYLES.double,
        border_rgb: opts.border_rgb ?? { r: 150, g: 150, b: 150 },
        bg_rgb: opts.bg_rgb ?? { r: 20, g: 20, b: 20 },
        weight_index: 3,
        header: {
          text: actor_name,
          text_rgb: opts.text_rgb ?? { r: 220, g: 220, b: 220 },
          divider_at_col: 5, // Divider after gizmo area (X # + padding)
        }
      });
      
      // Phase 8: Draw gizmos (close X, move #)
      if (opts.gizmos) {
        draw_module_gizmos(c, rect, opts.gizmos, gizmo_state);
      }
      
      // Draw container sidebar (equipped containers only)
      sidebar_boxes = []; // Reset tracked boxes
      if (opts.get_equipped_containers) {
        const equipped_containers = opts.get_equipped_containers();
        const box_width = 3;
        const box_height = 3;
        const gap = 1;
        const sidebar_x = rect.x0 + 1;
        let sidebar_y = rect.y1 - 3 - box_height; // Start from bottom and work up
        
        for (let i = 0; i < equipped_containers.length && sidebar_y >= rect.y0 + 2; i++) {
          const container_info = equipped_containers[i];
          if (container_info && container_info.container_id) {
            // Get display char from item definition, fallback to 'C'
            const display_char = container_info.item_definition.display_char || "C";
            
            // Phase 7: Check if container is open for purple color
            const is_open = opts.get_open_containers?.().has(container_info.container_id) || false;
            // Orange for containers, Purple if open
            const container_color: Rgb = is_open 
              ? { r: 180, g: 100, b: 220 } // Purple - open
              : { r: 255, g: 165, b: 0 };   // Orange - container
            
            // Draw 3x3 box for this equipped container
            draw_container_box(
              c,
              { x0: sidebar_x, y0: sidebar_y, x1: sidebar_x + box_width - 1, y1: sidebar_y + box_height - 1 },
              display_char,
              container_color,
              { r: 100, g: 100, b: 100 }, // Gray border
              3
            );
            
            // Track this box for click detection
            sidebar_boxes.push({
              x0: sidebar_x,
              y0: sidebar_y,
              x1: sidebar_x + box_width - 1,
              y1: sidebar_y + box_height - 1,
              container_id: container_info.container_id
            });
            
            sidebar_y -= (box_height + gap);
          }
        }
      }
      
      // Draw weight bar at bottom
      const weight_y = rect.y0 + 1;
      const weight_pct = weight.max > 0 ? weight.current / weight.max : 0;
      // Account for sidebar in bar width
      const bar_width = rect.x1 - rect.x0 - SIDEBAR_WIDTH - 4;
      const filled_width = Math.floor(bar_width * Math.min(weight_pct, 1));
      
      // Weight bar color based on load
      let weight_color: Rgb;
      if (weight_pct < 0.5) weight_color = { r: 100, g: 200, b: 100 }; // Green
      else if (weight_pct < 0.75) weight_color = { r: 200, g: 200, b: 100 }; // Yellow
      else weight_color = { r: 200, g: 100, b: 100 }; // Red
      
      const bar_x = rect.x0 + SIDEBAR_WIDTH + 2;
      for (let i = 0; i < bar_width; i++) {
        const char = i < filled_width ? "=" : "-";
        c.set(bar_x + i, weight_y, { 
          char, 
          rgb: i < filled_width ? weight_color : { r: 60, g: 60, b: 60 }, 
          style: "regular", 
          weight_index: 3 
        });
      }
      
      // Draw weight text (centered in content area)
      const weight_text = `${Math.floor(weight.current)}/${Math.floor(weight.max)}`;
      const content_center = rect.x0 + SIDEBAR_WIDTH + Math.floor((rect.x1 - rect.x0 - SIDEBAR_WIDTH + 1) / 2);
      const text_x = content_center - Math.floor(weight_text.length / 2);
      for (let i = 0; i < weight_text.length; i++) {
        const char = weight_text.charAt(i);
        c.set(text_x + i, weight_y - 1, { 
          char, 
          rgb: weight_color, 
          style: "regular", 
          weight_index: 4 
        });
      }
      
      // Draw body slots
      // Available width excludes sidebar
      const available_width = rect.x1 - rect.x0 - SIDEBAR_WIDTH;
      const col_width = Math.floor(available_width / 2);
      const start_y = rect.y1 - 4;
      const content_start_x = rect.x0 + SIDEBAR_WIDTH;
      
      // Track hover state for hand slots (both sub-slots share one label)
      const left_hand_hovered = hover_slot_name === "hand_left";
      const right_hand_hovered = hover_slot_name === "hand_right";

      // Get highlighted slots (compatible targets for hovered item)
      const highlighted_slots = opts.get_highlighted_slots?.() ?? [];

      // Layout for normal slots (not hands) - using lowercase_snake_case
      const normal_slots = [
        { name: "head", col: 0.5, row: 0, type: "normal" as const },
        { name: "torso", col: 0.5, row: 2, type: "normal" as const },
        { name: "leg_left", col: 0, row: 3, type: "normal" as const },
        { name: "leg_right", col: 1, row: 3, type: "normal" as const },
      ];

      let drawn_count = 0;

      // Draw normal slots
      for (const layout of normal_slots) {
        const slot = body_slots[layout.name];
        if (slot) {
          const slot_x = content_start_x + Math.floor(layout.col * col_width) + Math.floor(col_width / 2);
          const slot_y = start_y - Math.floor(layout.row * 2);
          const equipped_item = equipped.get(layout.name);
          const is_hovered = layout.name === hover_slot_name;
          const is_highlighted = highlighted_slots.includes(layout.name);

          draw_body_slot(c, layout.name, slot, equipped_item, slot_x, slot_y, is_hovered, layout.type, false, is_highlighted);
          drawn_count++;
        }
      }

      // Draw LEFT HAND with two sub-slots side by side
      const left_hand_slot = body_slots["hand_left"];
      if (left_hand_slot) {
        const hand_center_x = content_start_x + Math.floor(0 * col_width) + Math.floor(col_width / 2);
        const hand_y = start_y - Math.floor(1 * 2); // Row 1
        const equipped_item = equipped.get("hand_left");
        const is_highlighted = highlighted_slots.includes("hand_left");

        // Tool slot (left, dark red)
        draw_body_slot(c, "hand_left", left_hand_slot, equipped_item, hand_center_x - 1, hand_y, left_hand_hovered, "tool", true, is_highlighted);
        // Equipment slot (right, dark blue)
        draw_body_slot(c, "hand_left", left_hand_slot, equipped_item, hand_center_x + 1, hand_y, left_hand_hovered, "equipment", true, is_highlighted);

        // LEFT HAND label below - bright green if highlighted
        const left_label = "LHA";
        let left_label_rgb: { r: number; g: number; b: number };
        if (is_highlighted) {
          left_label_rgb = { r: 0, g: 255, b: 100 };
        } else if (left_hand_hovered) {
          left_label_rgb = { r: 255, g: 255, b: 100 };
        } else {
          left_label_rgb = { r: 150, g: 150, b: 150 };
        }
        for (let i = 0; i < left_label.length; i++) {
          c.set(hand_center_x + i - 1, hand_y + 1, {
            char: left_label.charAt(i),
            rgb: left_label_rgb,
            style: "regular",
            weight_index: left_hand_hovered || is_highlighted ? 5 : 3
          });
        }
        drawn_count++;
      }

      // Draw RIGHT HAND with two sub-slots side by side
      const right_hand_slot = body_slots["hand_right"];
      if (right_hand_slot) {
        const hand_center_x = content_start_x + Math.floor(1 * col_width) + Math.floor(col_width / 2);
        const hand_y = start_y - Math.floor(1 * 2); // Row 1
        const equipped_item = equipped.get("hand_right");
        const is_highlighted = highlighted_slots.includes("hand_right");

        // Tool slot (left, dark red)
        draw_body_slot(c, "hand_right", right_hand_slot, equipped_item, hand_center_x - 1, hand_y, right_hand_hovered, "tool", true, is_highlighted);
        // Equipment slot (right, dark blue)
        draw_body_slot(c, "hand_right", right_hand_slot, equipped_item, hand_center_x + 1, hand_y, right_hand_hovered, "equipment", true, is_highlighted);

        // RIGHT HAND label below - bright green if highlighted
        const right_label = "RHA";
        let right_label_rgb: { r: number; g: number; b: number };
        if (is_highlighted) {
          right_label_rgb = { r: 0, g: 255, b: 100 };
        } else if (right_hand_hovered) {
          right_label_rgb = { r: 255, g: 255, b: 100 };
        } else {
          right_label_rgb = { r: 150, g: 150, b: 150 };
        }
        for (let i = 0; i < right_label.length; i++) {
          c.set(hand_center_x + i - 1, hand_y + 1, {
            char: right_label.charAt(i),
            rgb: right_label_rgb,
            style: "regular",
            weight_index: right_hand_hovered || is_highlighted ? 5 : 3
          });
        }
        drawn_count++;
      }
      
      if (drawn_count === 0) {
        const available = Object.keys(body_slots);
        debug_log(`[CharacterModule] WARNING: No body slots drawn! Available:`, available);
      }
      
      // Render drag ghost if active
      opts.render_drag_ghost?.(c);
    },

    OnPointerMove(e: PointerEvent): void {
      if (!opts.get_is_visible()) return;
      
      const new_hover = get_slot_at_position(e.x, e.y);
      if (new_hover !== hover_slot_name) {
        hover_slot_name = new_hover;
        const equipped_items = opts.get_equipped_items();
        const equipped_item = hover_slot_name ? equipped_items.get(hover_slot_name) : null;
        
        if (hover_slot_name) {
          debug_log(`[CharacterModule] Hover: ${hover_slot_name}`);
          if (equipped_item) {
            debug_log(`[CharacterModule] Hovered ${hover_slot_name}: ${equipped_item.definition.name}`);
          }
        }
        
        // Report hover to parent for debug display
        opts.on_slot_hover?.(hover_slot_name, equipped_item || null);
      }
    },

    OnPointerDown(e: PointerEvent): void {
      if (!opts.get_is_visible()) return;
      
      // Phase 8: Check for gizmo clicks first
      if (opts.gizmos && is_in_gizmo_area(e.x, e.y, rect)) {
        const clicked_gizmo = handle_gizmo_click(e.x, e.y, rect, opts.gizmos, gizmo_state);
        if (clicked_gizmo) {
          debug_log(`[CharacterModule] Gizmo clicked: ${clicked_gizmo}`);
          return;  // Don't process slot clicks if gizmo was clicked
        }
      }
      
      // Phase 7: Check for sidebar container box clicks (right or left)
      for (const box of sidebar_boxes) {
        if (e.x >= box.x0 && e.x <= box.x1 && e.y >= box.y0 && e.y <= box.y1) {
          if (e.button === 2) {
            // Right-click opens container
            debug_log(`[CharacterModule] Right-clicked sidebar container: ${box.container_id}`);
            void opts.on_open_container?.(box.container_id, 'sidebar');
          } else {
            // Left-click also opens container (for convenience)
            debug_log(`[CharacterModule] Clicked sidebar container: ${box.container_id}`);
            void opts.on_container_click?.(box.container_id);
          }
          return;
        }
      }
      
      const slot_name = get_slot_at_position(e.x, e.y);
      if (!slot_name) return;
      
      // Phase 7: Right-click (button 2) opens container
      if (e.button === 2) {
        const equipped = opts.get_equipped_items().get(slot_name);
        if (equipped) {
          // Check if equipped item has container_data (nested container)
          if (equipped.instance.container_data) {
            // Item has container_data - open the item's internal container
            const nested_container_id = `item.${equipped.instance.id}`;
            debug_log(`[CharacterModule] Right-clicked nested container item: ${equipped.definition.name} (ID: ${nested_container_id})`);
            void opts.on_open_container?.(nested_container_id, slot_name);
          } else if (equipped.definition.tags?.some(tag => 
            ['CONTAINER', 'BAG', 'SACK', 'POUCH', 'BACKPACK', 'WALLET', 'CHEST', 'BOX'].includes(tag.name.toUpperCase())
          )) {
            // Legacy: Item is tagged as container but doesn't have container_data yet
            const container_id = `container.${opts.get_actor_id()}.${slot_name}`;
            debug_log(`[CharacterModule] Right-clicked container: ${container_id}`);
            void opts.on_open_container?.(container_id, slot_name);
          } else {
            debug_log(`[CharacterModule] Right-clicked non-container item: ${equipped.definition.name}`);
            // Future: Show context menu for non-container items
          }
        }
        return;
      }
      
      // Left-click (button 0)
      debug_log(`[CharacterModule] Clicked: ${slot_name}`);
      opts.on_slot_click?.(slot_name);
    },

    OnPointerLeave(): void {
      hover_slot_name = null;
      opts.on_slot_hover?.(null, null);
    },

    OnDragStart(e: DragEvent): void {
      debug_log(`[CharacterModule] OnDragStart called at (${e.start_x}, ${e.start_y}), visible=${opts.get_is_visible()}`);
      
      if (!opts.get_is_visible()) {
        debug_log(`[CharacterModule] Drag rejected - module not visible`);
        return;
      }

      // Phase 8: Handle move mode drag start
      if (gizmo_state.is_move_mode) {
        debug_log(`[CharacterModule] Move mode drag started at (${e.start_x}, ${e.start_y})`);
        gizmo_state.move_start_x = e.start_x;
        gizmo_state.move_start_y = e.start_y;
        if (opts.gizmos?.on_move_start) {
          opts.gizmos.on_move_start();
        }
        return;
      }

      // Get the slot where drag started
      const slot_name = get_slot_at_position(e.start_x, e.start_y);
      debug_log(`[CharacterModule] Drag slot detection: slot_name=${slot_name}`);
      
      if (!slot_name) {
        debug_log(`[CharacterModule] Drag rejected - no slot at position`);
        return;
      }

      // Get equipped item from this slot
      const equipped_items = opts.get_equipped_items();
      const equipped_item = equipped_items.get(slot_name);
      
      if (!equipped_item) {
        debug_log(`[CharacterModule] Cannot drag - slot ${slot_name} is empty`);
        return;
      }

      // Build container ID for this body slot
      const container_id = `container.${opts.get_actor_id()}.${slot_name}`;
      
      debug_log(`[CharacterModule] Drag started on slot ${slot_name}: ${equipped_item.definition.name} (container=${container_id})`);

      // Notify parent via callback
      opts.on_drag_start?.(slot_name, equipped_item.instance, equipped_item.definition, container_id);
      debug_log(`[CharacterModule] Drag start callback executed`);
    },

    OnDragMove(e: DragEvent): void {
      // Phase 8: Handle move mode dragging
      if (gizmo_state.is_move_mode && gizmo_state.original_rect) {
        const dx = e.x - gizmo_state.move_start_x;
        const dy = e.y - gizmo_state.move_start_y;
        
        const new_rect: Rect = {
          x0: gizmo_state.original_rect.x0 + dx,
          y0: gizmo_state.original_rect.y0 + dy,
          x1: gizmo_state.original_rect.x1 + dx,
          y1: gizmo_state.original_rect.y1 + dy,
        };
        
        // Actually update the module's rect so it moves
        rect = new_rect;
        
        debug_log(`[CharacterModule] Move mode: delta (${dx}, ${dy}), new rect at (${rect.x0},${rect.y0})`);
        
        if (opts.gizmos?.on_move) {
          opts.gizmos.on_move(new_rect);
        }
        return;
      }
      
      // Normal drag move - can be used for panning body slot area in future
      if (opts.on_drag_move) {
        opts.on_drag_move(e.x, e.y);
      }
      debug_log(`[CharacterModule] OnDragMove at (${e.x}, ${e.y})`);
    },

    OnDragEnd(e: DragEvent): void {
      debug_log(`[CharacterModule] OnDragEnd called at (${e.x}, ${e.y}), visible=${opts.get_is_visible()}`);
      
      if (!opts.get_is_visible()) {
        debug_log(`[CharacterModule] DragEnd rejected - module not visible`);
        return;
      }

      // Phase 8: Handle move mode drag end
      if (gizmo_state.is_move_mode && gizmo_state.original_rect) {
        const dx = e.x - gizmo_state.move_start_x;
        const dy = e.y - gizmo_state.move_start_y;
        
        const final_rect: Rect = {
          x0: gizmo_state.original_rect.x0 + dx,
          y0: gizmo_state.original_rect.y0 + dy,
          x1: gizmo_state.original_rect.x1 + dx,
          y1: gizmo_state.original_rect.y1 + dy,
        };
        
        // Update the module's rect to the final position
        rect = final_rect;
        
        debug_log(`[CharacterModule] Move mode ended: final rect at (${rect.x0},${rect.y0})`);
        
        if (opts.gizmos?.on_move_end) {
          opts.gizmos.on_move_end(final_rect);
        }
        
        // Stay in move mode until user clicks # again
        return;
      }

      // Check if drop is within our rect
      const within_rect = e.x >= rect.x0 && e.x <= rect.x1 && e.y >= rect.y0 && e.y <= rect.y1;
      debug_log(`[CharacterModule] Drop within rect: ${within_rect}`);
      
      if (within_rect) {
        // Drop within character module - handle equip to body slot
        const slot_name = get_slot_at_position(e.x, e.y);
        debug_log(`[CharacterModule] Drop slot detection: slot_name=${slot_name}`);
        
        if (!slot_name) {
          debug_log(`[CharacterModule] Drop occurred outside any slot at (${e.x}, ${e.y})`);
          // Drop inside module but not on valid slot - reject the drag
          if (opts.on_drag_rejected) {
            opts.on_drag_rejected();
          }
          return;
        }

        debug_log(`[CharacterModule] Drop on slot: ${slot_name}`);
        debug_log(`[CharacterModule] on_drop callback exists: ${!!opts.on_drop}`);

        // Notify parent via callback - it will handle the transfer
        if (opts.on_drop) {
          debug_log(`[CharacterModule] Calling on_drop for slot: ${slot_name}`);
          void opts.on_drop(slot_name).then((success: boolean) => {
            debug_log(`[CharacterModule] Drop ${success ? 'successful' : 'failed'} on ${slot_name}`);
          });
        } else {
          debug_log(`[CharacterModule] No on_drop callback defined`);
        }
        return;
      }

      // Drop outside character module - this is a cross-module drop (unequip)
      debug_log(`[CharacterModule] Cross-module drop detected at (${e.x}, ${e.y})`);
      debug_log(`[CharacterModule] on_cross_module_drop callback exists: ${!!opts.on_cross_module_drop}`);
      
      if (opts.on_cross_module_drop) {
        debug_log(`[CharacterModule] Calling on_cross_module_drop...`);
        void opts.on_cross_module_drop(e.x, e.y).then((success: boolean) => {
          debug_log(`[CharacterModule] Cross-module drop result: ${success ? 'success' : 'failed'}`);
        });
      } else {
        debug_log(`[CharacterModule] No on_cross_module_drop callback defined`);
      }
    },
  };
}
