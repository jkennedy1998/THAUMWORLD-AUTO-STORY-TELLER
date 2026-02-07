# Unified Action System Architecture Plan

**Status:** ✅ IMPLEMENTED - See src/action_system/ for actual implementation  
**Date:** 2026-02-05  
**File:** `docs/plans/action_system_plan.md`

> **NOTE:** This document served as the blueprint for the action system implementation.  
> The actual implementation can be found in `src/action_system/` (7 files).  
> This plan is preserved for reference and documentation purposes.

## Overview
Create a centralized action system where both NPCs and Players use the same action pipeline, with actions being observable by nearby characters.

## Core Principles
1. **Single Pipeline**: Both NPCs and Players flow through the same action processing pipeline
2. **Observable Actions**: All actions emit perception events for nearby characters
3. **Declarative Actions**: Actions are defined once, used everywhere
4. **Target Resolution**: Unified target resolution for both explicit and implied targets

---

## 1. Action Registry (New)
**File**: `src/action_system/registry.ts`

Central definitions for all game actions:

```typescript
interface ActionDefinition {
  verb: string;                          // e.g., "ATTACK", "COMMUNICATE"
  category: 'combat' | 'social' | 'movement' | 'utility';
  
  // Target requirements
  targetTypes: TargetType[];             // ['character', 'item']
  targetRequired: boolean;               // Does action need a target?
  targetRange: number;                   // Max distance in tiles
  allowSelf: boolean;                    // Can target self?
  
  // Cost
  defaultCost: ActionCost;               // FULL, PARTIAL, etc.
  
  // Validation
  requiresTool: boolean;                 // Needs tool argument?
  validTools?: string[];                 // Equipment slots or item types
  
  // Perception
  perceptibility: {
    visual: boolean;                     // Can be seen?
    auditory: boolean;                   // Can be heard?
    radius: number;                      // Perception range
    stealthAllowed: boolean;             // Can be done stealthily?
  };
  
  // Execution
  effectTemplate: string;                // SYSTEM command template
  
  // AI hints
  aiPriority: number;                    // Base priority for NPCs
  aiConditions?: string[];               // When NPCs choose this
}

// All game actions defined centrally
export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
  ATTACK: {
    verb: 'ATTACK',
    category: 'combat',
    targetTypes: ['character'],
    targetRequired: true,
    targetRange: 1,
    allowSelf: false,
    defaultCost: 'FULL',
    requiresTool: true,
    validTools: ['hands', 'weapon', 'body_slots.*'],
    perceptibility: { visual: true, auditory: true, radius: 10, stealthAllowed: false },
    effectTemplate: 'SYSTEM.APPLY_DAMAGE(target={target}, source={actor}, tool={tool}, amount={damage})',
    aiPriority: 100,
    aiConditions: ['has_hostile_target', 'in_combat']
  },
  COMMUNICATE: {
    verb: 'COMMUNICATE',
    category: 'social',
    targetTypes: ['character'],
    targetRequired: false,  // Can shout to area
    targetRange: 10,
    allowSelf: false,
    defaultCost: 'FREE',
    requiresTool: false,
    perceptibility: { visual: false, auditory: true, radius: 15, stealthAllowed: false },
    effectTemplate: 'SYSTEM.SET_AWARENESS(target={target}, of={actor})',
    aiPriority: 50,
    aiConditions: ['player_nearby', 'not_hostile']
  },
  // ... other actions
};
```

---

## 2. Action Intent (Unified Interface)
**File**: `src/action_system/intent.ts`

```typescript
interface ActionIntent {
  id: string;                            // Unique action ID
  timestamp: number;                     // When intent created
  
  // Actor
  actorType: 'player' | 'npc';
  actorRef: string;                      // e.g., "actor.player_123" or "npc.glenda"
  actorLocation: Location;               // Where the actor is
  
  // Action
  verb: string;                          // From ACTION_REGISTRY
  actionCost: ActionCost;                // FREE, PARTIAL, FULL, EXTENDED
  
  // Target
  targetRef?: string;                    // Resolved target reference
  targetType?: TargetType;               // Type of target
  targetLocation?: Location;             // Where target is (for area effects)
  
  // Context
  toolRef?: string;                      // Tool/equipment used
  parameters: Record<string, any>;       // Extra context (damage amount, message text, etc.)
  
  // Source tracking
  source: 'player_input' | 'ai_decision' | 'system_trigger';
  originalInput?: string;                // For player inputs
  
  // State
  status: 'pending' | 'validated' | 'executed' | 'failed';
  failureReason?: string;
}

// Factory functions for creating intents
export function createPlayerIntent(
  actorRef: string,
  parsedCommand: ParsedCommand,  // From Interpreter
  uiOverrides: UIOffsets         // target_ref, action_cost, etc.
): ActionIntent;

export function createNPCIntent(
  npcRef: string,
  selectedAction: NPCActionSelection  // From action_selector.ts
): ActionIntent;
```

