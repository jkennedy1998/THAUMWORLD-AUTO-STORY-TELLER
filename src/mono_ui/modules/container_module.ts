import type { Canvas, Module, Rect, Rgb, PointerEvent, DragEvent } from "../types.js";
import type { Container } from "../../types/container.js";
import type { ItemInstance } from "../../item_instances/store.js";
import type { ItemDefinition } from "../../item_storage/store.js";
import { debug_log, debug_warn } from "../../shared/debug.js";
import type { ModuleGizmosConfig } from "../module_gizmos.js";
import { PANEL_BORDER_PRESETS } from "../module_borders.js";
import { get_container_grid } from "../../container_storage/grid_calculator.js";
import { get_color_by_name } from "../colors.js";
import { resolve_cell } from "../../render_shaders/resolver.js";
import { make_item_payload, make_slot_payload } from "../../render_shaders/payload_builders.js";
import { draw_render_queue, type RenderRequest } from "../../render_shaders/render_queue.js";
import { ctx_container_ui } from "../../render_shaders/context_builders.js";
import { make_floating_panel_module } from "./floating_panel_module.js";

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
          weight_index: 2,
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

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: () => {
      const container = opts.get_container();
      const title_src = container
        ? (String((container as any)?.name ?? '').trim() || (container.id.split('.').pop() || 'container'))
        : 'CONTAINER';
      return String(title_src).toUpperCase().slice(0, 16);
    },
    gizmos: opts.gizmos,
    is_visible: opts.get_is_visible,
    background: { rgb: opts.bg_rgb ?? { r: 20, g: 20, b: 20 } },
    border: {
      style: PANEL_BORDER_PRESETS.default_double.style,
      border_rgb: opts.border_rgb ?? { r: 100, g: 100, b: 100 },
      weight_index: PANEL_BORDER_PRESETS.default_double.weight_index,
      text_rgb: opts.text_rgb ?? { r: 200, g: 200, b: 200 },
      reserve_left_cols: 2 + ((opts.gizmos?.enabled?.length ?? 0) * 2),
    },
    resize: opts.gizmos ? { min_width: 14, min_height: 10, max_width: 120, max_height: 60 } : undefined,
    draw_content(c: Canvas, next_rect: Rect): void {
      rect = next_rect;
      const container = opts.get_container();
      const slots = opts.get_slot_items();

      if (container && container.id !== last_logged_container_id) {
        const { cols, rows } = get_container_grid(container);
        debug_log(`[ContainerModule] Drawing container: ${container.id}`);
        debug_log(`[ContainerModule] Grid: ${cols}x${rows} (from ${container.capacity?.max_slots} slots)`);
        debug_log(`[ContainerModule] Slot items count: ${slots.length}`);
        debug_log(`[ContainerModule] Filled slots: ${slots.filter(s => s.instance).length}`);
        last_logged_container_id = container.id;
      }

      if (container) {
        const rq: RenderRequest[] = [];
        const now_ms = Date.now();
        const { cols, rows } = get_container_grid(container);
        const max_slots = container.capacity?.max_slots ?? (cols * rows);
        const slot_spacing_x = 2;
        const slot_spacing_y = 1;
        const available_width = rect.x1 - rect.x0 - 3;
        const available_height = rect.y1 - rect.y0 - 4;
        const start_x = rect.x0 + 2;
        const start_y = rect.y1 - 2;

        if (container.id !== last_logged_container_id) {
          debug_log(`[ContainerModule] Drawing ${cols}x${rows} grid (${container.capacity?.max_slots} slots) in area ${available_width}x${available_height}`);
          debug_log(`[ContainerModule] Start position: (${start_x}, ${start_y})`);
        }

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const slot_index = row * cols + col;
            if (slot_index >= max_slots) continue;
            const slot_x = start_x + col * slot_spacing_x;
            const slot_y = start_y - row * slot_spacing_y;
            if (slot_x <= rect.x1 - 1 && slot_y >= rect.y0 + 1) {
              const slot_item = slots.find(s => s.slot_index === slot_index);
              const is_hovered = slot_index === hover_slot_index;
              enqueue_slot(rq, slot_x, slot_y, slot_item, is_hovered, slot_index);
            }
          }
        }

        draw_render_queue(c, rq, { now_ms, pass_order: ['ui', 'item'] });
      } else {
        const msg = 'NO CONTAINER';
        const msg_x = rect.x0 + Math.floor((rect.x1 - rect.x0 + 1 - msg.length) / 2);
        const msg_y = rect.y0 + Math.floor((rect.y1 - rect.y0 + 1) / 2);
        for (let i = 0; i < msg.length; i++) {
          const char = msg.charAt(i);
          c.set(msg_x + i, msg_y, { char, rgb: { r: 150, g: 0, b: 0 }, style: 'regular', weight_index: 2 });
        }
      }
    },
    on_pointer_move_content(e: PointerEvent): void {
      const new_hover = get_slot_at_position(e.x, e.y);
      if (new_hover !== hover_slot_index) {
        hover_slot_index = new_hover;
        if (hover_slot_index >= 0) {
          const slots = opts.get_slot_items();
          const slot = slots.find(s => s.slot_index === hover_slot_index);
          if (slot?.instance) {
            debug_log(`[ContainerModule] Hover slot ${hover_slot_index}: ${slot.definition?.name || 'unknown'}`);
            if (opts.on_slot_hover && slot.definition) opts.on_slot_hover(hover_slot_index, slot.instance, slot.definition);
          } else {
            if (opts.on_slot_hover) opts.on_slot_hover(hover_slot_index, null as unknown as ItemInstance, null);
          }
        } else {
          if (opts.on_slot_hover) opts.on_slot_hover(-1, null as unknown as ItemInstance, null);
        }
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const slot_index = get_slot_at_position(e.x, e.y);
      if (slot_index >= 0) {
        const slots = opts.get_slot_items();
        const slot = slots.find(s => s.slot_index === slot_index);
        debug_log(`[ContainerModule] Clicked slot ${slot_index}: ${slot?.definition?.name || 'empty'}`);
        if (e.button === 2 && slot?.instance && slot.definition && is_container_item(slot.definition)) {
          const container = opts.get_container();
          if (container) opts.on_open_container_item?.(slot.instance, slot.definition, container.id);
          return;
        }
        const click_count = (e as any).click_count;
        if (click_count === 2 && slot?.instance && slot.definition && is_container_item(slot.definition)) {
          const container = opts.get_container();
          if (container) opts.on_open_container_item?.(slot.instance, slot.definition, container.id);
          return;
        }
        opts.on_slot_click?.(slot_index);
      }
    },
    on_pointer_leave_content(): void {
      hover_slot_index = -1;
    },
    on_drag_start_content(e: DragEvent): void {
      debug_log(`[ContainerModule] OnDragStart called at (${e.start_x}, ${e.start_y}), visible=${opts.get_is_visible()}`);
      if (opts.allow_drag === false) {
        debug_log(`[ContainerModule] Drag rejected - allow_drag=false (container=${opts.get_container()?.id ?? 'unknown'})`);
        return;
      }
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
      opts.on_drag_start?.(slot_index, slot.instance, slot.definition, container.id);
      debug_log(`[ContainerModule] Drag start callback executed`);
    },
    on_drag_end_content(e: DragEvent): void {
      debug_log(`[ContainerModule] OnDragEnd called at (${e.x}, ${e.y})`);
      debug_log(`[ContainerModule] Container rect: (${rect.x0},${rect.y0}) to (${rect.x1},${rect.y1})`);
      const within_rect = e.x >= rect.x0 && e.x <= rect.x1 && e.y >= rect.y0 && e.y <= rect.y1;
      debug_log(`[ContainerModule] Drop within rect: ${within_rect}`);
      if (within_rect) {
        const slot_index = get_slot_at_position(e.x, e.y);
        if (slot_index >= 0) {
          debug_log(`[ContainerModule] Internal drop on slot ${slot_index}`);
          debug_log(`[ContainerModule] on_drop callback exists: ${!!opts.on_drop}`);
          const container = opts.get_container();
          let grid_x: number | undefined;
          let grid_y: number | undefined;
          if (container && container.capacity?.max_slots) {
            const { cols } = get_container_grid(container);
            grid_x = slot_index % cols;
            grid_y = Math.floor(slot_index / cols);
            debug_log(`[ContainerModule] Calculated grid coordinates: (${grid_x}, ${grid_y}) from slot ${slot_index}`);
          }
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
          if (opts.on_drag_rejected) opts.on_drag_rejected();
        }
        return;
      }
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
    on_drag_move_content(e: DragEvent): void {
      debug_log(`[ContainerModule] OnDragMove at (${e.x}, ${e.y})`);
    },
    on_global_key_down(_e: KeyboardEvent): void {
      // Note: 'I' key is now handled globally in app_state.ts
    },
  });
}
