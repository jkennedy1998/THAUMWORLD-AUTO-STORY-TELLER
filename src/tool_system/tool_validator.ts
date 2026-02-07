// Tool System - Validator
// Validates that actors have required tools for actions using the tag resolver

import type { ActionVerb } from "../shared/constants.js";
import {
  TagResolver,
  tagRegistry,
  initializeDefaultRules,
  type TaggedItem,
  type ActionCapability,
  type TagInstance
} from "../tag_system/index.js";

// Initialize default rules
initializeDefaultRules();

// Create resolver instance
const resolver = new TagResolver(tagRegistry);

/**
 * Actor interface for validation
 * Supports both old format (string tags) and new format (TagInstance)
 */
interface Actor {
  ref: string;
  body_slots?: Record<string, { 
    name: string; 
    critical?: boolean; 
    item?: string | TaggedItem | any
  }>;
  hand_slots?: Record<string, string | TaggedItem | any>;
  inventory?: Record<string, unknown>;
}

/**
 * Convert legacy item format to TaggedItem
 */
function convertToTaggedItem(item: any): TaggedItem | null {
  if (!item || typeof item !== "object") return null;
  
  // Already in new format
  if (item.tags && Array.isArray(item.tags) && item.tags.length > 0 && typeof item.tags[0] === "object") {
    return item as TaggedItem;
  }
  
  // Convert old format (tags: string[]) to new format
  if (item.tags && Array.isArray(item.tags) && (item.tags.length === 0 || typeof item.tags[0] === "string")) {
    return {
      ref: item.ref || "unknown",
      name: item.name || "Unknown",
      weight: item.weight || 0,
      tags: (item.tags as string[]).map((tagName: string) => ({
        name: tagName,
        stacks: 1
      })),
      mag: item.mag
    };
  }
  
  // Minimal conversion
  return {
    ref: item.ref || "unknown",
    name: item.name || "Unknown",
    weight: item.weight || 0,
    tags: [],
    mag: item.mag
  };
}

/**
 * Tool validation result
 */
export interface ToolValidationResult {
  valid: boolean;
  tool?: {
    tool_ref: string;
    item: TaggedItem;
    slot: string;
    capability: ActionCapability;
  };
  error?: string;
  missing_requirement?: string;
  available_slots?: string[];
}

/**
 * Action subtype mapping to full action type
 */
function getFullActionType(
  actionType: ActionVerb, 
  subtype?: string
): string {
  if (subtype) {
    return `${actionType}.${subtype}`;
  }
  return actionType;
}

/**
 * Validate that an actor has the required tool for an action
 * 
 * Uses the tag resolver system to check if equipped tool supports the action
 * 
 * @param actor - The actor performing the action
 * @param actionType - The type of action (e.g., "USE", "COMMUNICATE")
 * @param actionSubtype - Optional subtype (e.g., "IMPACT_SINGLE", "WHISPER")
 * @returns Validation result with tool info if valid
 */
export function validateToolRequirement(
  actor: Actor,
  actionType: ActionVerb,
  actionSubtype?: string
): ToolValidationResult {
  const fullActionType = getFullActionType(actionType, actionSubtype);
  
  // Check equipped items in hand slots
  const equippedTools = getEquippedTools(actor);
  
  for (const equipped of equippedTools) {
    const capability = resolver.getActionCapability(equipped.item, fullActionType);
    
    if (capability) {
      // Tool supports this action
      return {
        valid: true,
        tool: {
          tool_ref: `${actor.ref}.${equipped.slot}`,
          item: equipped.item,
          slot: equipped.slot,
          capability
        }
      };
    }
  }
  
  // No valid tool found
  return {
    valid: false,
    error: `No tool equipped that supports ${fullActionType}`,
    missing_requirement: `Equip a tool with ${fullActionType} capability`,
    available_slots: getAvailableSlots(actor)
  };
}

/**
 * Get all equipped tools from actor
 */
function getEquippedTools(actor: Actor): Array<{ slot: string; item: TaggedItem }> {
  const tools: Array<{ slot: string; item: TaggedItem }> = [];
  
  // Check hand slots
  if (actor.hand_slots) {
    for (const [slotName, item] of Object.entries(actor.hand_slots)) {
      if (typeof item === "object" && item !== null) {
        // Convert to TaggedItem (handles both old and new formats)
        const taggedItem = convertToTaggedItem(item);
        if (taggedItem) {
          tools.push({ 
            slot: `hand_slots.${slotName}`, 
            item: taggedItem
          });
        }
      }
    }
  }
  
  // Check body slots for equipped items
  if (actor.body_slots) {
    for (const [slotName, slotData] of Object.entries(actor.body_slots)) {
      if (typeof slotData === "object" && slotData !== null) {
        if (typeof slotData.item === "object" && slotData.item !== null) {
          // Convert to TaggedItem (handles both old and new formats)
          const taggedItem = convertToTaggedItem(slotData.item);
          if (taggedItem) {
            tools.push({ 
              slot: `body_slots.${slotName}`, 
              item: taggedItem
            });
          }
        }
      }
    }
  }
  
  // Default: hands can always be used
  if (tools.length === 0) {
    tools.push({
      slot: "hand_slots.default",
      item: {
        ref: `${actor.ref}.hand`,
        name: "Hand",
        weight: 0,
        tags: [{ name: "hand", stacks: 1 }]
      }
    });
  }
  
  return tools;
}

