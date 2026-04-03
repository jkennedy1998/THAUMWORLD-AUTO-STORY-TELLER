import * as fs from "node:fs";
import { parse } from "jsonc-parser";

export type TagStackingMode = "sum" | "none" | "custom";
export type TagDefinitionValueMode = "sum_dimensions" | "formula";
export type TagRuntimeProjectionKind = "table" | "formula" | "custom";
export type TagRuntimeProjectionValueType = "number" | "integer" | "dice" | "duration" | "slots" | "weight" | "custom";
export type TagSurfaceKind = "grow" | "container" | "custom";
export type TagScope = "CHARACTER" | "ITEM" | "TILE" | "TAG";

type RawTagDimensionDefinition = {
  id?: unknown;
  label?: unknown;
  default_mag?: unknown;
  min_mag?: unknown;
  max_mag?: unknown;
  description?: unknown;
  value_up_per_mag?: unknown;
  value_down_per_mag?: unknown;
  runtime_projection?: {
    kind?: unknown;
    value_type?: unknown;
    table_id?: unknown;
    formula?: unknown;
  } | null;
  value_weight?: unknown;
};

type RawTagSurfaceContribution = {
  surface_kind?: unknown;
  contributor_name?: unknown;
  projection_kind?: unknown;
};

type RawTagValueModel = {
  mode?: unknown;
  formula?: unknown;
};

type RawTagLifecycle = {
  dispersal?: {
    time_dimension_id?: unknown;
    target_dimension_id?: unknown;
    target_value?: unknown;
    step?: unknown;
    remove_on_target?: unknown;
  } | null;
  expiry?: unknown;
};

type RawTagItemStackTicker = {
  kind?: unknown;
  source?: unknown;
};

type RawTagItemStack = {
  presence?: unknown;
  dimensions_match?: unknown;
  info_match?: unknown;
  merge_quantity?: unknown;
  ticker?: RawTagItemStackTicker | null;
};

type RawTagDefinition = {
  name?: unknown;
  proficiency?: unknown;
  base_tag_value_mag?: unknown;
  quantity_dimension_id?: unknown;
  editor_visible?: unknown;
  meta?: unknown;
  stacking?: unknown;
  scope?: unknown;
  requires_info?: unknown;
  info_schema?: unknown;
  triggers?: unknown;
  effects?: unknown;
  dimensions?: unknown;
  value_model?: unknown;
  contributes_surfaces?: unknown;
  lifecycle?: unknown;
  item_stack?: unknown;
};

type RawTagDefinitionsFile = {
  tags?: RawTagDefinition[];
};

export type NormalizedRuntimeProjection = {
  kind: TagRuntimeProjectionKind;
  value_type: TagRuntimeProjectionValueType;
  table_id: string | null;
  formula: string | null;
};

export type NormalizedTagDimensionDefinition = {
  id: string;
  label: string;
  default_mag: number;
  min_mag: number | null;
  max_mag: number | null;
  description: string | null;
  value_up_per_mag: number;
  value_down_per_mag: number;
  runtime_projection: NormalizedRuntimeProjection | null;
  value_weight: number;
};

export type NormalizedTagSurfaceContribution = {
  surface_kind: TagSurfaceKind;
  contributor_name: string;
  projection_kind: "definition" | "custom";
};

export type NormalizedTagValueModel = {
  mode: TagDefinitionValueMode;
  formula: string | null;
};

export type NormalizedTagDispersal = {
  time_dimension_id: string;
  target_dimension_id: string;
  target_value: number;
  step: number;
  remove_on_target: boolean;
};

export type NormalizedTagLifecycle = {
  dispersal: NormalizedTagDispersal | null;
  expiry: boolean;
};

export type TagItemStackPresence = "exact_match" | "both_required" | "either_allowed";
export type TagItemStackMatchMode = "exact" | "exact_except_quantity" | "ignore";
export type TagItemStackMergeQuantity = "preserve" | "sum" | "min" | "max";
export type TagItemStackTickerKind = "none" | "average" | "minimum" | "inherit_present_side";
export type TagItemStackTickerSource = "item_last_breath_processed" | "tag_lifecycle";

