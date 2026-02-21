import type { Canvas, Module, Rect, Rgb, PointerEvent, DragEvent } from "../types.js";
import type { Container } from "../../types/container.js";
import type { ItemInstance } from "../../item_instances/store.js";
import type { ItemDefinition } from "../../item_storage/store.js";
import { debug_log, debug_warn } from "../../shared/debug.js";

// Simple slot item type
export type SlotItem = {
  slot_index: number;
  instance: ItemInstance | null;
  definition: ItemDefinition | null;
};

// Drag payload data
export type DragData = {
  source_module_id: string;
  source_type: "container_slot" | "body_slot" | "ground";
  item_instance_id: string;
  item_def_id: string;
  quantity: number;
  from_slot_index?: number;
};

// Container module configuration
export type ContainerModuleConfig = {
  id: string;
  rect: Rect;
  get_container: () => Container | null;
  get_slot_items: () => SlotItem[];
  get_is_visible: () => boolean;
  set_is_visible: (visible: boolean) => void;
  on_slot_click?: (slot_index: number) => void;
  on_drag_start?: (slot_index: number, item: ItemInstance, definition: ItemDefinition, container_id: string) => void;
  on_cross_module_drop?: (x: number, y: number) => Promise<boolean>;
  on_drop?: (slot_index: number) => Promise<boolean>; // Returns true if drop was successful
  get_compatible_slots?: (item_def: ItemDefinition) => string[];
  on_slot_hover?: (slot_index: number, item: ItemInstance, definition: ItemDefinition | null) => void;
  border_rgb?: Rgb;
  bg_rgb?: Rgb;
  text_rgb?: Rgb;
};

