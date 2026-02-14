// Action Pipeline
// Main processing pipeline for all actions (both Player and NPC)

import type { ActionVerb, ActionCost } from "../shared/constants.js";
import type { ActionIntent, ActionResult, ActionEffect, Location } from "./intent.js";
import { createActionResult, createActionEffect, markIntentFailed, markIntentStageComplete, setIntentStage } from "./intent.js";
import { ACTION_REGISTRY, getActionDefinition } from "./registry.js";
import type { TargetValidationResult, AvailableTarget } from "./target_resolution.js";
import { resolveTarget, validateTarget, checkAwareness } from "./target_resolution.js";
import { broadcastPerception, perceptionMemory, type PerceptionEvent } from "./perception.js";
import { face_target } from "../npc_ai/facing_system.js";
import { get_senses_for_action, log_sense_broadcast } from "./sense_broadcast.js";
import { process_witness_event } from "../npc_ai/witness_handler.js";
import { validateToolRequirement, getActionTool } from "../tool_system/index.js";
import { calculateEffectiveRange } from "../action_range/range_calculator.js";
import { validateRange } from "../action_range/index.js";
import { handleAction, type ActionContext } from "../action_handlers/index.js";
import { performResultRoll, performPotencyRoll, calculateCR, createRollContext, type RollContext, type ProficiencyType } from "../roll_system/index.js";
import { DEBUG_LEVEL } from "../shared/debug.js";
import { debug_event } from "../shared/debug_event.js";

// Pipeline stage types
export type PipelineStage = 
  | "target_resolution"
  | "validation"
  | "cost_check"
  | "rules_check"
  | "broadcast_before"
  | "execution"
  | "broadcast_after";

// Pipeline configuration
export interface PipelineConfig {
  enablePerception: boolean;
  enableValidation: boolean;
  enableCostCheck: boolean;
  enableRulesCheck: boolean;
  requireAwareness: boolean;
  debug: boolean;
}

// Default pipeline config
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  enablePerception: true,
  enableValidation: true,
  enableCostCheck: true,
  enableRulesCheck: true,
  requireAwareness: true,
  debug: false
};

// Dependencies required by pipeline
export interface PipelineDependencies {
  // Storage access
  getAvailableTargets: (location: Location, radius: number) => Promise<AvailableTarget[]>;
  getActorLocation: (actorRef: string) => Promise<Location | null>;
  checkActorAwareness: (actorRef: string, targetRef: string) => Promise<boolean>;
  checkActionCost: (actorRef: string, cost: ActionCost) => Promise<boolean>;
  consumeActionCost: (actorRef: string, cost: ActionCost) => Promise<boolean>;
  
  // Actor data access for tool validation
  getActorData: (actorRef: string) => Promise<{
    ref: string;
    body_slots?: Record<string, { name: string; critical?: boolean; item?: string | { ref: string; name: string; mag: number; tags: string[] } }>;
    hand_slots?: Record<string, string>;
    inventory?: Record<string, unknown>;
  } | null>;
  
  // Effect execution
  executeEffect: (effect: ActionEffect) => Promise<boolean>;
  
  // Combat/timing checks
  isInCombat: () => boolean;
  getCurrentActor: () => string | null;
  
  // Logging
  log: (message: string, data?: any) => void;
}

// Main Action Pipeline class
export class ActionPipeline {
  private config: PipelineConfig;
  private deps: PipelineDependencies;
  
  constructor(deps: PipelineDependencies, config: Partial<PipelineConfig> = {}) {
    this.deps = deps;
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
  }
  