export type NormalizedTagItemStackTicker = {
  kind: TagItemStackTickerKind;
  source: TagItemStackTickerSource;
};

export type NormalizedTagItemStack = {
  presence: TagItemStackPresence;
  dimensions_match: TagItemStackMatchMode;
  info_match: TagItemStackMatchMode;
  merge_quantity: TagItemStackMergeQuantity;
  ticker: NormalizedTagItemStackTicker;
};

export type NormalizedTagDefinition = {
  name: string;
  proficiency: string | null;
  base_tag_value_mag: number;
  quantity_dimension_id: string | null;
  editor_visible: boolean;
  meta: string[];
  stacking: TagStackingMode;
  scope: TagScope[];
  requires_info: boolean;
  info_schema: string[];
  triggers: string[];
  effects: unknown[];
  dimensions: NormalizedTagDimensionDefinition[];
  value_model: NormalizedTagValueModel;
  contributes_surfaces: NormalizedTagSurfaceContribution[];
  lifecycle: NormalizedTagLifecycle;
  item_stack: NormalizedTagItemStack;
};

let cached_mtime_ms = -1;
let cached_definitions = new Map<string, NormalizedTagDefinition>();

function get_tag_definitions_path(): string {
  if (typeof process === "undefined" || typeof process.cwd !== "function") {
    return "";
  }
  return `${process.cwd()}\\local_data\\data_slot_default\\tag_definitions.jsonc`;
}

function normalize_stacking(value: unknown): TagStackingMode {
  const raw = String(value ?? "sum").trim().toLowerCase();
  if (raw === "none" || raw === "never" || raw === "no_stack") return "none";
  if (raw === "custom") return "custom";
  return "sum";
}

function normalize_scope(value: unknown): TagScope[] {
  const values = Array.isArray(value) ? value : [];
  const out: TagScope[] = [];
  const seen = new Set<string>();
  for (const entry of values) {
    const scope = String(entry ?? "").trim().toUpperCase();
    if (scope !== "CHARACTER" && scope !== "ITEM" && scope !== "TILE" && scope !== "TAG") continue;
    if (seen.has(scope)) continue;
    seen.add(scope);
    out.push(scope);
  }
  return out;
}

