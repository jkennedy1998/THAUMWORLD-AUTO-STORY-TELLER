// Tool System Module - Main exports
// Unified tool validation and resolution system using tag system

export {
  validateToolRequirement,
  canPerformAction,
  getActionTool,
  validateAmmo,
  validateThrow,
  getEnabledActions,
  formatValidationResult,
  type ToolValidationResult
} from "./tool_validator.js";

export type { TaggedItem } from "../tag_system/registry.js";
export type { ActionCapability } from "../tag_system/capabilities.js";
