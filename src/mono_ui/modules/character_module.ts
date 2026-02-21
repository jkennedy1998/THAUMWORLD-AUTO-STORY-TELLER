import type { Canvas, Module, Rect, Rgb, PointerEvent, DragEvent } from "../types.js";
import type { Container } from "../../types/container.js";
import type { ItemInstance } from "../../item_instances/store.js";
import type { ItemDefinition } from "../../item_storage/store.js";
import type { BodySlots, BodySlot } from "../../types/body_slots.js";
import { debug_log } from "../../shared/debug.js";

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

  // Styling
  border_rgb?: Rgb;
  bg_rgb?: Rgb;
  text_rgb?: Rgb;
};

export function make_character_module(opts: CharacterModuleConfig): Module {
  const rect = opts.rect;
  let hover_slot_name: string | null = null;
  let last_logged_actor: string | null = null;

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
    
    const col_width = Math.floor((rect.x1 - rect.x0) / 2);
    const start_y = rect.y1 - 4;
    
    // Check each slot position - MUST MATCH draw loop
    const check_slot = (slot_name: string, col: number, row: number, x_offset: number = 0) => {
      const slot_x = rect.x0 + Math.floor(col * col_width) + Math.floor(col_width / 2) + x_offset;
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

    // Determine display character color
    let char_rgb: { r: number; g: number; b: number };
    if (is_hovered) {
      char_rgb = { r: 255, g: 255, b: 100 };
    } else if (is_highlighted) {
      char_rgb = { r: 0, g: 255, b: 100 };
    } else {
      char_rgb = text;
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
    rect,
    Focusable: true,

    Draw(c: Canvas): void {
      if (!opts.get_is_visible()) {
        return;
      }

      const actor_name = opts.get_actor_name();
      const body_slots = opts.get_body_slots();
      const equipped = opts.get_equipped_items();
      const weight = opts.get_weight_data();
      
      // Debug logging
      if (actor_name !== last_logged_actor) {
        debug_log(`[CharacterModule] Drawing character: ${actor_name}`);
        debug_log(`[CharacterModule] Body slots: ${Object.keys(body_slots).length}`);
        debug_log(`[CharacterModule] Equipped items: ${equipped.size}`);
        last_logged_actor = actor_name;
      }
      
      const bg = opts.bg_rgb ?? { r: 20, g: 20, b: 20 };
      const border = opts.border_rgb ?? { r: 100, g: 100, b: 100 };
      
      // Fill background
      for (let x = rect.x0; x <= rect.x1; x++) {
        for (let y = rect.y0; y <= rect.y1; y++) {
          c.set(x, y, { char: " ", rgb: bg, style: "regular", weight_index: 3 });
        }
      }
      
      // Draw border (simple box)
      for (let x = rect.x0; x <= rect.x1; x++) {
        c.set(x, rect.y1, { char: "-", rgb: border, style: "regular", weight_index: 3 });
        c.set(x, rect.y0, { char: "-", rgb: border, style: "regular", weight_index: 3 });
      }
      for (let y = rect.y0; y <= rect.y1; y++) {
        c.set(rect.x0, y, { char: "|", rgb: border, style: "regular", weight_index: 3 });
        c.set(rect.x1, y, { char: "|", rgb: border, style: "regular", weight_index: 3 });
      }
      
      // Corners
      c.set(rect.x0, rect.y1, { char: "+", rgb: border, style: "regular", weight_index: 3 });
      c.set(rect.x1, rect.y1, { char: "+", rgb: border, style: "regular", weight_index: 3 });
      c.set(rect.x0, rect.y0, { char: "+", rgb: border, style: "regular", weight_index: 3 });
      c.set(rect.x1, rect.y0, { char: "+", rgb: border, style: "regular", weight_index: 3 });
      
      // Draw title
      const title = actor_name.slice(0, 10);
      const title_y = rect.y1 - 1;
      let title_x = rect.x0 + 2;
      for (const char of title) {
        if (title_x <= rect.x1 - 2) {
          c.set(title_x, title_y, { 
            char, 
            rgb: opts.text_rgb ?? { r: 200, g: 200, b: 200 }, 
            style: "regular", 
            weight_index: 4 
          });
          title_x++;
        }
      }
      
      // Draw weight bar at bottom
      const weight_y = rect.y0 + 1;
      const weight_pct = weight.max > 0 ? weight.current / weight.max : 0;
      const bar_width = rect.x1 - rect.x0 - 4;
      const filled_width = Math.floor(bar_width * Math.min(weight_pct, 1));
      
      // Weight bar color based on load
      let weight_color: Rgb;
      if (weight_pct < 0.5) weight_color = { r: 100, g: 200, b: 100 }; // Green
      else if (weight_pct < 0.75) weight_color = { r: 200, g: 200, b: 100 }; // Yellow
      else weight_color = { r: 200, g: 100, b: 100 }; // Red
      
      const bar_x = rect.x0 + 2;
      for (let i = 0; i < bar_width; i++) {
        const char = i < filled_width ? "=" : "-";
        c.set(bar_x + i, weight_y, { 
          char, 
          rgb: i < filled_width ? weight_color : { r: 60, g: 60, b: 60 }, 
          style: "regular", 
          weight_index: 3 
        });
      }
      
      // Draw weight text
      const weight_text = `${Math.floor(weight.current)}/${Math.floor(weight.max)}`;
      const text_x = rect.x0 + Math.floor((rect.x1 - rect.x0 + 1 - weight_text.length) / 2);
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
      const col_width = Math.floor((rect.x1 - rect.x0) / 2);
      const start_y = rect.y1 - 4;
      
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

      // Debug: log what body slots we have
      const available_slots = Object.keys(body_slots);
      if (available_slots.length > 0) {
        debug_log(`[CharacterModule] Drawing ${available_slots.length} body slots:`, available_slots.join(", "));
      }

      let drawn_count = 0;

      // Draw normal slots
      for (const layout of normal_slots) {
        const slot = body_slots[layout.name];
        if (slot) {
          const slot_x = rect.x0 + Math.floor(layout.col * col_width) + Math.floor(col_width / 2);
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
        const hand_center_x = rect.x0 + Math.floor(0 * col_width) + Math.floor(col_width / 2);
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
        const hand_center_x = rect.x0 + Math.floor(1 * col_width) + Math.floor(col_width / 2);
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
        debug_log(`[CharacterModule] WARNING: No body slots drawn! Available:`, available_slots);
      }
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
      
      const slot_name = get_slot_at_position(e.x, e.y);
      if (slot_name) {
        debug_log(`[CharacterModule] Clicked: ${slot_name}`);
        opts.on_slot_click?.(slot_name);
      }
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

    OnDragEnd(e: DragEvent): void {
      debug_log(`[CharacterModule] OnDragEnd called at (${e.x}, ${e.y}), visible=${opts.get_is_visible()}`);
      
      if (!opts.get_is_visible()) {
        debug_log(`[CharacterModule] DragEnd rejected - module not visible`);
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
