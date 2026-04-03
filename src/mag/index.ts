export { normalize_signed_mag, normalize_nonnegative_mag, clamp_mag } from "./core.js";
export { get_damage_dice_from_mag } from "./damage.js";
export { calculate_weight_mag } from "./weight.js";
export {
  CONTAINER_DEFAULT_CAPACITY_MAG,
  CONTAINER_MIN_CAPACITY_MAG,
  project_container_max_slots,
  resolve_container_capacity_mag_from_states,
} from "./container.js";
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
  SIZE_MAG_BANDS,
  normalize_size_mag,
  get_size_mag_label,
  get_max_stack_size_from_size_mag,
  is_size_mag_stackable,
  type SizeMagBand,
} from "./size.js";
export {
  DISPERSE_DEFAULT_PERIOD_BREATHS,
  DISPERSE_MAX_EVENTS_PER_PULSE,
  project_disperse_period_breaths,
  SPOIL_DEFAULT_PERIOD_BREATHS,
  project_spoil_period_breaths,
} from "./lifecycle.js";
export { compute_dimension_value_delta } from "./value.js";
export { timed_event_stat_to_bps } from "./timed_event.js";
