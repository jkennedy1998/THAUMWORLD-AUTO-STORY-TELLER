import { tagRegistry, type TagAction, type TagRule, type TaggedItem } from "./registry.js";
import { get_resolved_tag_stored_mag } from "./canonical_readers.js";
import { calculate_weight_mag } from "../mag/weight.js";

export interface ActionCapability {
  action_type: string;
  range: {
    category: string;
    base: number;
    effective: number;
  };
  damage?: {
    formula: string;
    base_mag: number;
    bonus_mag: number;
  };
  proficiencies: string[];
  ammo_requirement: {
    tag?: string;
    tag_value?: string;
  } | null;
  source_tag: string;
  runtime: {
    action_cost: "FREE" | "PARTIAL" | "FULL" | "EXTENDED" | null;
    requires_result_roll: boolean;
    requires_potency_roll: boolean;
    potency_on_hit_only: boolean;
    result_against: "evasion" | "distance" | "none";
    auto_hit_target_types: Array<"item" | "tile" | "place_tile">;
    potency_source: "tool" | "tool_plus_ammo" | "none";
  };
}

export interface AmmoCompatibility {
  compatible: boolean;
  reason?: string;
}

export interface ThrowValidation {
  can_throw: boolean;
  reason?: string;
  max_range: number;
}

