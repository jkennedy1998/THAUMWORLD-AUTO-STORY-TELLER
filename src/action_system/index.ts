// Action System Module - Main exports
// Unified action system for both Players and NPCs

// Registry exports
export {
  ACTION_REGISTRY,
  getActionDefinition,
  isValidTargetType,
  getDefaultCost,
  requiresTool,
  getPerceptionRadius,
  isObservable,
  getActionsByCategory,
  getObservableActions,
  type TargetType,
  type ActionCategory,
  type PerceptibilityConfig,
  type ActionDefinition
} from "./registry.js";

// Intent exports
export {
  createIntent,
  createPlayerIntent,
  createNPCIntent,
  createReactionIntent,
  markIntentFailed,
  markIntentStageComplete,
  setIntentStage,
  isIntentValid,
  canIntentProceed,
  createActionResult,
  createActionEffect,
  type ActionIntent,
  type ActionResult,
  type ActionEffect,
  type Location,
  type IntentStatus,
  type IntentSource
} from "./intent.js";

// Target resolution exports
export {
  parseMentionTarget,
  calculateDistance,
  validateTarget,
  resolveImpliedTarget,
  resolveTarget,
  getAvailableTargets,
  checkAwareness,
  type TargetResolutionContext,
  type AvailableTarget,
  type TargetResolutionResult,
  type TargetValidationResult
} from "./target_resolution.js";

// Perception exports
export {
  checkPerception,
  broadcastPerception,
  perceptionMemory,
  getRecentPerceptions,
  shouldReactToEvent,
  type PerceptionEvent,
  type PerceptionEventType,
  type PerceptionClarity,
  type PerceptionDetails,
  type SenseType
} from "./perception.js";

// Pipeline exports
export {
  ActionPipeline,
  createActionPipeline,
  processBatch,
  DEFAULT_PIPELINE_CONFIG,
  type PipelineStage,
  type PipelineConfig,
  type PipelineDependencies
} from "./pipeline.js";
