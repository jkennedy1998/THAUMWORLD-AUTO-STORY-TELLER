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

export type { TaggedItem, ActionCapability } from "../tag_system/index.js";