  // Main processing method
  async process(intent: ActionIntent): Promise<ActionResult> {
    debug_event("ACTION_PIPELINE", "process.start", {
      intent_id: intent.id,
      verb: intent.verb,
      actor_ref: intent.actorRef,
      target_ref: intent.targetRef,
      subtype: intent.parameters.subtype,
    });
    
    const actionDef = getActionDefinition(intent.verb);
    
    if (!actionDef) {
      debug_event("ACTION_PIPELINE", "process.failed", {
        intent_id: intent.id,
        verb: intent.verb,
        actor_ref: intent.actorRef,
        reason: "unknown_action_verb",
      });
      return this.fail(intent, `Unknown action verb: ${intent.verb}`);
    }
    
    this.log(`Processing action: ${intent.verb} by ${intent.actorRef}`);
    
    try {
      // Stage 1: Target Resolution
      debug_event("ACTION_PIPELINE", "stage.start", { intent_id: intent.id, stage: "target_resolution" });
      intent = await this.stageTargetResolution(intent, actionDef);
      if (intent.status === "failed") {
        debug_event("ACTION_PIPELINE", "stage.failed", {
          intent_id: intent.id,
          stage: "target_resolution",
          reason: intent.failureReason,
        });
        return this.fail(intent, intent.failureReason || "Target resolution failed");
      }
      debug_event("ACTION_PIPELINE", "stage.complete", { intent_id: intent.id, stage: "target_resolution" });
      
      // Stage 2: Validation
      if (this.config.enableValidation) {
        debug_event("ACTION_PIPELINE", "stage.start", { intent_id: intent.id, stage: "validation" });
        intent = await this.stageValidation(intent, actionDef);
        if (intent.status === "failed") {
          debug_event("ACTION_PIPELINE", "stage.failed", {
            intent_id: intent.id,
            stage: "validation",
            reason: intent.failureReason,
          });
          return this.fail(intent, intent.failureReason || "Validation failed");
        }
        debug_event("ACTION_PIPELINE", "stage.complete", { intent_id: intent.id, stage: "validation" });
      }
      
      // Stage 3: Cost Check
      if (this.config.enableCostCheck) {
        debug_event("ACTION_PIPELINE", "stage.start", { intent_id: intent.id, stage: "cost_check" });
        intent = await this.stageCostCheck(intent, actionDef);
        if (intent.status === "failed") {
          debug_event("ACTION_PIPELINE", "stage.failed", {
            intent_id: intent.id,
            stage: "cost_check",
            reason: intent.failureReason,
          });
          return this.fail(intent, intent.failureReason || "Cannot afford action cost");
        }
        debug_event("ACTION_PIPELINE", "stage.complete", { intent_id: intent.id, stage: "cost_check" });
      }
      
      // Stage 4: Rules Check
      if (this.config.enableRulesCheck) {
        debug_event("ACTION_PIPELINE", "stage.start", { intent_id: intent.id, stage: "rules_check" });
        intent = await this.stageRulesCheck(intent, actionDef);
        if (intent.status === "failed") {
          debug_event("ACTION_PIPELINE", "stage.failed", {
            intent_id: intent.id,
            stage: "rules_check",
            reason: intent.failureReason,
          });
          return this.fail(intent, intent.failureReason || "Rules check failed");
        }
        debug_event("ACTION_PIPELINE", "stage.complete", { intent_id: intent.id, stage: "rules_check" });
      }
      
      // Stage 5: Broadcast Before Execution (perception)
      debug_event("ACTION_PIPELINE", "stage.start", { intent_id: intent.id, stage: "broadcast_before" });
      let perceptionEvents: PerceptionEvent[] = [];
      if (this.config.enablePerception) {
        perceptionEvents = await this.stageBroadcastBefore(intent);
      } else {
        if (DEBUG_LEVEL >= 4) {
          debug_event("ACTION_PIPELINE", "stage.skipped", {
            intent_id: intent.id,
            stage: "broadcast_before",
            enable_perception: this.config.enablePerception,
          });
        }
      }
      debug_event("ACTION_PIPELINE", "stage.complete", {
        intent_id: intent.id,
        stage: "broadcast_before",
        perceived_by: perceptionEvents.length,
      });
      
      // Stage 6: Execute
      debug_event("ACTION_PIPELINE", "stage.start", { intent_id: intent.id, stage: "execution" });
      const result = await this.stageExecution(intent, actionDef);
      debug_event("ACTION_PIPELINE", "stage.complete", {
        intent_id: intent.id,
        stage: "execution",
        success: result.success,
      });
      
      // Stage 7: Broadcast After Execution
      debug_event("ACTION_PIPELINE", "stage.start", { intent_id: intent.id, stage: "broadcast_after" });
      if (this.config.enablePerception) {
        const afterEvents = await this.stageBroadcastAfter(intent, result);
        // Attach observers to the result so downstream systems can respect sensing/range.
        const unique = new Set<string>();
        for (const e of afterEvents) unique.add(e.observerRef);
        result.observedBy = Array.from(unique);
      } else {
        if (DEBUG_LEVEL >= 4) {
          debug_event("ACTION_PIPELINE", "stage.skipped", {
            intent_id: intent.id,
            stage: "broadcast_after",
            enable_perception: this.config.enablePerception,
          });
        }
      }
      debug_event("ACTION_PIPELINE", "stage.complete", { intent_id: intent.id, stage: "broadcast_after" });
      
      this.log(`Action completed: ${intent.verb} - ${result.success ? "success" : "failed"}`);
      debug_event("ACTION_PIPELINE", "process.complete", {
        intent_id: intent.id,
        verb: intent.verb,
        actor_ref: intent.actorRef,
        success: result.success,
      });
      
      return result;
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log(`Pipeline error: ${errorMsg}`, error);
      return this.fail(intent, `Pipeline error: ${errorMsg}`);
    }
  }
  