---

## 3. Action Pipeline (Unified Processing)
**File**: `src/action_system/pipeline.ts`

All actions flow through the same stages:

```typescript
class ActionPipeline {
  async process(intent: ActionIntent): Promise<ActionResult> {
    // Stage 1: Resolve Targets
    intent = await this.resolveTargets(intent);
    if (intent.status === 'failed') return this.fail(intent);
    
    // Stage 2: Validate
    intent = await this.validate(intent);
    if (intent.status === 'failed') return this.fail(intent);
    
    // Stage 3: Check Costs
    intent = await this.checkCosts(intent);
    if (intent.status === 'failed') return this.fail(intent);
    
    // Stage 4: Apply Rules
    intent = await this.applyRules(intent);
    if (intent.status === 'failed') return this.fail(intent);
    
    // Stage 5: Broadcast Perception (before execution)
    await this.broadcastPerception(intent, 'before');
    
    // Stage 6: Execute
    const result = await this.execute(intent);
    
    // Stage 7: Broadcast Perception (after execution)
    await this.broadcastPerception(intent, 'after', result);
    
    return result;
  }
  
  private async resolveTargets(intent: ActionIntent): Promise<ActionIntent> {
    const actionDef = ACTION_REGISTRY[intent.verb];
    
    if (!actionDef.targetRequired) return intent;
    
    // If target already specified, validate it
    if (intent.targetRef) {
      const validation = await validateTarget(intent.targetRef, actionDef);
      if (!validation.valid) {
        return { ...intent, status: 'failed', failureReason: validation.reason };
      }
      return { ...intent, targetType: validation.type };
    }
    
    // Try to resolve implied target
    const impliedTarget = await resolveImpliedTarget(intent, actionDef);
    if (impliedTarget) {
      return { ...intent, targetRef: impliedTarget.ref, targetType: impliedTarget.type };
    }
    
    return { ...intent, status: 'failed', failureReason: 'No target specified' };
  }
  
  private async broadcastPerception(
    intent: ActionIntent, 
    timing: 'before' | 'after',
    result?: ActionResult
  ): Promise<void> {
    const actionDef = ACTION_REGISTRY[intent.verb];
    const radius = actionDef.perceptibility.radius;
    
    // Get all characters in perception range
    const nearbyCharacters = await getCharactersInRange(intent.actorLocation, radius);
    
    for (const observer of nearbyCharacters) {
      // Skip the actor themselves
      if (observer.ref === intent.actorRef) continue;
      
      // Check if observer can perceive this action
      const perception = await checkPerception(observer, intent, actionDef);
      
      if (perception.canPerceive) {
        await emitPerceptionEvent(observer, {
          type: 'action_observed',
          actor: intent.actorRef,
          actorType: intent.actorType,
          verb: intent.verb,
          target: intent.targetRef,
          timing,
          details: perception.details,  // What they can perceive
          clarity: perception.clarity,   // How well (clear, vague, etc.)
          result: timing === 'after' ? result?.summary : undefined
        });
      }
    }
  }
}
```

---

## 4. Target Resolution System
**File**: `src/action_system/target_resolution.ts`

