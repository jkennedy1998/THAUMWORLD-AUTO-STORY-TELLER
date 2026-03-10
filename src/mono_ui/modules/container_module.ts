import type { Canvas, Module, Rect, Rgb, PointerEvent, DragEvent } from "../types.js";
import type { Container } from "../../types/container.js";
import type { ItemInstance } from "../../item_instances/store.js";
import type { ItemDefinition } from "../../item_storage/store.js";
import { debug_log, debug_warn } from "../../shared/debug.js";
import type { ModuleGizmosConfig, GizmoState } from "../module_gizmos.js";
import {
  draw_module_gizmos,
  handle_gizmo_click,
  create_gizmo_state,
  is_in_gizmo_area,
  get_resize_edge,
  handle_resize_drag,
  handle_global_pointer_down_for_gizmos,
} from "../module_gizmos.js";
import { draw_module_border, BORDER_STYLES } from "../module_borders.js";
import { get_container_grid } from "../../container_storage/grid_calculator.js";
import { get_color_by_name } from "../colors.js";
import { resolve_cell } from "../../render_shaders/resolver.js";
import { make_item_payload, make_slot_payload } from "../../render_shaders/payload_builders.js";
import { draw_render_queue, type RenderRequest } from "../../render_shaders/render_queue.js";
import { ctx_container_ui } from "../../render_shaders/context_builders.js";

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
  // If the dragged item is a container-item, open it instead of dragging.
  on_open_container_item?: (item: ItemInstance, definition: ItemDefinition, parent_container_id: string) => void;
  on_cross_module_drop?: (x: number, y: number) => Promise<boolean>;
  on_drop?: (slot_index: number, grid_x?: number, grid_y?: number) => Promise<boolean>; // Returns true if drop was successful
  get_compatible_slots?: (item_def: ItemDefinition) => string[];
  on_slot_hover?: (slot_index: number, item: ItemInstance, definition: ItemDefinition | null) => void;
  // Bidirectional highlighting: items highlighted when hovering body slots
  get_highlighted_items?: () => Array<{ container_id: string; slot_index: number }>;
  on_drag_rejected?: () => void;

  // Disable dragging items out of this container.
  // Useful for tile containers / harvestables where interactions are click-based.
  allow_drag?: boolean;

  // Optional open container ids, used to show "open" state on container-items.
  get_open_containers?: () => Set<string>;
  // Map an item instance id to its canonical container_id used in open_containers.
  // Example: actor.item.<actor_id>.<item_id> or place.item.<place_id>.<item_id>
  get_open_container_id_for_item?: (item_instance_id: string) => string | null;
  border_rgb?: Rgb;
  bg_rgb?: Rgb;
  text_rgb?: Rgb;
  // Phase 8: Module Gizmos (close X, move #)
  gizmos?: ModuleGizmosConfig;
};