  // Stage 1: Target Resolution
  private async stageTargetResolution(intent: ActionIntent, actionDef: ReturnType<typeof getActionDefinition>): Promise<ActionIntent> {
    if (!actionDef) return markIntentFailed(intent, "No action definition");
    
    intent = setIntentStage(intent, "target_resolution");
    
    // Get available targets
    const availableTargets = await this.deps.getAvailableTargets(
      intent.actorLocation, 
      actionDef.targetRange * 2  // Get targets in extended range
    );
    
    // Resolve target
    const resolved = await resolveTarget(intent, availableTargets, {
      uiSelectedTarget: intent.parameters.uiSelectedTarget as string,
      lastTarget: intent.parameters.lastTarget as string
    });
    
    return markIntentStageComplete(resolved, "target_resolution");
  }
  
  // Stage 2: Validation
  private async stageValidation(intent: ActionIntent, actionDef: ReturnType<typeof getActionDefinition>): Promise<ActionIntent> {
    if (!actionDef) return markIntentFailed(intent, "No action definition");
    
    intent = setIntentStage(intent, "validation");
    
    // Check if target is required
    if (actionDef.targetRequired && !intent.targetRef) {
      return markIntentFailed(intent, `${actionDef.verb} requires a target`);
    }
    
    // Validate target if present
    if (intent.targetRef && actionDef.targetRequired) {
      const validation = await validateTarget(
        intent.targetRef,
        actionDef,
        intent.actorLocation,
        intent.actorRef
      );
      
      if (!validation.valid) {
        return markIntentFailed(intent, validation.reason || "Invalid target");
      }
    }
    
    // Check self-targeting
    if (!actionDef.allowSelf && intent.targetRef === intent.actorRef) {
      return markIntentFailed(intent, `${actionDef.verb} cannot target self`);
    }
    
    // Check tool requirements using the tool system
    if (actionDef.requiresTool) {
      const actorData = await this.deps.getActorData(intent.actorRef);
      
      if (!actorData) {
        return markIntentFailed(intent, `Cannot find actor data for ${intent.actorRef}`);
      }
      
      const subtype = typeof intent.parameters.subtype === "string" ? intent.parameters.subtype : undefined;

      // Validate tool requirement (include subtype when present)
      const toolValidation = validateToolRequirement(actorData, intent.verb, subtype);
      
      if (!toolValidation.valid) {
        return markIntentFailed(intent, toolValidation.error || "Missing required tool");
      }
      
      // Set the tool reference from validation
      if (toolValidation.tool && !intent.toolRef) {
        intent = {
          ...intent,
          toolRef: toolValidation.tool.tool_ref
        };
      }
    }
    
    // Check range using range validator.
    // INSPECT uses its own clarity system; do not hard-fail on range here.
    if (intent.verb !== "INSPECT" && intent.targetRef && intent.targetLocation) {
      const actorData = await this.deps.getActorData(intent.actorRef);
      const subtype = typeof intent.parameters.subtype === "string" ? intent.parameters.subtype : undefined;
      const toolData = actorData ? getActionTool(actorData, intent.verb, subtype) : null;

      // If a tool is available and the action has a subtype, compute effective range
      // from the tag resolver contract (ex: bow -> USE.PROJECTILE_SINGLE).
      let effectiveRange = actionDef.targetRange;

      // Communication range is subtype-dependent (WHISPER/NORMAL/SHOUT).
      // Use the pressure broadcast as the actual "can be heard" range for targeted talk.
      if (intent.verb === "COMMUNICATE" && intent.targetRef) {
        const broadcasts = get_senses_for_action("COMMUNICATE", subtype);
        const pressure = broadcasts.filter(b => b.sense === "pressure");
        if (pressure.length > 0) {
          effectiveRange = Math.max(...pressure.map(p => p.range_tiles));
        }
      } else if (toolData && subtype) {
        const fullActionType = `${intent.verb}.${subtype}`;
        const throwerSTR = typeof (actorData as any)?.stats?.STR === "number" ? Number((actorData as any).stats.STR) : undefined;
        effectiveRange = calculateEffectiveRange(toolData, fullActionType, throwerSTR);
      }
      
      const rangeValidation = validateRange(
        intent.actorLocation,
        intent.targetLocation,
        effectiveRange,
        intent.verb,
        toolData ? {
          mag: toolData.mag || 0,
          tags: toolData.tags.map(t => t.name)
        } : undefined
      );
      
      if (!rangeValidation.valid) {
        return markIntentFailed(intent, rangeValidation.reason || "Target out of range");
      }
      
      // Store range penalty for later use (e.g., in dice rolls)
      intent.parameters.rangePenalty = rangeValidation.penalty;
      intent.parameters.distance = rangeValidation.distance;
    }
    
    // Check awareness
    if (this.config.requireAwareness && actionDef.requiresAwareness && intent.targetRef) {
      const isAware = await this.deps.checkActorAwareness(intent.actorRef, intent.targetRef);
      if (!isAware) {
        return markIntentFailed(intent, "Not aware of target");
      }
    }
    
    // Check combat restrictions
    const inCombat = this.deps.isInCombat();
    if (inCombat && !actionDef.canUseInCombat) {
      return markIntentFailed(intent, `${actionDef.verb} cannot be used in combat`);
    }
    if (!inCombat && !actionDef.canUseOutOfCombat) {
      return markIntentFailed(intent, `${actionDef.verb} can only be used in combat`);
    }
    
    return markIntentStageComplete(intent, "validation");
  }
  