```typescript
interface TargetResolutionContext {
  actorRef: string;
  actorLocation: Location;
  verb: string;
  availableTargets: AvailableTarget[];  // From existing API
  lastTarget?: string;                  // Previous target for continuity
  messageText?: string;                 // For @mention parsing
}

async function resolveImpliedTarget(
  intent: ActionIntent,
  actionDef: ActionDefinition
): Promise<{ ref: string; type: TargetType } | null> {
  const context = await buildContext(intent);
  
  // Priority 1: UI explicit target (highest priority)
  if (intent.source === 'player_input' && uiHasTarget(intent.actorRef)) {
    return { ref: getUITarget(intent.actorRef), type: 'character' };
  }
  
  // Priority 2: @mention in message text
  if (intent.originalInput) {
    const mentionTarget = parseMentionTarget(intent.originalInput, context);
    if (mentionTarget) return mentionTarget;
  }
  
  // Priority 3: Context-based resolution (NPCs only)
  if (intent.source === 'ai_decision') {
    return resolveNPCTarget(intent, context);
  }
  
  // Priority 4: Default targeting based on action type
  return resolveDefaultTarget(intent, actionDef, context);
}

// For NPCs - use existing action_selector.ts logic
async function resolveNPCTarget(
  intent: ActionIntent,
  context: TargetResolutionContext
): Promise<{ ref: string; type: TargetType } | null> {
  // NPC AI already provides target in selectedAction
  // This is just for validation
  return null;  // NPCs should have target from action selector
}
```

---

## 5. Perception System
**File**: `src/action_system/perception.ts`

```typescript
interface PerceptionEvent {
  observerRef: string;
  timestamp: number;
  actionId: string;
  
  // What they observed
  actorRef: string;
  actorVisibility: 'clear' | 'vague' | 'obscured';
  verbObserved: 'clear' | 'inferred';     // Did they clearly see the action?
  targetRef?: string;
  targetVisibility?: 'clear' | 'vague';
  
  // Context
  location: Location;
  distance: number;
  
  // For NPC AI decision-making
  threatLevel?: number;
  interestLevel?: number;
}

// Observable action types
export type ObservableAction = 
  | { type: 'action_started'; action: ActionIntent }
  | { type: 'action_completed'; action: ActionIntent; result: ActionResult }
  | { type: 'combat_started'; participants: string[] }
  | { type: 'communication'; speaker: string; message: string; heardBy: string[] };

// Store recent perceptions for NPCs
class PerceptionMemory {
  private memory: Map<string, PerceptionEvent[]> = new Map();
  
  addPerception(observerRef: string, event: PerceptionEvent): void {
    const observerMemory = this.memory.get(observerRef) || [];
    observerMemory.push(event);
    
    // Keep only last N events, expire old ones
    const cutoff = Date.now() - (5 * 60 * 1000);  // 5 minutes
    const recent = observerMemory.filter(e => e.timestamp > cutoff);
    this.memory.set(observerRef, recent.slice(-20));  // Keep last 20
  }
  
  getRecent(observerRef: string, verbFilter?: string[]): PerceptionEvent[] {
    const events = this.memory.get(observerRef) || [];
    if (verbFilter) {
      return events.filter(e => verbFilter.includes(e.verbObserved));
    }
    return events;
  }
  
  // For NPC AI to check "did I see someone attack?"
  hasObserved(observerRef: string, condition: (event: PerceptionEvent) => boolean): boolean {
    const events = this.memory.get(observerRef) || [];
    return events.some(condition);
  }
}

export const perceptionMemory = new PerceptionMemory();
```

---

## 6. Integration Points

### A. UI Integration (`src/canvas_app/app_state.ts`)

Replace direct interpreter calls with unified action system:

```typescript
// BEFORE
async processPlayerInput(text: string) {
  const interpreted = await interpreter.interpret(text, this.uiOverrides);
  const brokered = await dataBroker.process(interpreted);
  const ruled = await rulesLawyer.apply(brokered);
  // ...
}

// AFTER
async processPlayerInput(text: string) {
  // Create intent through interpreter
  const parsed = await interpreter.parse(text);
  const intent = createPlayerIntent(this.actorRef, parsed, this.uiOverrides);
  
  // Process through unified pipeline
  const result = await actionPipeline.process(intent);
  
  // Handle result
  if (result.success) {
    await this.handleActionResult(result);
  } else {
    showError(result.failureReason);
  }
}
```

### B. NPC AI Integration (`src/npc_ai/action_selector.ts`)

Modify to output ActionIntents instead of raw actions:

```typescript
// BEFORE
selectAction(npcState: NPCState): NPCAction {
  return { verb: 'ATTACK', target: 'actor.player', priority: 100 };
}

// AFTER
async selectAction(npcState: NPCState): Promise<ActionIntent> {
  const selection = this.determineBestAction(npcState);
  return createNPCIntent(npcState.ref, selection);
}
```

