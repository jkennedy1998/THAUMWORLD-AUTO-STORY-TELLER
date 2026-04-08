import type { Canvas, Module, PointerEvent, Rect, Rgb, WheelEvent } from "../types.js";
import { calculate_grid_dimensions } from "../../types/container.js";
import { get_color_by_name } from "../colors.js";
import { make_floating_panel_module } from "./floating_panel_module.js";
import { make_item_payload, make_slot_payload } from "../../render_shaders/payload_builders.js";
import { ctx_character_slot, ctx_container_ui } from "../../render_shaders/context_builders.js";
import { draw_render_queue, type RenderRequest } from "../../render_shaders/render_queue.js";
import type { OwnerInventoryView, StorageSlot, StorageSurface } from "../../inventory_surfaces/types.js";
import { get_container_id_from_target_id } from "../../inventory_surfaces/target_ids.js";
import type { ItemDefinition } from "../../item_storage/store.js";
import type { ItemInstance } from "../../item_instances/store.js";
import { has_resolved_tag } from "../../tag_system/canonical_readers.js";

export type OwnerInventoryModuleConfig = {
  id: string;
  rect: Rect;
  get_view: () => OwnerInventoryView | null;
  get_is_visible: () => boolean;
  set_is_visible: (visible: boolean) => void;
  on_open_nested_container?: (item_id: string, item_name: string) => void;
  on_select_item?: (surface: StorageSurface, slot: StorageSlot) => void;
  on_slot_hover?: (surface: StorageSurface | null, slot: StorageSlot | null) => void;
  on_drag_start?: (surface: StorageSurface, slot: StorageSlot, definition: ItemDefinition) => void;
  on_drop?: (surface: StorageSurface, slot: StorageSlot) => Promise<boolean>;
  on_drag_rejected?: () => void;
  get_highlighted_items?: () => Array<{ container_id: string; slot_index: number }>;
  get_open_container_ids?: () => Set<string>;
  get_open_container_id_for_item?: (surface: StorageSurface, slot: StorageSlot) => string | null;
};

type SlotHitbox = {
  x: number;
  y: number;
  surface: StorageSurface;
  slot: StorageSlot;
};