function normalize_string_array(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const next = String(entry ?? "").trim();
    if (!next) continue;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

function normalize_integer(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function normalize_optional_integer(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function normalize_runtime_projection(value: unknown): NormalizedRuntimeProjection | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as RawTagDimensionDefinition["runtime_projection"];
  const kind_raw = String(raw?.kind ?? "").trim().toLowerCase();
  const value_type_raw = String(raw?.value_type ?? "").trim().toLowerCase();
  const kind: TagRuntimeProjectionKind = kind_raw === "table" || kind_raw === "formula" || kind_raw === "custom"
    ? kind_raw
    : "custom";
  const value_type: TagRuntimeProjectionValueType = (
    value_type_raw === "number"
    || value_type_raw === "integer"
    || value_type_raw === "dice"
    || value_type_raw === "duration"
    || value_type_raw === "slots"
    || value_type_raw === "weight"
    || value_type_raw === "custom"
  ) ? value_type_raw : "custom";
  const table_id = typeof raw?.table_id === "string" ? raw.table_id.trim() || null : null;
  const formula = typeof raw?.formula === "string" ? raw.formula.trim() || null : null;
  return { kind, value_type, table_id, formula };
}

function normalize_dimensions(value: unknown): NormalizedTagDimensionDefinition[] {
  if (!Array.isArray(value)) return [];
  const out: NormalizedTagDimensionDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const raw = (entry ?? null) as RawTagDimensionDefinition | null;
    const id = String(raw?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = typeof raw?.label === "string" && raw.label.trim().length > 0 ? raw.label.trim() : id;
    out.push({
      id,
      label,
      default_mag: normalize_integer(raw?.default_mag, 0),
      min_mag: normalize_optional_integer(raw?.min_mag),
      max_mag: normalize_optional_integer(raw?.max_mag),
      description: typeof raw?.description === "string" ? raw.description.trim() || null : null,
      value_up_per_mag: Number.isFinite(Number(raw?.value_up_per_mag))
        ? Number(raw?.value_up_per_mag)
        : (Number.isFinite(Number(raw?.value_weight)) ? Number(raw?.value_weight) : 1),
      value_down_per_mag: Number.isFinite(Number(raw?.value_down_per_mag))
        ? Number(raw?.value_down_per_mag)
        : -(Number.isFinite(Number(raw?.value_weight)) ? Number(raw?.value_weight) : 1),
      runtime_projection: normalize_runtime_projection(raw?.runtime_projection),
      value_weight: Number.isFinite(Number(raw?.value_weight)) ? Number(raw?.value_weight) : 1,
    });
  }
  return out;
}

function normalize_value_model(value: unknown): NormalizedTagValueModel {
  const raw = (value ?? null) as RawTagValueModel | null;
  const mode_raw = String(raw?.mode ?? "sum_dimensions").trim().toLowerCase();
  const mode: TagDefinitionValueMode = mode_raw === "formula" ? "formula" : "sum_dimensions";
  const formula = typeof raw?.formula === "string" ? raw.formula.trim() || null : null;
  return { mode, formula };
}

function normalize_surface_contributions(value: unknown): NormalizedTagSurfaceContribution[] {
  if (!Array.isArray(value)) return [];
  const out: NormalizedTagSurfaceContribution[] = [];
  for (const entry of value) {
    const raw = (entry ?? null) as RawTagSurfaceContribution | null;
    const surface_raw = String(raw?.surface_kind ?? "").trim().toLowerCase();
    const projection_raw = String(raw?.projection_kind ?? "definition").trim().toLowerCase();
    const contributor_name = typeof raw?.contributor_name === "string" ? raw.contributor_name.trim() : "";
    const surface_kind: TagSurfaceKind = surface_raw === "grow" || surface_raw === "container" || surface_raw === "custom"
      ? surface_raw
      : "custom";
    const projection_kind: "definition" | "custom" = projection_raw === "custom" ? "custom" : "definition";
    if (!contributor_name) continue;
    out.push({ surface_kind, contributor_name, projection_kind });
  }
  return out;
}

function normalize_lifecycle(value: unknown): NormalizedTagLifecycle {
  const raw = (value ?? null) as RawTagLifecycle | null;
  const dispersal_raw = raw?.dispersal;
  const time_dimension_id = typeof dispersal_raw?.time_dimension_id === "string" ? dispersal_raw.time_dimension_id.trim() : "";
  const target_dimension_id = typeof dispersal_raw?.target_dimension_id === "string" ? dispersal_raw.target_dimension_id.trim() : "";
  const target_value = normalize_integer(dispersal_raw?.target_value, 0);
  const step = Math.max(1, normalize_integer(dispersal_raw?.step, 1));
  const remove_on_target = typeof dispersal_raw?.remove_on_target === "boolean" ? dispersal_raw.remove_on_target : true;
  const dispersal = time_dimension_id && target_dimension_id
    ? { time_dimension_id, target_dimension_id, target_value, step, remove_on_target }
    : null;
  const expiry = typeof raw?.expiry === "boolean" ? raw.expiry : false;
  return { dispersal, expiry };
}

function normalize_item_stack(value: unknown): NormalizedTagItemStack {
  const raw = (value ?? null) as RawTagItemStack | null;
  const presence_raw = String(raw?.presence ?? "exact_match").trim().toLowerCase();
  const dimensions_raw = String(raw?.dimensions_match ?? "exact").trim().toLowerCase();
  const info_raw = String(raw?.info_match ?? "exact").trim().toLowerCase();
  const merge_raw = String(raw?.merge_quantity ?? "preserve").trim().toLowerCase();
  const ticker_raw = (raw?.ticker ?? null) as RawTagItemStackTicker | null;
  const ticker_kind_raw = String(ticker_raw?.kind ?? "none").trim().toLowerCase();
  const ticker_source_raw = String(ticker_raw?.source ?? "tag_lifecycle").trim().toLowerCase();
  return {
    presence: presence_raw === "both_required" || presence_raw === "either_allowed" ? presence_raw : "exact_match",
    dimensions_match: dimensions_raw === "ignore" || dimensions_raw === "exact_except_quantity" ? dimensions_raw : "exact",
    info_match: info_raw === "ignore" || info_raw === "exact_except_quantity" ? info_raw : "exact",
    merge_quantity: merge_raw === "sum" || merge_raw === "min" || merge_raw === "max" ? merge_raw : "preserve",
    ticker: {
      kind: ticker_kind_raw === "average" || ticker_kind_raw === "minimum" || ticker_kind_raw === "inherit_present_side"
        ? ticker_kind_raw
        : "none",
      source: ticker_source_raw === "item_last_breath_processed" ? "item_last_breath_processed" : "tag_lifecycle",
    },
  };
}

function normalize_tag_definition(entry: RawTagDefinition): NormalizedTagDefinition | null {
  const name = String(entry?.name ?? "").trim().toUpperCase();
  if (!name) return null;
  const meta = normalize_string_array(entry?.meta).map((item) => item.toUpperCase());
  return {
    name,
    proficiency: typeof entry?.proficiency === "string" ? entry.proficiency.trim() || null : null,
    base_tag_value_mag: normalize_integer(entry?.base_tag_value_mag, 0),
    quantity_dimension_id: typeof entry?.quantity_dimension_id === "string" ? entry.quantity_dimension_id.trim() || null : null,
    editor_visible: typeof entry?.editor_visible === "boolean" ? entry.editor_visible : true,
    meta,
    stacking: normalize_stacking(entry?.stacking),
    scope: normalize_scope(entry?.scope),
    requires_info: Boolean(entry?.requires_info),
    info_schema: normalize_string_array(entry?.info_schema),
    triggers: normalize_string_array(entry?.triggers),
    effects: Array.isArray(entry?.effects) ? entry.effects : [],
    dimensions: normalize_dimensions(entry?.dimensions),
    value_model: normalize_value_model(entry?.value_model),
    contributes_surfaces: normalize_surface_contributions(entry?.contributes_surfaces),
    lifecycle: normalize_lifecycle(entry?.lifecycle),
    item_stack: normalize_item_stack(entry?.item_stack),
  };
}

function load_tag_definitions_map(): Map<string, NormalizedTagDefinition> {
  const pathname = get_tag_definitions_path();
  if (!pathname) return cached_definitions;
  try {
    const stat = fs.statSync(pathname);
    if (stat.mtimeMs === cached_mtime_ms && cached_definitions.size > 0) return cached_definitions;
    const raw = fs.readFileSync(pathname, "utf-8");
    const parsed = (parse(raw) as RawTagDefinitionsFile | null) ?? null;
    const next = new Map<string, NormalizedTagDefinition>();
    for (const entry of Array.isArray(parsed?.tags) ? parsed.tags : []) {
      const normalized = normalize_tag_definition(entry);
      if (!normalized) continue;
      next.set(normalized.name, normalized);
    }
    cached_mtime_ms = stat.mtimeMs;
    cached_definitions = next;
    return cached_definitions;
  } catch {
    return cached_definitions;
  }
}

export function get_tag_definition(tag_name: string): NormalizedTagDefinition | null {
  const definitions = load_tag_definitions_map();
  return definitions.get(String(tag_name ?? "").trim().toUpperCase()) ?? null;
}

export function list_tag_definitions(): NormalizedTagDefinition[] {
  return Array.from(load_tag_definitions_map().values());
}

export function get_tag_stacking_mode(tag_name: string): TagStackingMode {
  return get_tag_definition(tag_name)?.stacking ?? "sum";
}

export function tag_stacks_by_rule(tag_name: string): boolean {
  return get_tag_stacking_mode(tag_name) === "sum";
}

export function get_tag_item_stack(tag_name: string): NormalizedTagItemStack {
  return get_tag_definition(tag_name)?.item_stack ?? normalize_item_stack(null);
}

export function is_tag_editor_visible(tag_name: string): boolean {
  return get_tag_definition(tag_name)?.editor_visible ?? true;
}