  // Stage 3: Cost Check
  private async stageCostCheck(intent: ActionIntent, actionDef: ReturnType<typeof getActionDefinition>): Promise<ActionIntent> {
    if (!actionDef) return markIntentFailed(intent, "No action definition");
    
    intent = setIntentStage(intent, "cost_check");
    
    // Only check costs during combat
    if (!this.deps.isInCombat()) {
      return markIntentStageComplete(intent, "cost_check");
    }
    
    // Check if it's this actor's turn
    const currentActor = this.deps.getCurrentActor();
    if (currentActor && currentActor !== intent.actorRef) {
      return markIntentFailed(intent, "Not your turn");
    }
    
    // Check if actor can afford the cost
    const canAfford = await this.deps.checkActionCost(intent.actorRef, intent.actionCost);
    if (!canAfford) {
      return markIntentFailed(intent, `Cannot afford ${intent.actionCost} action`);
    }
    
    // Consume the cost
    const consumed = await this.deps.consumeActionCost(intent.actorRef, intent.actionCost);
    if (!consumed) {
      return markIntentFailed(intent, "Failed to consume action cost");
    }
    
    return markIntentStageComplete(intent, "cost_check");
  }
  
  // Stage 4: Rules Check
  private async stageRulesCheck(intent: ActionIntent, actionDef: ReturnType<typeof getActionDefinition>): Promise<ActionIntent> {
    if (!actionDef) return markIntentFailed(intent, "No action definition");
    
    intent = setIntentStage(intent, "rules_check");
    
    // Additional rules can be added here
    // - Check for opportunity attacks
    // - Check for reactions
    // - Check for status effects that prevent actions
    // - etc.
    
    return markIntentStageComplete(intent, "rules_check");
  }
  
