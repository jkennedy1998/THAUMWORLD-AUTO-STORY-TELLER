// Inspection Module - Main exports
// Unified inspection system for characters, tiles, and items

// Types
export type {
  InspectionTarget,
  InspectionFeature,
  InspectionResult,
  InspectorData
} from "./data_service.js";

export type {
  SenseType,
  ClarityLevel,
  Location
} from "./clarity_system.js";

export type {
  InspectionParseResult
} from "./text_parser.js";

// Functions
export {
  inspect_target,
  format_inspection_result
} from "./data_service.js";

export {
  calculate_clarity,
  calculate_distance,
  get_best_inspection_sense,
  get_clear_range_magnitude,
  DISTANCE_MAG_TABLE
} from "./clarity_system.js";

export {
  parse_inspect_command,
  is_inspection_question,
  suggest_inspect_target
} from "./text_parser.js";