/**
 * Get list of available body slots for an actor
 */
function getAvailableSlots(actor: Actor): string[] {
  const slots: string[] = [];
  
  if (actor.body_slots) {
    slots.push(...Object.keys(actor.body_slots).map(k => `body_slots.${k}`));
  }
  
  if (actor.hand_slots) {
    slots.push(...Object.keys(actor.hand_slots).map(k => `hand_slots.${k}`));
  }
  
  return slots;
}

/**
 * Check if an action can be performed (quick check)
 * 
 * @param actor - The actor
 * @param actionType - Action type
 * @param actionSubtype - Optional subtype
 * @returns True if actor can perform action
 */
export function canPerformAction(
  actor: Actor,
  actionType: ActionVerb,
  actionSubtype?: string
): boolean {
  const result = validateToolRequirement(actor, actionType, actionSubtype);
  return result.valid;
}

/**
 * Get the resolved tool for an action
 * Returns null if no tool required or not found
 */
export function getActionTool(
  actor: Actor,
  actionType: ActionVerb,
  actionSubtype?: string
): TaggedItem | null {
  const result = validateToolRequirement(actor, actionType, actionSubtype);
  return result.tool?.item || null;
}

/**
 * Validate ammo compatibility for projectile actions
 * 
 * @param actor - The actor (has equipped tool)
 * @param ammo - The ammunition item
 * @param actionType - Usually "USE"
 * @param actionSubtype - Usually "PROJECTILE_SINGLE"
 * @returns Validation result
 */
export function validateAmmo(
  actor: Actor,
  ammo: TaggedItem,
  actionType: ActionVerb = "USE",
  actionSubtype: string = "PROJECTILE_SINGLE"
): { valid: boolean; reason?: string } {
  const fullActionType = getFullActionType(actionType, actionSubtype);
  
  // Get equipped tool
  const equippedTools = getEquippedTools(actor);
  
  for (const equipped of equippedTools) {
    const compatibility = resolver.checkAmmoCompatibility(
      equipped.item,
      ammo,
      fullActionType
    );
    
    if (compatibility.compatible) {
      return { valid: true };
    }
    
    // If this tool supports the action but ammo is incompatible
    const capability = resolver.getActionCapability(equipped.item, fullActionType);
    if (capability && !compatibility.compatible) {
      return { 
        valid: false, 
        reason: compatibility.reason 
      };
    }
  }
  
  return { 
    valid: false, 
    reason: `No tool equipped for ${fullActionType}` 
  };
}

/**
 * Validate throw capability for an item
 * 
 * @param actor - The thrower
 * @param item - Item to throw
 * @param str - Thrower's strength
 * @returns Throw validation result
 */
export function validateThrow(
  actor: Actor,
  item: TaggedItem,
  str: number
): { can_throw: boolean; max_range: number; reason?: string } {
  // Get equipped tool (hand or throwing tool)
  const equippedTools = getEquippedTools(actor);
  const tool = equippedTools[0]; // Use first equipped tool
  
  const validation = resolver.validateThrow(str, item, tool?.item);
  
  return {
    can_throw: validation.can_throw,
    max_range: validation.max_range,
    reason: validation.reason
  };
}

/**
 * Get all actions enabled by equipped tools
 * 
 * @param actor - The actor
 * @returns Array of action capabilities
 */
export function getEnabledActions(actor: Actor): ActionCapability[] {
  const equippedTools = getEquippedTools(actor);
  const allCapabilities: ActionCapability[] = [];
  
  for (const equipped of equippedTools) {
    const capabilities = resolver.getEnabledActions(equipped.item);
    allCapabilities.push(...capabilities);
  }
  
  return allCapabilities;
}

/**
 * Format validation result for display
 */
export function formatValidationResult(
  result: ToolValidationResult,
  actorName: string
): string {
  if (result.valid) {
    if (result.tool) {
      const toolName = result.tool.item.name;
      const actionType = result.tool.capability.action_type;
      return `${actorName} uses ${toolName} for ${actionType}`;
    }
    return `${actorName} can perform action`;
  } else {
    return result.error || `${actorName} cannot perform action`;
  }
}

// Re-export types
export type { TaggedItem, ActionCapability } from "../tag_system/index.js";