  // Stage 5: Broadcast Before Execution
  private async stageBroadcastBefore(intent: ActionIntent): Promise<PerceptionEvent[]> {
    intent = setIntentStage(intent, "broadcast_before");
    
    const events = await broadcastPerception(intent, "before", undefined, {
      getCharactersInRange: this.deps.getAvailableTargets
    });
    
    this.log(`Broadcast before: ${events.length} observers`);
    return events;
  }
  
  // Stage 6: Execution
  private async stageExecution(intent: ActionIntent, actionDef: ReturnType<typeof getActionDefinition>): Promise<ActionResult> {
    if (!actionDef) {
      return this.fail(intent, "No action definition");
    }
    
    intent = setIntentStage(intent, "execution");
    
    // Check if this is a core action that uses the new handler system
    const isCoreAction = ["COMMUNICATE", "MOVE", "USE", "INSPECT"].includes(intent.verb);
    
    if (isCoreAction) {
      // Use new action handlers for core actions
      return await this.executeCoreAction(intent, actionDef);
    }
    
    // Legacy execution for other actions
    return await this.executeLegacyAction(intent, actionDef);
  }
  
  // Execute core actions using new handler system
  private async executeCoreAction(
    intent: ActionIntent, 
    actionDef: ReturnType<typeof getActionDefinition>
  ): Promise<ActionResult> {
    // Get actor data and tool
    const actorData = await this.deps.getActorData(intent.actorRef);
    const toolData = actorData ? getActionTool(actorData, intent.verb) : null;
    
    // Get tool capability
    const validation = validateToolRequirement(
      actorData || { ref: intent.actorRef, hand_slots: {}, body_slots: {} },
      intent.verb,
      intent.parameters.subtype
    );
    
    const capability = validation.valid ? validation.tool?.capability : undefined;
    
    // Movement should not require an outcome roll by default.
    // Future terrain tags can opt-in by setting a difficulty or explicit requires_roll.
    const requiresOutcomeRoll =
      intent.verb !== "MOVE" ||
      intent.parameters.requires_roll === true ||
      typeof intent.parameters.difficulty === "number";

    // Create roll context only when we need it (rolls and/or potency).
    const needsRollContext = requiresOutcomeRoll || (intent.verb === "USE" && !!intent.parameters.subtype);
    const rollContext = needsRollContext
      ? createRollContext(
          intent.actorRef,
          intent.parameters.subtype ? `${intent.verb}.${intent.parameters.subtype}` : intent.verb,
          toolData || undefined,
          capability,
          {
            proficiencies: (actorData as any)?.proficiencies as Record<ProficiencyType, number> | undefined,
            stats: (actorData as any)?.stats as Record<string, number> | undefined,
          }
        )
      : null;

    // Calculate CR + roll only when required
    const cr = requiresOutcomeRoll
      ? calculateCR(10, {
          distance: intent.targetLocation
            ? Math.sqrt(
                Math.pow(intent.actorLocation.x || 0 - (intent.targetLocation.x || 0), 2) +
                  Math.pow(intent.actorLocation.y || 0 - (intent.targetLocation.y || 0), 2)
              )
            : undefined,
          maxRange: capability?.range?.effective,
          targetDefense: 0, // Would come from target data
          difficulty: intent.parameters.difficulty,
        })
      : null;

    const resultRoll = requiresOutcomeRoll && rollContext && cr !== null ? performResultRoll(rollContext, cr) : null;
    
    // Perform potency roll for damage (if applicable)
    let potencyRoll = null;
    if (intent.verb === "USE" && intent.parameters.subtype && rollContext) {
      const baseMAG = toolData?.tags?.find(t => 
        capability?.source_tag && t.name === capability.source_tag
      )?.stacks || 1;
      potencyRoll = performPotencyRoll(baseMAG, rollContext.effectors);
    }
    
    // Build action context with roll results
    const context: ActionContext = {
      actorRef: intent.actorRef,
      actorLocation: intent.actorLocation,
      targetRef: intent.targetRef,
      targetLocation: intent.targetLocation,
      tool: toolData || undefined,
      capability,
      parameters: {
        ...intent.parameters,
        message: intent.parameters.message,
        distance: intent.parameters.distance,
        ammo: intent.parameters.ammo,
        // Pass roll results to handlers
        hit: resultRoll ? resultRoll.success : (intent.parameters.hit ?? true),
        roll: resultRoll ? resultRoll.total : intent.parameters.roll,
        nat: resultRoll ? resultRoll.nat : intent.parameters.nat,
        cr: resultRoll ? resultRoll.cr : intent.parameters.cr,
        margin: resultRoll ? resultRoll.margin : intent.parameters.margin,
        prof_bonus: resultRoll ? resultRoll.prof_bonus : intent.parameters.prof_bonus,
        stat_bonus: resultRoll ? resultRoll.stat_bonus : intent.parameters.stat_bonus,
        damageMAG: potencyRoll?.total || intent.parameters.damageMAG,
        potency_roll: potencyRoll?.roll || 0,
        sticks: intent.parameters.sticks
      }
    };
    
    // Determine full action type
    const fullActionType = intent.parameters.subtype 
      ? `${intent.verb}.${intent.parameters.subtype}`
      : intent.verb;
    
    // Execute through handler
    const handlerResult = await handleAction(fullActionType, context);
    
    // Log roll results
    if (resultRoll && cr !== null) {
      this.log(
        `Result Roll: ${resultRoll.nat} (D20) +${resultRoll.prof_bonus} prof +${resultRoll.stat_bonus} stat = ${resultRoll.total} vs CR ${cr} - ${resultRoll.success ? "SUCCESS" : "FAIL"}`
      );
    }
    if (potencyRoll) {
      this.log(`Potency Roll: MAG ${potencyRoll.mag} (${potencyRoll.dice}) = ${potencyRoll.roll} damage`);
    }
    
    // Convert handler effects to pipeline effects
    const effects: ActionEffect[] = handlerResult.effects.map(e => 
      createActionEffect(e.type, e.target, e.parameters)
    );
    
    // Execute each effect
    for (const effect of effects) {
      const applied = await this.deps.executeEffect(effect);
      effect.applied = applied;
      if (!applied) {
        effect.error = "Failed to apply effect";
      }
    }
    
    // Handle projectile movement if applicable
    if (handlerResult.projectiles && handlerResult.projectiles.length > 0) {
      for (const proj of handlerResult.projectiles) {
        // Move projectile item to new location
        await this.deps.executeEffect({
          type: "MOVE_ITEM",
          targetRef: proj.item.ref,
          parameters: {
            from: intent.actorRef,
            to: proj.inTarget ? proj.landingLocation : proj.landingLocation,
            in_target_inventory: proj.inTarget,
            on_ground: !proj.inTarget
          },
          applied: false
        });
      }
    }
    
    const result = createActionResult(
      intent,
      handlerResult.success && effects.every(e => e.applied),
      effects,
      {
        summary: handlerResult.messages.join("; ")
      }
    );
    
    return result;
  }
  