export function make_container_module(opts: ContainerModuleConfig): Module {
  // Phase 8: Use mutable rect for moving
  let rect = opts.rect;
  let hover_slot_index = -1;
  let last_logged_container_id: string | null = null;
  
  // Phase 8: Gizmo state
  const gizmo_state: GizmoState = create_gizmo_state();

  debug_log("[ContainerModule] Created module:", opts.id);

  function is_container_item(definition: ItemDefinition): boolean {
    const tags: any[] = (definition as any)?.tags ?? [];
    return tags.some((t: any) => {
      const name = String(t?.name ?? '').toUpperCase();
      return ['CONTAINER', 'BAG', 'SACK', 'POUCH', 'BACKPACK', 'WALLET', 'CHEST', 'BOX'].includes(name);
    });
  }

  function get_slot_at_position(x: number, y: number): number {
    const container = opts.get_container();
    if (!container) return -1;

    const { cols, rows } = get_container_grid(container);
    const max_slots = container.capacity?.max_slots ?? (cols * rows);
    
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
    return slot_index >= 0 && slot_index < max_slots ? slot_index : -1;
  }

  function enqueue_slot(rq: RenderRequest[], slot_x: number, slot_y: number, slot_item: SlotItem | undefined, is_hovered: boolean, slot_index: number): void {
    const text = opts.text_rgb ?? { r: 200, g: 200, b: 200 };
    
    // Check if this slot should be highlighted (bidirectional highlighting)
    const highlighted_items = opts.get_highlighted_items?.() ?? [];
    const container = opts.get_container();
    const is_highlighted = Boolean(container && highlighted_items.some(
      h => h.container_id === container.id && h.slot_index === slot_index
    ));
    
    // Debug: log what we have
    if (slot_item?.instance && is_hovered) {
      debug_log(`[ContainerModule] Slot data - instance: ${!!slot_item.instance}, definition: ${!!slot_item.definition}`);
      if (slot_item.definition) {
        debug_log(`[ContainerModule] Definition - name: ${slot_item.definition.name}, display_char: ${slot_item.definition.display_char}`);
      }
    }
    
    const open_containers = opts.get_open_containers?.();
    const open_id = slot_item?.instance?.id ? opts.get_open_container_id_for_item?.(slot_item.instance.id) : null;
    const is_open = Boolean(open_containers && open_id && open_containers.has(open_id));

    if (slot_item?.instance && slot_item.definition) {
      const qty = slot_item.instance.qty;

      rq.push({
        pass: 'item',
        x: slot_x,
        y: slot_y,
        order: 0,
        key: slot_item.instance.id,
        payload: make_item_payload(slot_item.instance, slot_item.definition) as any,
        ctx: ctx_container_ui({ hovered: is_hovered, highlighted: is_highlighted, selected: is_open }),
      });
      
      if (is_hovered) {
        const item_name = slot_item.definition.name || "unnamed";
        debug_log(`[ContainerModule] Hovered slot: ${item_name} x${qty}`);
      }
    } else if (slot_item?.instance && !slot_item.definition) {
      // Has instance but no definition - show "?"
      rq.push({
        pass: 'ui',
        x: slot_x,
        y: slot_y,
        order: 0,
        key: `missing_def:${slot_item.instance.id}`,
        cell: {
          char: '?',
          rgb: is_highlighted ? { r: 0, g: 255, b: 100 } : { r: 255, g: 100, b: 100 },
          style: 'regular',
          weight_index: 4,
          render_index: 0,
        },
      });
    } else {
      rq.push({
        pass: 'ui',
        x: slot_x,
        y: slot_y,
        order: 0,
        key: `slot:${container?.id ?? 'container'}:${slot_index}`,
        payload: make_slot_payload({
          id: `slot:${container?.id ?? 'container'}:${slot_index}`,
          slot_type: 'neutral',
          is_placeholder: false,
        }) as any,
        ctx: ctx_container_ui({ hovered: is_hovered, highlighted: false }),
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

      const container = opts.get_container();
      const slots = opts.get_slot_items();
      
      // Debug logging - only when container changes
      if (container && container.id !== last_logged_container_id) {
        const { cols, rows } = get_container_grid(container);
        debug_log(`[ContainerModule] Drawing container: ${container.id}`);
        debug_log(`[ContainerModule] Grid: ${cols}x${rows} (from ${container.capacity?.max_slots} slots)`);
        debug_log(`[ContainerModule] Slot items count: ${slots.length}`);
        debug_log(`[ContainerModule] Filled slots: ${slots.filter(s => s.instance).length}`);
        last_logged_container_id = container.id;
      }
      
      const title = container ? (container.id.split(".").pop() || "container").toUpperCase().slice(0, 10) : "CONTAINER";

      draw_module_border(c, {
        rect,
        style: BORDER_STYLES.double,
        border_rgb: opts.border_rgb ?? { r: 100, g: 100, b: 100 },
        bg_rgb: opts.bg_rgb ?? { r: 20, g: 20, b: 20 },
        weight_index: 3,
        header: {
          text: title,
          text_rgb: opts.text_rgb ?? { r: 200, g: 200, b: 200 },
          // Reserve header space for gizmos without adding an interior divider.
          reserve_left_cols: 2 + ((opts.gizmos?.enabled?.length ?? 0) * 2),
        },
      });
      
      // Draw grid of slots
      if (container) {
        const rq: RenderRequest[] = [];
        const now_ms = Date.now();
        const { cols, rows } = get_container_grid(container);
        const max_slots = container.capacity?.max_slots ?? (cols * rows);
        
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
          debug_log(`[ContainerModule] Drawing ${cols}x${rows} grid (${container.capacity?.max_slots} slots) in area ${available_width}x${available_height}`);
          debug_log(`[ContainerModule] Start position: (${start_x}, ${start_y})`);
        }
        
        // Draw each slot
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const slot_index = row * cols + col;
            if (slot_index >= max_slots) continue;
            // Position: x increases right, y decreases upward (canvas coordinates)
            const slot_x = start_x + col * slot_spacing_x;
            const slot_y = start_y - row * slot_spacing_y;
            
            // Only draw if within module bounds
            if (slot_x <= rect.x1 - 1 && slot_y >= rect.y0 + 1) {
              const slot_item = slots.find(s => s.slot_index === slot_index);
              const is_hovered = slot_index === hover_slot_index;
              
              enqueue_slot(rq, slot_x, slot_y, slot_item, is_hovered, slot_index);
            }
          }
        }

        // Flush slot glyphs after layout pass.
        draw_render_queue(c, rq, { now_ms, pass_order: ['ui', 'item'] });
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

      // Draw gizmos LAST so they appear on top (including resize borders)
      if (opts.gizmos) {
        draw_module_gizmos(c, rect, opts.gizmos, gizmo_state);
      }
      
    },

    OnGlobalKeyDown(e: KeyboardEvent): void {
      // Note: 'I' key is now handled globally in app_state.ts
      // This handler can be used for other global shortcuts if needed
    },

    OnGlobalPointerDown(e: PointerEvent): void {
      if (opts.gizmos) {
        handle_global_pointer_down_for_gizmos(e, rect, opts.gizmos, gizmo_state);
      }
    },

    OnPointerMove(e: PointerEvent): void {
      if (!opts.get_is_visible()) return;

      // Resize edge hover feedback.
      if (gizmo_state.is_resize_mode && !gizmo_state.is_dragging_resize) {
        gizmo_state.resize_edge = get_resize_edge(e.x, e.y, rect);
      }

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
      
      // Phase 8: Check for gizmo clicks first
      if (opts.gizmos && is_in_gizmo_area(e.x, e.y, rect)) {
        const clicked_gizmo = handle_gizmo_click(e.x, e.y, rect, opts.gizmos, gizmo_state);
        if (clicked_gizmo) {
          debug_log(`[ContainerModule] Gizmo clicked: ${clicked_gizmo}`);
          return;  // Don't process slot clicks if gizmo was clicked
        }
      }

      // Resize mode: clicking on a border edge starts resize drag.
      if (gizmo_state.is_resize_mode) {
        const edge = get_resize_edge(e.x, e.y, rect);
        if (edge) {
          gizmo_state.resize_edge = edge;
          gizmo_state.is_dragging_resize = true;
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
          gizmo_state.original_rect = { ...rect };
          return;
        }
      }
      
      const slot_index = get_slot_at_position(e.x, e.y);
      if (slot_index >= 0) {
        const slots = opts.get_slot_items();
        const slot = slots.find(s => s.slot_index === slot_index);
        debug_log(`[ContainerModule] Clicked slot ${slot_index}: ${slot?.definition?.name || "empty"}`);

        // Right-click container-items to open them.
        if (e.button === 2 && slot?.instance && slot.definition && is_container_item(slot.definition)) {
          const container = opts.get_container();
          if (container) {
            opts.on_open_container_item?.(slot.instance, slot.definition, container.id);
          }
          return;
        }

        // Double-click container-items to open them.
        const click_count = (e as any).click_count;
        if (click_count === 2 && slot?.instance && slot.definition && is_container_item(slot.definition)) {
          const container = opts.get_container();
          if (container) {
            opts.on_open_container_item?.(slot.instance, slot.definition, container.id);
          }
          return;
        }

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

      if (opts.allow_drag === false) {
        debug_log(`[ContainerModule] Drag rejected - allow_drag=false (container=${opts.get_container()?.id ?? 'unknown'})`);
        return;
      }

      // Resize drag is handled in OnDragMove; don't start item drags.
      if (gizmo_state.is_resize_mode && gizmo_state.is_dragging_resize) {
        return;
      }

      // Phase 8: Handle move mode drag start
      if (gizmo_state.is_move_mode) {
        debug_log(`[ContainerModule] Move mode drag started at (${e.start_x}, ${e.start_y})`);
        gizmo_state.move_start_x = e.start_x;
        gizmo_state.move_start_y = e.start_y;
        if (opts.gizmos?.on_move_start) {
          opts.gizmos.on_move_start();
        }
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

      // Finish resize drag (don't treat as item drop).
      if (gizmo_state.is_resize_mode && gizmo_state.is_dragging_resize) {
        gizmo_state.is_dragging_resize = false;
        gizmo_state.resize_edge = null;
        if (opts.gizmos?.on_move_end) {
          opts.gizmos.on_move_end(rect);
        }
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
        
        debug_log(`[ContainerModule] Move mode ended: final rect at (${rect.x0},${rect.y0})`);
        
        if (opts.gizmos?.on_move_end) {
          opts.gizmos.on_move_end(final_rect);
        }
        
        // Stay in move mode until user clicks # again
        return;
      }
      
      // Check if drop is within our rect
      const within_rect = e.x >= rect.x0 && e.x <= rect.x1 && e.y >= rect.y0 && e.y <= rect.y1;
      debug_log(`[ContainerModule] Drop within rect: ${within_rect}`);
      
      if (within_rect) {
        // Drop within container - handle internal slot-to-slot movement
        const slot_index = get_slot_at_position(e.x, e.y);
        if (slot_index >= 0) {
          debug_log(`[ContainerModule] Internal drop on slot ${slot_index}`);
          debug_log(`[ContainerModule] on_drop callback exists: ${!!opts.on_drop}`);
          
          // Calculate grid coordinates from slot_index
          const container = opts.get_container();
          let grid_x: number | undefined;
          let grid_y: number | undefined;
          
          if (container && container.capacity?.max_slots) {
            const { cols } = get_container_grid(container);
            grid_x = slot_index % cols;
            grid_y = Math.floor(slot_index / cols);
            debug_log(`[ContainerModule] Calculated grid coordinates: (${grid_x}, ${grid_y}) from slot ${slot_index}`);
          }
          
          // Notify parent via callback - it will handle the transfer
          if (opts.on_drop) {
            debug_log(`[ContainerModule] Calling on_drop for slot: ${slot_index} at grid(${grid_x},${grid_y})`);
            void opts.on_drop(slot_index, grid_x, grid_y).then((success: boolean) => {
              debug_log(`[ContainerModule] Drop ${success ? 'successful' : 'failed'} on slot ${slot_index}`);
            });
          } else {
            debug_log(`[ContainerModule] No on_drop callback defined for internal drop`);
          }
        } else {
          debug_log(`[ContainerModule] Drop within container but not on a slot`);
          // Drop inside module but not on valid slot - reject the drag
          if (opts.on_drag_rejected) {
            opts.on_drag_rejected();
          }
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
        
        debug_log(`[ContainerModule] Move mode: delta (${dx}, ${dy}), new rect at (${rect.x0},${rect.y0})`);
        
        if (opts.gizmos?.on_move) {
          opts.gizmos.on_move(new_rect);
        }
        return;
      }

      // Handle resize dragging
      if (gizmo_state.is_resize_mode && gizmo_state.is_dragging_resize && gizmo_state.original_rect) {
        const container = opts.get_container();
        const { cols, rows } = container ? get_container_grid(container) : { cols: 5, rows: 2 };
        const min_width = Math.max(14, (cols * 2) + 2);
        const min_height = Math.max(10, rows + 6);
        const max_width = 120;
        const max_height = 60;

        const new_rect = handle_resize_drag(
          e.x,
          e.y,
          gizmo_state,
          gizmo_state.original_rect,
          min_width,
          min_height,
          max_width,
          max_height,
          (newRect) => {
            rect = newRect;
            if (opts.gizmos?.on_resize) opts.gizmos.on_resize(rect);
            else if (opts.gizmos?.on_move) opts.gizmos.on_move(rect);
          }
        );

        if (new_rect) {
          rect = new_rect;
        }
        return;
      }
      
      debug_log(`[ContainerModule] OnDragMove at (${e.x}, ${e.y})`);
    },

    OnPointerUp(): void {
      if (gizmo_state.is_dragging_resize) {
        gizmo_state.is_dragging_resize = false;
        gizmo_state.resize_edge = null;
        if (opts.gizmos?.on_resize_end) opts.gizmos.on_resize_end(rect);
        else if (opts.gizmos?.on_move_end) opts.gizmos.on_move_end(rect);
      }
    },
  };
}
