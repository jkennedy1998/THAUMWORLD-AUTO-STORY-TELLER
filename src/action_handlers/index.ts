// Action Handlers - Index
// Core action implementations for Phase 3, 4 & 5

export {
  // Main router
  handleAction,
  
  // Individual handlers
  handleCommunicate,
  handleMove,
  handleImpactSingle,
  handleProjectileSingle,
  handleInspect,

  // Utilities
  calculateScatterLocation,
  getBestSenseForDistance,
  calculateInspectRange,
  isInspectable,
  formatInspectRange,
  
  // Effector integration (Phase 5)
  applyEffectorsToAction,
  
  // Types
  type ActionContext,
  type ActionResult,
  type ActionEffect,
  type ProjectileResult
} from "./core.js";

export { get_damage_dice_from_mag as getDamageDice } from "../mag/damage.js";