  // Legacy execution for non-core actions
  private async executeLegacyAction(
    intent: ActionIntent, 
    actionDef: ReturnType<typeof getActionDefinition>
  ): Promise<ActionResult> {
    if (!actionDef) {
      return this.fail(intent, "No action definition");
    }
    
    const effects: ActionEffect[] = [];
    
    // Parse and execute effect template
    const effectTemplate = actionDef.effectTemplate;
    const parsedEffect = this.parseEffectTemplate(effectTemplate, intent);
    
    if (parsedEffect) {
      const effect = createActionEffect(
        parsedEffect.type,
        parsedEffect.target,
        parsedEffect.parameters
      );
      
      // Execute the effect
      const applied = await this.deps.executeEffect(effect);
      effect.applied = applied;
      
      effects.push(effect);
      
      if (!applied) {
        effect.error = "Failed to apply effect";
      }
    }
    
    // Additional effects based on action type
    if (intent.verb === "ATTACK") {
      // Would calculate damage, check hits, etc.
      const damageEffect = createActionEffect(
        "APPLY_DAMAGE",
        intent.targetRef || intent.actorRef,
        {
          source: intent.actorRef,
          tool: intent.toolRef,
          amount: intent.parameters.damage || 0
        }
      );
      effects.push(damageEffect);
    }
    
    const result = createActionResult(
      intent,
      effects.every(e => e.applied),
      effects,
      {
        summary: `${intent.verb} ${effects.every(e => e.applied) ? "succeeded" : "partially succeeded"}`
      }
    );
    
    return result;
  }
  