function draw_text(c: Canvas, x: number, y: number, text: string, rgb: Rgb, weight_index: number): void {
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += 1) {
    c.set(x + i, y, { char: chars[i] ?? " ", rgb, style: "regular", weight_index, render_index: 6 });
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function get_surface_slot_rgb(surface: StorageSurface): Rgb {
  if (surface.surface_kind === "tool") return { r: 220, g: 60, b: 60 };
  if (surface.surface_kind === "armor") return { r: 60, g: 120, b: 220 };
  if (surface.surface_kind === "garb") return { r: 60, g: 180, b: 100 };
  if (surface.surface_kind === "container") return { r: 186, g: 164, b: 108 };
  if (surface.surface_kind === "grow") return { r: 119, g: 184, b: 84 };
  return { r: 120, g: 120, b: 120 };
}

function get_group_rgb(region: string): Rgb {
  if (region === "body") return get_color_by_name("pale_gray").rgb;
  if (region === "attached_storage") return get_color_by_name("pale_orange").rgb;
  return get_color_by_name("light_gray").rgb;
}

function hex_to_rgb(hex: string): Rgb | null {
  const raw = String(hex ?? "").trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(raw);
  if (!m) return null;
  const value = m[1];
  if (!value) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function is_body_surface(surface: StorageSurface): boolean {
  return surface.display_region === "body";
}

function is_body_slot_mismatch(surface: StorageSurface, slot: StorageSlot): boolean {
  if (!is_body_surface(surface) || !slot.item) return false;
  if (surface.surface_kind === "tool") return !has_resolved_tag(slot.item as any, "TOOL");
  if (surface.surface_kind === "armor") return !has_resolved_tag(slot.item as any, "ARMOR");
  if (surface.surface_kind === "garb") return !has_resolved_tag(slot.item as any, "GARB");
  return false;
}

function is_slot_highlighted(opts: OwnerInventoryModuleConfig, slot: StorageSlot): boolean {
  const container_id = get_container_id_from_target_id(slot.slot_target_id);
  if (!container_id) return false;
  const highlighted = opts.get_highlighted_items?.() ?? [];
  return highlighted.some((entry) => entry.container_id === container_id && entry.slot_index === slot.slot_index);
}

function is_slot_selected(opts: OwnerInventoryModuleConfig, surface: StorageSurface, slot: StorageSlot): boolean {
  if (!slot.item?.is_container) return false;
  const open_ids = opts.get_open_container_ids?.();
  const open_id = opts.get_open_container_id_for_item?.(surface, slot);
  return Boolean(open_ids && open_id && open_ids.has(open_id));
}

function get_surface_rows(surface: StorageSurface): number {
  const { rows } = calculate_grid_dimensions(Math.max(1, surface.slot_count));
  return rows;
}

function get_surface_height(surface: StorageSurface): number {
  return 1 + get_surface_rows(surface);
}

function get_group_height(view: OwnerInventoryView, group_index: number): number {
  const group = view.groups[group_index];
  if (!group) return 0;
  let height = 1;
  for (const surface of group.surfaces) height += get_surface_height(surface);
  return height + 1;
}

export function make_owner_inventory_module(opts: OwnerInventoryModuleConfig): Module {
  let rect = opts.rect;
  let scroll_rows = 0;
  let hover_key: string | null = null;
  let slot_hitboxes: SlotHitbox[] = [];

  function get_content_height(view: OwnerInventoryView | null): number {
    if (!view) return 1;
    let total = 0;
    for (let i = 0; i < view.groups.length; i += 1) total += get_group_height(view, i);
    return Math.max(1, total);
  }

  function get_visible_height(current_rect: Rect): number {
    return Math.max(1, (current_rect.y1 - current_rect.y0) - 2);
  }

  function clamp_scroll(view: OwnerInventoryView | null, current_rect: Rect): void {
    const max_scroll = Math.max(0, get_content_height(view) - get_visible_height(current_rect));
    scroll_rows = clamp(scroll_rows, 0, max_scroll);
  }

  function find_slot_hitbox(x: number, y: number): SlotHitbox | null {
    return slot_hitboxes.find((entry) => entry.x === x && entry.y === y) ?? null;
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: () => {
      const view = opts.get_view();
      const name = String(view?.owner_name ?? "inventory").toUpperCase();
      return `${name.slice(0, 10)} INV`;
    },
    is_visible: opts.get_is_visible,
    background: { rgb: get_color_by_name("off_black").rgb },
    border: {
      border_rgb: get_color_by_name("light_gray").rgb,
      text_rgb: get_color_by_name("light_gray").rgb,
    },
    gizmos: {
      enabled: ["close", "move", "resize", "seamless"],
      can_close: true,
      can_move: true,
      can_save_position: false,
      on_close: () => opts.set_is_visible(false),
    },
    resize: { min_width: 24, min_height: 10, max_width: 120, max_height: 80 },
    on_pointer_move_content: (e: PointerEvent) => {
      const hit = find_slot_hitbox(e.x, e.y);
      hover_key = hit?.slot.id ?? null;
      opts.on_slot_hover?.(hit?.surface ?? null, hit?.slot ?? null);
    },
    on_pointer_leave_content: () => {
      hover_key = null;
      opts.on_slot_hover?.(null, null);
    },
    on_pointer_down_content: (e: PointerEvent) => {
      const hit = find_slot_hitbox(e.x, e.y);
      if (!hit || !hit.slot.item) return;
      opts.on_select_item?.(hit.surface, hit.slot);
      if (e.click_count === 2 && hit.slot.item.is_container) {
        opts.on_open_nested_container?.(hit.slot.item.id, hit.slot.item.name);
      }
    },
    on_drag_start_content: (e, current_rect) => {
      const hit = find_slot_hitbox(e.start_x, e.start_y);
      if (!hit || !hit.slot.item) return;
      const definition = {
        id: hit.slot.item.def_id,
        name: hit.slot.item.name,
        display_char: hit.slot.item.display_char,
        tags: hit.slot.item.tags,
        resolved_tag_states: hit.slot.item.resolved_tag_states,
        value_mag: hit.slot.item.value_mag,
      } as unknown as ItemDefinition;
      opts.on_drag_start?.(hit.surface, hit.slot, definition);
    },
    on_drag_end_content: async (e) => {
      const hit = find_slot_hitbox(e.x, e.y);
      if (!hit) {
        opts.on_drag_rejected?.();
        return;
      }
      const ok = await opts.on_drop?.(hit.surface, hit.slot);
      if (!ok) opts.on_drag_rejected?.();
    },
    on_wheel_content: (e: WheelEvent, current_rect: Rect) => {
      const view = opts.get_view();
      const delta = e.delta_y > 0 ? 3 : e.delta_y < 0 ? -3 : 0;
      scroll_rows += delta;
      clamp_scroll(view, current_rect);
    },
    draw_content(c: Canvas, current_rect: Rect): void {
      rect = current_rect;
      slot_hitboxes = [];
      const view = opts.get_view();
      clamp_scroll(view, current_rect);

      const inner_left = current_rect.x0 + 2;
      const inner_right = current_rect.x1 - 1;
      const content_top = current_rect.y1 - 2;
      const content_bottom = current_rect.y0 + 1;

      if (!view) {
        draw_text(c, inner_left, content_top, "NO INVENTORY", get_color_by_name("medium_gray").rgb, 3);
        return;
      }

      const rq: RenderRequest[] = [];
      let logical_y = 0;
      for (const group of view.groups) {
        const group_y = content_top - (logical_y - scroll_rows);
        if (group_y >= content_bottom && group_y <= content_top) {
          draw_text(c, inner_left, group_y, `[${group.contributor.name.toUpperCase()}]`, get_group_rgb(group.surfaces[0]?.display_region ?? "main"), 4);
        }
        logical_y += 1;

        for (const surface of group.surfaces) {
          const label_y = content_top - (logical_y - scroll_rows);
          if (label_y >= content_bottom && label_y <= content_top) {
            const surface_label = `${surface.label ?? surface.surface_kind}`.toUpperCase();
            draw_text(c, inner_left + 1, label_y, surface_label.slice(0, Math.max(1, inner_right - inner_left)), get_surface_slot_rgb(surface), 3);
          }
          logical_y += 1;

          const { cols, rows } = calculate_grid_dimensions(Math.max(1, surface.slot_count));
          const start_x = inner_left + 2;
          for (let row = 0; row < rows; row += 1) {
            const row_y = content_top - (logical_y - scroll_rows);
            if (row_y >= content_bottom && row_y <= content_top) {
              for (let col = 0; col < cols; col += 1) {
                const slot_index = row * cols + col;
                if (slot_index >= surface.slot_count) continue;
                const slot = surface.slots.find((entry) => entry.slot_index === slot_index);
                if (!slot) continue;
                const slot_x = start_x + (col * 2);
                if (slot_x > inner_right) continue;
                slot_hitboxes.push({ x: slot_x, y: row_y, surface, slot });
                const hovered = hover_key === slot.id;
                const highlighted = is_slot_highlighted(opts, slot);
                const selected = is_slot_selected(opts, surface, slot);
                const body_surface = is_body_surface(surface);
                const body_mismatch = is_body_slot_mismatch(surface, slot);
                if (slot.item) {
                  const item_instance = {
                    id: slot.item.id,
                    def_id: slot.item.def_id,
                    qty: slot.item.qty,
                    display_char: slot.item.display_char,
                    tags: slot.item.tags,
                    resolved_tag_states: slot.item.resolved_tag_states,
                    value_mag: slot.item.value_mag,
                  } as unknown as ItemInstance;
                  const item_definition = {
                    id: slot.item.def_id,
                    name: slot.item.name,
                    display_char: slot.item.display_char,
                    graphics: slot.item.graphics,
                    materials: slot.item.material_options,
                    tags: slot.item.tags,
                    resolved_tag_states: slot.item.resolved_tag_states,
                    value_mag: slot.item.value_mag,
                  } as unknown as ItemDefinition;
                  (item_instance as any).materials = slot.item.materials;
                  (item_instance as any).state = slot.item.state;
                  (item_instance as any).facing = slot.item.facing;
                  rq.push({
                    pass: "item",
                    x: slot_x,
                    y: row_y,
                    order: 0,
                    key: slot.item.id,
                    payload: make_item_payload(item_instance, item_definition, {
                      base_fg: hex_to_rgb(slot.item.display_color ?? "") ?? get_surface_slot_rgb(surface),
                    }) as any,
                    ctx: body_surface
                      ? ctx_character_slot({
                        hovered,
                        highlighted,
                        selected,
                        tool_mismatch: body_mismatch,
                      })
                      : ctx_container_ui({ hovered, highlighted, selected }),
                  });
                } else {
                  rq.push({
                    pass: "ui",
                    x: slot_x,
                    y: row_y,
                    order: 0,
                    key: slot.id,
                    payload: make_slot_payload({
                      id: slot.id,
                      slot_type: surface.surface_kind === "container" ? "neutral" : (surface.surface_kind as any),
                      is_placeholder: !!slot.is_placeholder,
                      base_fg: get_surface_slot_rgb(surface),
                    }) as any,
                    ctx: body_surface
                      ? ctx_character_slot({ hovered, highlighted, selected: false })
                      : ctx_container_ui({ hovered, highlighted, selected: false }),
                  });
                }
              }
            }
            logical_y += 1;
          }
        }

        logical_y += 1;
      }

      draw_render_queue(c, rq, { now_ms: Date.now(), pass_order: ["ui", "item"] });
    },
  });
}