function normalize_tag_name(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function get_item_tag_power(item: TaggedItem, tag_name: string): number {
  const resolved = get_resolved_tag_stored_mag(item as any, tag_name);
  if (resolved > 0) return resolved;
  const raw = Array.isArray(item.tags)
    ? item.tags.find((tag) => normalize_tag_name(tag?.name) === normalize_tag_name(tag_name))
    : null;
  return raw ? Math.max(0, Math.floor(Number(raw.mag ?? 0) || 0)) : 0;
}

function calculate_bonus_mag(rule: TagRule, stacks: number): number {
  if (!rule.scaling?.per_stack) return 0;
  let bonus = 0;
  if (rule.scaling.per_stack.damage) bonus += (stacks - 1) * rule.scaling.per_stack.damage;
  return bonus;
}

function calculate_effective_range(base_range: number, rule: TagRule, stacks: number): number {
  let range = base_range;
  if (rule.scaling?.per_stack?.range) {
    range += (stacks - 1) * rule.scaling.per_stack.range;
  }
  return range;
}

function get_default_runtime_for_action(action_type: string): ActionCapability["runtime"] {
  if (action_type === "USE.IMPACT_SINGLE") {
    return {
      action_cost: null,
      requires_result_roll: true,
      requires_potency_roll: true,
      potency_on_hit_only: true,
      result_against: "evasion",
      auto_hit_target_types: ["item", "tile", "place_tile"],
      potency_source: "tool",
    };
  }
  if (action_type === "USE.PROJECTILE_SINGLE") {
    return {
      action_cost: null,
      requires_result_roll: true,
      requires_potency_roll: true,
      potency_on_hit_only: true,
      result_against: "distance",
      auto_hit_target_types: [],
      potency_source: "tool_plus_ammo",
    };
  }
  if (action_type === "USE.TRANSFER_ITEM") {
    return {
      action_cost: null,
      requires_result_roll: false,
      requires_potency_roll: false,
      potency_on_hit_only: false,
      result_against: "none",
      auto_hit_target_types: [],
      potency_source: "none",
    };
  }
  if (action_type === "USE.EQUIP_ITEM") {
    return {
      action_cost: "PARTIAL",
      requires_result_roll: false,
      requires_potency_roll: false,
      potency_on_hit_only: false,
      result_against: "none",
      auto_hit_target_types: [],
      potency_source: "none",
    };
  }
  return {
    action_cost: null,
    requires_result_roll: false,
    requires_potency_roll: false,
    potency_on_hit_only: false,
    result_against: "none",
    auto_hit_target_types: [],
    potency_source: "none",
  };
}

function build_action_capability(source_tag: string, rule: TagRule, action: TagAction, tag_power: number): ActionCapability {
  const runtime_defaults = get_default_runtime_for_action(action.action_type);
  return {
    action_type: action.action_type,
    range: {
      category: action.range_category,
      base: action.base_range,
      effective: calculate_effective_range(action.base_range, rule, tag_power),
    },
    damage: {
      formula: action.damage_formula,
      base_mag: tag_power,
      bonus_mag: calculate_bonus_mag(rule, tag_power),
    },
    proficiencies: action.proficiencies,
    ammo_requirement: action.requirements || null,
    source_tag,
    runtime: {
      action_cost: action.runtime?.action_cost ?? runtime_defaults.action_cost,
      requires_result_roll: action.runtime?.requires_result_roll ?? runtime_defaults.requires_result_roll,
      requires_potency_roll: action.runtime?.requires_potency_roll ?? runtime_defaults.requires_potency_roll,
      potency_on_hit_only: action.runtime?.potency_on_hit_only ?? runtime_defaults.potency_on_hit_only,
      result_against: action.runtime?.result_against ?? runtime_defaults.result_against,
      auto_hit_target_types: Array.isArray(action.runtime?.auto_hit_target_types) ? action.runtime!.auto_hit_target_types as any : runtime_defaults.auto_hit_target_types,
      potency_source: action.runtime?.potency_source ?? runtime_defaults.potency_source,
    },
  };
}

export function get_enabled_actions(item: TaggedItem): ActionCapability[] {
  const capabilities: ActionCapability[] = [];
  for (const tag of item.tags) {
    const rule = tagRegistry.get(tag.name);
    if (!rule) continue;
    const tag_power = Math.max(1, get_item_tag_power(item, tag.name));
    for (const action of rule.actions) {
      capabilities.push(build_action_capability(tag.name, rule, action, tag_power));
    }
  }
  return capabilities;
}

export function get_action_capability(item: TaggedItem, action_type: string): ActionCapability | null {
  return get_enabled_actions(item).find((entry) => entry.action_type === action_type) ?? null;
}

export function check_ammo_compatibility(tool: TaggedItem, ammo: TaggedItem, action_type: string = "USE.PROJECTILE_SINGLE"): AmmoCompatibility {
  const capability = get_action_capability(tool, action_type);
  if (!capability) {
    return { compatible: false, reason: `Tool does not support ${action_type}` };
  }
  if (capability.ammo_requirement === null) return { compatible: true };
  const req = capability.ammo_requirement;
  const has_required_tag = ammo.tags.some((tag) => {
    if (normalize_tag_name(tag.name) !== normalize_tag_name(req.tag)) return false;
    if (req.tag_value) {
      const info = Array.isArray(tag.info) ? tag.info : [];
      return info.some((entry) => String(entry ?? "") === req.tag_value);
    }
    return true;
  });
  return has_required_tag
    ? { compatible: true }
    : { compatible: false, reason: `Requires ${req.tag}${req.tag_value ? ":" + req.tag_value : ""} ammunition` };
}

function get_default_hand(): TaggedItem {
  return {
    ref: "body.hand",
    name: "Hand",
    weight: 0,
    tags: [{ name: "hand", mag: 1, meta: [] }],
  };
}

export function validate_throw(thrower_str: number, item: TaggedItem, tool?: TaggedItem): ThrowValidation {
  const weight_mag = calculate_weight_mag(item.weight ?? 0);
  const required_str = Math.max(0, weight_mag - 2);
  if (thrower_str < required_str) {
    return {
      can_throw: false,
      reason: `Too heavy (requires STR ${required_str}, have ${thrower_str})`,
      max_range: 0,
    };
  }
  const capability = get_action_capability(tool || get_default_hand(), "USE.PROJECTILE_SINGLE");
  if (!capability) {
    return { can_throw: false, reason: "No throwing capability", max_range: 0 };
  }
  const base_range = capability.range.base;
  const max_range = Math.floor(base_range * (thrower_str / Math.max(1, weight_mag)));
  return { can_throw: true, max_range };
}