  // Stage 7: Broadcast After Execution
  private async stageBroadcastAfter(intent: ActionIntent, result: ActionResult): Promise<PerceptionEvent[]> {
    debug_event("ACTION_PIPELINE", "broadcast_after.start", {
      intent_id: intent.id,
      verb: intent.verb,
      actor_ref: intent.actorRef,
      target_ref: intent.targetRef,
      success: result.success,
    });
    intent = setIntentStage(intent, "broadcast_after");
    
    // Update actor facing to face target if action was successful and has a target
    if (result.success && intent.targetRef) {
      this.updateActorFacing(intent);
    }
    
    // Log sense broadcast for debugging
    if (intent.actorLocation) {
      log_sense_broadcast(
        intent.actorRef,
        intent.verb,
        intent.parameters.subtype as string | undefined,
        { x: intent.actorLocation.x ?? 0, y: intent.actorLocation.y ?? 0 }
      );
    }
    
    // Broadcast perception and get list of observers who perceived the action
    const events = await broadcastPerception(intent, "after", result, {
      getCharactersInRange: this.deps.getAvailableTargets
    });
    
    debug_event("ACTION_PIPELINE", "broadcast_after.perception", {
      intent_id: intent.id,
      verb: intent.verb,
      perceived_by: events.length,
    });
    
    // Process witness reactions for each observer
    for (const event of events) {
      if (DEBUG_LEVEL >= 4) {
        debug_event("ACTION_PIPELINE", "broadcast_after.witness_event", {
          intent_id: intent.id,
          observer_ref: event.observerRef,
          verb: event.verb,
        });
      }
      process_witness_event(event.observerRef, event);
    }
    
    debug_event("ACTION_PIPELINE", "broadcast_after.complete", {
      intent_id: intent.id,
      verb: intent.verb,
    });

    return events;
  }
  