export function make_container_module(opts: ContainerModuleConfig): Module {
  const rect = opts.rect;
  let hover_slot_index = -1;
  let last_logged_container_id: string | null = null;

  debug_log("[ContainerModule] Created module:", opts.id);

  function get_slot_at_position(x: number, y: number): number {
    const container = opts.get_container();
    if (!container) return -1;

    const cols = container.grid_dimensions?.cols || 5;
    const rows = container.grid_dimensions?.rows || 2;
    
    // MUST MATCH the drawing logic exactly!
    // Drawing uses: slot_spacing_x = 2, slot_spacing_y = 1
    const slot_spacing_x = 2;
    const slot_spacing_y = 1;
    
    // Drawing start positions (from Draw() function)
    const start_x = rect.x0 + 2;
    const start_y = rect.y1 - 2;  // Row 0 is at the bottom
    
    // Calculate which slot position this x,y falls into
    // For x: simple offset from start_x
    if (x < start_x) return -1;
    const col = Math.floor((x - start_x) / slot_spacing_x);
    if (col < 0 || col >= cols) return -1;
    
    // For y: drawing puts row 0 at start_y, row 1 at start_y - 1, etc.
    // So we need to reverse this: if y = start_y, that's row 0
    // if y = start_y - 1, that's row 1
    const row_offset = start_y - y;
    if (row_offset < 0) return -1;  // Below row 0
    const row = Math.floor(row_offset / slot_spacing_y);
    if (row < 0 || row >= rows) return -1;
    
    const slot_index = row * cols + col;
    return slot_index < cols * rows ? slot_index : -1;
  }

  function draw_slot(c: Canvas, slot_x: number, slot_y: number, slot_item: SlotItem | undefined, is_hovered: boolean): void {
    const text = opts.text_rgb ?? { r: 200, g: 200, b: 200 };
    
    // Debug: log what we have
    if (slot_item?.instance && is_hovered) {
      debug_log(`[ContainerModule] Slot data - instance: ${!!slot_item.instance}, definition: ${!!slot_item.definition}`);
      if (slot_item.definition) {
        debug_log(`[ContainerModule] Definition - name: ${slot_item.definition.name}, display_char: ${slot_item.definition.display_char}`);
      }
    }
    
    // Simple slot background - just the character position
    if (slot_item?.instance && slot_item.definition) {
      // Has item - determine display character
      const qty = slot_item.instance.qty;
      let char: string;
      
      // Priority: display_char > first letter of name > "?"
      if (slot_item.definition.display_char && slot_item.definition.display_char !== "·") {
        char = slot_item.definition.display_char;
      } else if (slot_item.definition.name) {
        char = slot_item.definition.name.charAt(0).toLowerCase();
      } else {
        char = "?";
      }
      
      // If quantity > 1, show number instead
      const display_char = qty > 1 ? (qty > 9 ? "+" : String(qty)) : char;
      
      c.set(slot_x, slot_y, { 
        char: display_char, 
        rgb: is_hovered ? { r: 255, g: 255, b: 100 } : text, 
        style: "regular", 
        weight_index: is_hovered ? 6 : 4 
      });
      
      if (is_hovered) {
        const item_name = slot_item.definition.name || "unnamed";
        debug_log(`[ContainerModule] Hovered slot: ${item_name} x${qty} (char: ${char})`);
      }
    } else if (slot_item?.instance && !slot_item.definition) {
      // Has instance but no definition - show "?"
      c.set(slot_x, slot_y, { 
        char: "?", 
        rgb: { r: 255, g: 100, b: 100 }, 
        style: "regular", 
        weight_index: 4 
      });
    } else {
      // Empty slot
      c.set(slot_x, slot_y, { 
        char: ".", 
        rgb: { r: 40, g: 40, b: 40 }, 
        style: "regular", 
        weight_index: 1 
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

      const container = opts.get_container();
      const slots = opts.get_slot_items();
      
      // Debug logging - only when container changes
      if (container && container.id !== last_logged_container_id) {
        debug_log(`[ContainerModule] Drawing container: ${container.id}`);
        debug_log(`[ContainerModule] Grid: ${container.grid_dimensions?.cols}x${container.grid_dimensions?.rows}`);
        debug_log(`[ContainerModule] Slot items count: ${slots.length}`);
        debug_log(`[ContainerModule] Filled slots: ${slots.filter(s => s.instance).length}`);
        last_logged_container_id = container.id;
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
      
      // Draw corners
      c.set(rect.x0, rect.y1, { char: "+", rgb: border, style: "regular", weight_index: 3 });
      c.set(rect.x1, rect.y1, { char: "+", rgb: border, style: "regular", weight_index: 3 });
      c.set(rect.x0, rect.y0, { char: "+", rgb: border, style: "regular", weight_index: 3 });
      c.set(rect.x1, rect.y0, { char: "+", rgb: border, style: "regular", weight_index: 3 });
      
      // Draw title if we have container
      if (container) {
        const title = container.id.split(".").pop() || "container";
        const title_y = rect.y1 - 1;
        let title_x = rect.x0 + 2;
        for (const char of title.slice(0, 10)) {
          if (title_x <= rect.x1 - 2) {
            c.set(title_x, title_y, { char, rgb: opts.text_rgb ?? { r: 200, g: 200, b: 200 }, style: "regular", weight_index: 4 });
            title_x++;
          }
        }
      }
      
      // Draw grid of slots
      if (container) {
        const cols = container.grid_dimensions?.cols || 5;
        const rows = container.grid_dimensions?.rows || 2;
        
        // Use smaller spacing to fit more slots
        const slot_spacing_x = 2;  // Horizontal spacing between slots
        const slot_spacing_y = 1;  // Vertical spacing between slots
        
        // Calculate grid to fill available space
        const available_width = rect.x1 - rect.x0 - 3;  // Leave margin
        const available_height = rect.y1 - rect.y0 - 4; // Leave margin for title/border
        
        // Start positions with small margin
        const start_x = rect.x0 + 2;
        const start_y = rect.y1 - 2;  // Start from top (y increases upward)
        
        // Debug grid size
        if (container.id !== last_logged_container_id) {
          debug_log(`[ContainerModule] Drawing ${cols}x${rows} grid in area ${available_width}x${available_height}`);
          debug_log(`[ContainerModule] Start position: (${start_x}, ${start_y})`);
        }
        
        // Draw each slot
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const slot_index = row * cols + col;
            // Position: x increases right, y decreases upward (canvas coordinates)
            const slot_x = start_x + col * slot_spacing_x;
            const slot_y = start_y - row * slot_spacing_y;
            
            // Only draw if within module bounds
            if (slot_x <= rect.x1 - 1 && slot_y >= rect.y0 + 1) {
              const slot_item = slots.find(s => s.slot_index === slot_index);
              const is_hovered = slot_index === hover_slot_index;
              
              draw_slot(c, slot_x, slot_y, slot_item, is_hovered);
            }
          }
        }
      } else {
        // No container - show message
        const msg = "NO CONTAINER";
        const msg_x = rect.x0 + Math.floor((rect.x1 - rect.x0 + 1 - msg.length) / 2);
        const msg_y = rect.y0 + Math.floor((rect.y1 - rect.y0 + 1) / 2);
        
        for (let i = 0; i < msg.length; i++) {
          const char = msg.charAt(i);
          c.set(msg_x + i, msg_y, { char, rgb: { r: 150, g: 0, b: 0 }, style: "regular", weight_index: 5 });
        }
      }
    },

    OnGlobalKeyDown(e: KeyboardEvent): void {
      if (e.key === 'i' || e.key === 'I') {
        const new_visible = !opts.get_is_visible();
        opts.set_is_visible(new_visible);
        debug_log(`[ContainerModule] Toggled visibility: ${new_visible}`);
        e.preventDefault();
      }
    },

    OnPointerMove(e: PointerEvent): void {
      if (!opts.get_is_visible()) return;

      const new_hover = get_slot_at_position(e.x, e.y);
      if (new_hover !== hover_slot_index) {
        hover_slot_index = new_hover;
        if (hover_slot_index >= 0) {
          const slots = opts.get_slot_items();
          const slot = slots.find(s => s.slot_index === hover_slot_index);
          if (slot?.instance) {
            debug_log(`[ContainerModule] Hover slot ${hover_slot_index}: ${slot.definition?.name || 'unknown'}`);
            // Notify parent of hover for compatible slot highlighting
            if (opts.on_slot_hover && slot.definition) {
              opts.on_slot_hover(hover_slot_index, slot.instance, slot.definition);
            }
          } else {
            // Hovering over empty slot - clear highlight
            if (opts.on_slot_hover) {
              opts.on_slot_hover(hover_slot_index, null as unknown as ItemInstance, null);
            }
          }
        } else {
          // Not hovering over any slot - clear highlight
          if (opts.on_slot_hover) {
            opts.on_slot_hover(-1, null as unknown as ItemInstance, null);
          }
        }
      }
    },

    OnPointerDown(e: PointerEvent): void {
      if (!opts.get_is_visible()) return;
      
      const slot_index = get_slot_at_position(e.x, e.y);
      if (slot_index >= 0) {
        const slots = opts.get_slot_items();
        const slot = slots.find(s => s.slot_index === slot_index);
        debug_log(`[ContainerModule] Clicked slot ${slot_index}: ${slot?.definition?.name || "empty"}`);
        opts.on_slot_click?.(slot_index);
      }
    },

    OnPointerLeave(): void {
      hover_slot_index = -1;
    },

    OnDragStart(e: DragEvent): void {
      debug_log(`[ContainerModule] OnDragStart called at (${e.start_x}, ${e.start_y}), visible=${opts.get_is_visible()}`);
      
      if (!opts.get_is_visible()) {
        debug_log(`[ContainerModule] Drag rejected - container not visible`);
        return;
      }

      // Get the slot where drag started
      const slot_index = get_slot_at_position(e.start_x, e.start_y);
      debug_log(`[ContainerModule] Drag slot detection: slot_index=${slot_index}`);
      
      if (slot_index < 0) {
        debug_log(`[ContainerModule] Drag rejected - no slot at position`);
        return;
      }

      const slots = opts.get_slot_items();
      const slot = slots.find(s => s.slot_index === slot_index);
      debug_log(`[ContainerModule] Found slot: instance=${!!slot?.instance}, definition=${!!slot?.definition}`);
      
      if (!slot?.instance || !slot?.definition) {
        debug_log(`[ContainerModule] Cannot drag empty slot ${slot_index}`);
        return;
      }

      const container = opts.get_container();
      if (!container) {
        debug_log(`[ContainerModule] Cannot drag - no container loaded`);
        return;
      }

      debug_log(`[ContainerModule] Drag started on slot ${slot_index}: ${slot.definition.name} (container=${container.id})`);

      // Notify parent via callback
      opts.on_drag_start?.(slot_index, slot.instance, slot.definition, container.id);
      debug_log(`[ContainerModule] Drag start callback executed`);
    },

    OnDragEnd(e: DragEvent): void {
      debug_log(`[ContainerModule] OnDragEnd called at (${e.x}, ${e.y})`);
      debug_log(`[ContainerModule] Container rect: (${rect.x0},${rect.y0}) to (${rect.x1},${rect.y1})`);
      
      // Check if drop is within our rect
      const within_rect = e.x >= rect.x0 && e.x <= rect.x1 && e.y >= rect.y0 && e.y <= rect.y1;
      debug_log(`[ContainerModule] Drop within rect: ${within_rect}`);
      
      if (within_rect) {
        // Drop within container - handle internal slot-to-slot movement
        const slot_index = get_slot_at_position(e.x, e.y);
        if (slot_index >= 0) {
          debug_log(`[ContainerModule] Internal drop on slot ${slot_index}`);
          debug_log(`[ContainerModule] on_drop callback exists: ${!!opts.on_drop}`);
          
          // Notify parent via callback - it will handle the transfer
          if (opts.on_drop) {
            debug_log(`[ContainerModule] Calling on_drop for slot: ${slot_index}`);
            void opts.on_drop(slot_index).then((success: boolean) => {
              debug_log(`[ContainerModule] Drop ${success ? 'successful' : 'failed'} on slot ${slot_index}`);
            });
          } else {
            debug_log(`[ContainerModule] No on_drop callback defined for internal drop`);
          }
        } else {
          debug_log(`[ContainerModule] Drop within container but not on a slot`);
        }
        return;
      }

      // Drop outside container - this is a cross-module drop
      debug_log(`[ContainerModule] Cross-module drop detected at (${e.x}, ${e.y})`);
      debug_log(`[ContainerModule] on_cross_module_drop callback exists: ${!!opts.on_cross_module_drop}`);
      
      if (opts.on_cross_module_drop) {
        debug_log(`[ContainerModule] Calling on_cross_module_drop...`);
        void opts.on_cross_module_drop(e.x, e.y).then((success: boolean) => {
          debug_log(`[ContainerModule] Cross-module drop result: ${success ? 'success' : 'failed'}`);
        });
      } else {
        debug_log(`[ContainerModule] No on_cross_module_drop callback defined`);
      }
    },

    OnDragMove(e: DragEvent): void {
      // Track drag position for highlighting compatible slots in other modules
      // This is handled by the parent app_state which has access to both modules
      // We just ensure the drag state stays active
      debug_log(`[ContainerModule] OnDragMove at (${e.x}, ${e.y})`);
    },
  };
}
