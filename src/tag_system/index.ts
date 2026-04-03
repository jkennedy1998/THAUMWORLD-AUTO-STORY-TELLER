// Tag System - Index
// Exports all tag system functionality

export type { TagInstance } from "./registry.js";

export {
  get_tag_definition,
  list_tag_definitions,
  get_tag_stacking_mode,
  tag_stacks_by_rule,
  type TagStackingMode,
  type TagDefinitionValueMode,
  type TagRuntimeProjectionKind,
  type TagRuntimeProjectionValueType,
  type TagSurfaceKind,
  type TagScope,
  type NormalizedRuntimeProjection,
  type NormalizedTagDimensionDefinition,
  type NormalizedTagSurfaceContribution,
  type NormalizedTagValueModel,
  type NormalizedTagLifecycle,
  type NormalizedTagDefinition,
} from "./definitions.js";

export {
  resolve_tag_state,
  resolve_tag_state_from_instance,
  resolve_tag_states_from_instances,
  resolve_tag_states,
  get_tag_dim_mag,
  get_tag_value_mag,
  project_tag_runtime_value,
  type ResolvedTagState,
} from "./resolved.js";

export {
  GROW_DEFAULT_PERIOD_BREATHS,
  GROW_MAX_EVENTS_PER_PULSE,
  GROW_DEFAULT_MAX_SLOTS,
  GROW_DEFAULT_YIELD_QTY,
  build_grow_tag_config,
  resolve_grow_tag_config_from_instance,
  resolve_grow_tag_configs,
  type GrowTagConfig,
} from "./grow.js";

export {
  CONTAINER_DEFAULT_CAPACITY_MAG,
  CONTAINER_MIN_CAPACITY_MAG,
  project_container_max_slots,
  resolve_container_capacity_mag_from_states,
} from "./container.js";

export {
  build_spoils_tag_config,
  resolve_spoils_tag_config_from_instance,
  resolve_spoils_tag_config_from_states,
  resolve_spoils_tag_config_from_tags,
  type SpoilsTagConfig,
} from "./spoils.js";

export {
  get_entity_base_value_mag,
  get_entity_tag_value_mag,
  get_entity_total_value_mag,
  build_entity_value_mag_breakdown,
  type EntityValueMagBreakdown,
} from "./value.js";

export {
  get_resolved_tag_states_from_entity,
  get_resolved_tag_state,
  get_resolved_tag_stored_mag,
  has_resolved_tag,
  get_status_effect_names,
  has_awareness_target,
} from "./canonical_readers.js";