Then NPC turns go through same pipeline:

```typescript
// In NPC turn processing
const npcIntent = await npcAI.selectAction(npc);
const result = await actionPipeline.process(npcIntent);
```

### C. Rules Lawyer Integration (`src/rules_lawyer/main.ts`)

Move validation rules into pipeline stages, keep effect generation:

```typescript
// RulesLawyer becomes a pipeline stage
class RulesValidationStage {
  async validate(intent: ActionIntent): Promise<ValidationResult> {
    const actionDef = ACTION_REGISTRY[intent.verb];
    
    // Check target validity
    if (actionDef.targetRequired && !intent.targetRef) {
      return { valid: false, reason: 'Target required' };
    }
    
    // Check awareness (actor must be aware of target)
    if (intent.targetRef) {
      const aware = await checkAwareness(intent.actorRef, intent.targetRef);
      if (!aware) {
        return { valid: false, reason: 'Not aware of target' };
      }
    }
    
    // Check action costs during timed events
    if (inCombat()) {
      const canAfford = await checkActionCost(intent);
      if (!canAfford) {
        return { valid: false, reason: 'Cannot afford action cost' };
      }
    }
    
    return { valid: true };
  }
}
```

---

## 7. Implementation Phases

### Phase 1: Foundation
1. Create `src/action_system/` directory
2. Implement Action Registry with all current verbs
3. Define ActionIntent interface
4. Create basic Pipeline class

### Phase 2: Player Integration
1. Refactor UI to use ActionPipeline
2. Move target resolution from UI to Pipeline
3. Integrate with existing DataBroker/RulesLawyer as pipeline stages
4. Test all player actions through new system

### Phase 3: NPC Integration
1. Refactor action_selector.ts to return ActionIntents
2. Route all NPC actions through ActionPipeline
3. Ensure NPCs and Players use same validation rules

### Phase 4: Perception System
1. Implement perception broadcasting
2. Create PerceptionMemory for NPCs
3. Update NPC AI to use perceived actions for decisions
4. Add "reactive actions" (NPCs responding to observed combat)

### Phase 5: Advanced Features
1. Action queues (chained actions)
2. Action reactions (counter-spells, attacks of opportunity)
3. Stealth/visibility modifiers
4. Environmental perception (hearing through walls, etc.)

---

## 8. Benefits

1. **Consistency**: NPCs and Players play by exact same rules
2. **Maintainability**: Change action logic in one place
3. **Extensibility**: Add new actions by adding to registry
4. **Observability**: Actions automatically broadcast to nearby characters
5. **Debugging**: Central pipeline makes it easy to trace action flow
6. **Testing**: Can test action logic independently of UI or AI

---

## 9. Migration Strategy

### Backwards Compatibility
- Keep existing DataBroker API functional during transition
- Add adapter layer: `DataBrokerAdapter` implements current API using ActionPipeline
- Gradually migrate endpoints

### Testing Approach
1. Unit tests for each pipeline stage
2. Integration tests for full action flows
3. Comparative tests: old system vs new system produce same results
4. Perception tests: verify nearby characters receive events

---

## Files to Create/Modify

### New Files
- `src/action_system/registry.ts` - Action definitions
- `src/action_system/intent.ts` - Intent interface and factories
- `src/action_system/pipeline.ts` - Main processing pipeline
- `src/action_system/target_resolution.ts` - Target resolution logic
- `src/action_system/perception.ts` - Perception broadcasting
- `src/action_system/validation.ts` - Validation rules
- `src/action_system/executor.ts` - Effect execution

### Modified Files
- `src/canvas_app/app_state.ts` - Use ActionPipeline
- `src/interpreter_ai/main.ts` - Return structured data for intents
- `src/data_broker/main.ts` - Integrate as pipeline stage
- `src/rules_lawyer/main.ts` - Integrate validation as pipeline stage
- `src/npc_ai/action_selector.ts` - Return ActionIntents
- `src/npc_ai/main.ts` - Process NPC actions through pipeline

### Integration Points
- `src/shared/constants.ts` - Add action registry constants
- `src/types/actions.ts` - Central action type definitions
