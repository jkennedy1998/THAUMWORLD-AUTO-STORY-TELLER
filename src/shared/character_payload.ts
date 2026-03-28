import { resolve_inline_item } from "../item_storage/resolve.js";

function patch_inline_item_for_api(item: any): void {
  if (!item || typeof item !== "object") return;
  const def_id = typeof item.def_id === "string" ? item.def_id : "";
  const resolved = def_id ? resolve_inline_item(def_id, item as any) : null;
  if (resolved) {
    item.name = resolved.name;
    item.weight = resolved.unit_weight;
    item.tags = resolved.effective_tags;
    item.display_char = resolved.display_char;
    if (resolved.display_color) item.display_color = resolved.display_color;
    item.__derived_runtime = true;
  }
  if (Array.isArray(item.contents)) {
    for (const child of item.contents) patch_inline_item_for_api(child);
  }
}

export function augment_inline_character_items_for_api(character: any): void {
  if (!character || typeof character !== "object") return;

  const body_slots = character.body_slots;
  if (body_slots && typeof body_slots === "object") {
    for (const value of Object.values(body_slots)) {
      const slot: any = value as any;
      if (!slot || typeof slot !== "object") continue;
      patch_inline_item_for_api(slot.armor);
      patch_inline_item_for_api(slot.tool);
      if (Array.isArray(slot.garb)) {
        for (const item of slot.garb) patch_inline_item_for_api(item);
      }
    }
  }

  const equipped_items = character.equipped_items;
  if (equipped_items && typeof equipped_items === "object") {
    for (const value of Object.values(equipped_items)) {
      patch_inline_item_for_api(value);
    }
  }
}