  // Helper: Update actor facing toward target
  private updateActorFacing(intent: ActionIntent): void {
    const targetRef = intent.targetRef;
    const targetLocation = intent.targetLocation;
    const actorLocation = intent.actorLocation;
    
    if (!targetRef || !targetLocation || !actorLocation) return;
    
    // Only update facing for certain action types
    const facingActions = ["COMMUNICATE", "USE", "INSPECT"];
    if (!facingActions.includes(intent.verb)) return;
    
    // Only update if both positions are in the same tile space
    if (
      actorLocation.world_x === targetLocation.world_x &&
      actorLocation.world_y === targetLocation.world_y &&
      actorLocation.region_x === targetLocation.region_x &&
      actorLocation.region_y === targetLocation.region_y &&
      actorLocation.x !== undefined &&
      actorLocation.y !== undefined &&
      targetLocation.x !== undefined &&
      targetLocation.y !== undefined
    ) {
      face_target(
        intent.actorRef,
        targetRef,
        { x: targetLocation.x, y: targetLocation.y },
        { x: actorLocation.x, y: actorLocation.y }
      );
    }
  }
  
  // Helper: Parse effect template
  private parseEffectTemplate(
    template: string, 
    intent: ActionIntent
  ): { type: string; target: string; parameters: Record<string, any> } | null {
    // Simple template parsing
    // Format: SYSTEM.EFFECT_NAME(param1={value1}, param2={value2})
    
    const match = template.match(/^SYSTEM\.(\w+)\((.+)\)$/);
    if (!match || !match[1] || !match[2]) return null;
    
    const effectType = match[1];
    const paramsStr = match[2];
    
    const parameters: Record<string, any> = {};
    
    // Parse parameters (simplified)
    const paramMatches = paramsStr.matchAll(/(\w+)=\{([^}]+)\}/g);
    for (const paramMatch of paramMatches) {
      const key = paramMatch[1];
      if (!key) continue;
      
      let value: string | any = paramMatch[2];
      
      // Resolve placeholders
      if (value === "actor") value = intent.actorRef;
      else if (value === "target") value = intent.targetRef || "";
      else if (value === "tool") value = intent.toolRef || "";
      else if (value !== undefined && intent.parameters[value] !== undefined) {
        value = intent.parameters[value];
      }
      
      parameters[key] = value;
    }
    
    return {
      type: effectType,
      target: intent.targetRef || intent.actorRef,
      parameters
    };
  }
  
  
  // Helper: Fail an intent
  private fail(intent: ActionIntent, reason: string): ActionResult {
    return createActionResult(
      intent,
      false,
      [],
      { failureReason: reason, summary: `Failed: ${reason}` }
    );
  }
  
  // Helper: Log message
  private log(message: string, data?: any): void {
    if (this.config.debug) {
      this.deps.log(message, data);
    }
  }
}

// Factory function for creating pipeline
export function createActionPipeline(
  deps: PipelineDependencies,
  config?: Partial<PipelineConfig>
): ActionPipeline {
  return new ActionPipeline(deps, config);
}

// Batch process multiple intents (for simultaneous actions)
export async function processBatch(
  pipeline: ActionPipeline,
  intents: ActionIntent[],
  options: {
    respectOrder?: boolean;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  
  if (options.respectOrder) {
    // Process sequentially
    for (let i = 0; i < intents.length; i++) {
      const intent = intents[i];
      if (!intent) continue;
      const result = await pipeline.process(intent);
      results.push(result);
      options.onProgress?.(i + 1, intents.length);
    }
  } else {
    // Process in parallel
    const promises = intents.map(intent => pipeline.process(intent));
    const resolved = await Promise.all(promises);
    results.push(...resolved);
    options.onProgress?.(intents.length, intents.length);
  }
  
  return results;
}
