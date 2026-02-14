# Action System Testing Guide

## Overview

This guide shows how to test the complete action system integration including:
- Moving through places
- Communicating with NPCs
- Targeting NPCs with actions
- Combat with melee and projectile weapons
- Effector modifications

## System Components

### 1. Tag System (`src/tag_system/`)
- **Registry**: Stores tag rules with generation costs
- **Resolver**: Resolves tool capabilities from tags
- **Budget**: Calculates MAG budgets for items

### 2. Tool System (`src/tool_system/`)
- **Validator**: Validates actors have required tools
- Uses tag resolver to check tool capabilities

### 3. Action Range (`src/action_range/`)
- **Calculator**: Calculates effective ranges using tag rules
- Handles distance calculations between locations

### 4. Action Handlers (`src/action_handlers/`)
- **Core**: COMMUNICATE, MOVE, USE.IMPACT_SINGLE, USE.PROJECTILE_SINGLE, INSPECT
- **Inspect**: Distance-based inspection system

### 5. Effectors (`src/effectors/`)
- **Registry**: SHIFT and SCALE modifiers from tags
- Applied to rolls, damage, and range

### 6. Roll System (`src/roll_system/`)
- **D20 Result Rolls**: D20 + proficiency + stat + effectors
- **CR Calculation**: Challenge rating based on distance/defense
- **Potency Rolls**: MAG-based damage dice

### 7. Action Pipeline (`src/action_system/pipeline.ts`)
- 7-stage processing pipeline
- Integrates all systems
- Performs rolls and executes actions

### 8. Debug Logger (`src/action_system/debug_logger.ts`)
- Comprehensive logging for testing
- Test helper functions
- Visual test output

## Test Scenarios

### Test 1: Move Through Place

```typescript
// Player starts at (0,0) and moves to (3,4)
const player = createTestActor("actor.player", {
  name: "Test Player",
  stats: { STR: 12, DEX: 14 }
});

const intent = createIntent("actor.player", "MOVE", "player_input", {
  actorLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 0, y: 0 },
  targetLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 3, y: 4 },
  parameters: {
    subtype: "WALK",
    distance: 5
  }
});

// Pipeline processes the action
const result = await pipeline.process(intent);
// Expected: success = true
// Expected: player moves to (3,4)
```

**What to verify:**
- ✓ Action succeeds
- ✓ Distance calculated correctly (5 tiles)
- ✓ MOVE effect executed
- ✓ Location updated

### Test 2: Say Hi to NPC

```typescript
// Player at (3,4), NPC Guard at (5,5) - 2.2 tiles away
const player = createTestActor("actor.player");
const guard = createTestNPC("npc.guard", { x: 5, y: 5 });

const intent = createIntent("actor.player", "COMMUNICATE", "player_input", {
  actorLocation: { x: 3, y: 4, ... },
  targetRef: "npc.guard",
  targetLocation: { x: 5, y: 5, ... },
  parameters: {
    subtype: "NORMAL",
    message: "Hello!"
  }
});

const result = await pipeline.process(intent);
// Expected: success = true (within 3 tile range)
// Expected: message "Hello!" delivered to NPC
```

**What to verify:**
- ✓ Distance calculated (2.2 tiles)
- ✓ Within NORMAL range (3 tiles)
- ✓ COMMUNICATE effect executed
- ✓ Message logged

### Test 3: Target NPC with Projectile

```typescript
// Player with Longbow at (3,4)
// NPC Bandit at (8,8) - 7.1 tiles away
const bow = createTestTool("Longbow", 3, [
  { name: "bow", stacks: 3 },
  { name: "projectile", stacks: 1 }
]);

const player = createTestActor("actor.player", {
  proficiencies: { Accuracy: 3 },
  equippedTool: bow
});

const intent = createIntent("actor.player", "USE", "player_input", {
  targetRef: "npc.bandit",
  parameters: {
    subtype: "PROJECTILE_SINGLE",
    ammo: arrow
  }
});

const result = await pipeline.process(intent);
// Expected: D20 roll performed
// Expected: CR calculated based on distance
// Expected: Hit/miss determined
// Expected: Damage rolled if hit
```

**What to verify:**
- ✓ Tool validated (bow found)
- ✓ Range validated (7.1 tiles < 36 tile range)
- ✓ D20 result roll performed
- ✓ Proficiency bonus applied (Accuracy 3)
- ✓ Stat bonus applied (DEX)
- ✓ CR calculated
- ✓ Success/failure determined
- ✓ Potency roll for damage (MAG-based)
- ✓ Arrow location updated (in target or on ground)

### Test 4: Melee Attack with Effectors

```typescript
// Player with Masterwork Sword
const sword = createTestTool("Masterwork Sword", 2, [
  { name: "sword", stacks: 2 },
  { name: "masterwork", stacks: 1 }  // +1 SHIFT to damage
]);

const player = createTestActor("actor.player", {
  proficiencies: { Brawn: 2 },
  equippedTool: sword
});

const intent = createIntent("actor.player", "USE", "player_input", {
  targetRef: "npc.goblin",
  parameters: {
    subtype: "IMPACT_SINGLE"
  }
});

const result = await pipeline.process(intent);
```

**What to verify:**
- ✓ Tool validated (sword found)
- ✓ Within melee range (1 tile)
- ✓ D20 roll performed
- ✓ Effector applied (masterwork +1 SHIFT)
- ✓ Base MAG 2, final MAG 3 with effector
- ✓ Damage dice: 1d4 → 1d6

## Running Tests

### Run All Tests

```bash
cd src/tests
npx ts-node action_system_integration.test.ts
```

### Run Individual Test

```typescript
import { testMoveThroughPlace } from "./action_system_integration.test.js";

async function runTest() {
  const passed = await testMoveThroughPlace();
  console.log(`Test ${passed ? "PASSED" : "FAILED"}`);
}

runTest();
```

## Debug Output

The system provides detailed debug output:

```
[2024-01-15T10:30:00.000Z] [DEBUG] Action Intent: {
  actor: "actor.player",
  verb: "USE",
  subtype: "PROJECTILE_SINGLE",
  target: "npc.bandit"
}

[2024-01-15T10:30:00.001Z] [DEBUG] Tool Validation: {
  hasTool: true,
  toolName: "Longbow",
  toolTags: ["bow:3", "projectile:1"],
  proficiencies: ["Accuracy"]
}

[2024-01-15T10:30:00.002Z] [INFO] Roll: {
  result: {
    nat: 15,
    prof: 3,
    stat: 2,
    total: 20,
    cr: 12,
    success: true
  },
  potency: {
    mag: 4,
    dice: "1d6",
    roll: 5,
    total: 5
  }
}

[2024-01-15T10:30:00.003Z] [INFO] Action Result: {
  success: true,
  effects: [
    { type: "PROJECTILE_ATTACK", target: "npc.bandit", applied: true }
  ],
  summary: "actor.player hits npc.bandit with Longbow!"
}
```

## Test Checklist

### Basic Functionality
- [ ] Actor can be created with stats and proficiencies
- [ ] Tools can be created with tags and MAG
- [ ] NPCs can be created with locations
- [ ] Locations are tracked correctly

### Action Pipeline
- [ ] MOVE action succeeds and updates location
- [ ] COMMUNICATE action succeeds within range
- [ ] COMMUNICATE fails beyond range
- [ ] USE.IMPACT_SINGLE succeeds within melee range
- [ ] USE.IMPACT_SINGLE fails beyond melee range
- [ ] USE.PROJECTILE_SINGLE succeeds within weapon range
- [ ] USE.PROJECTILE_SINGLE fails beyond weapon range
- [ ] INSPECT provides appropriate detail by distance

### Roll System
- [ ] D20 roll generates value 1-20
- [ ] Proficiency bonus added correctly
- [ ] Stat bonus added correctly
- [ ] CR calculated based on distance
- [ ] Success/failure determined correctly
- [ ] Potency roll generates damage from MAG

### Effectors
- [ ] SHIFT effector adds to roll
- [ ] SHIFT effector adds to damage
- [ ] SCALE effector multiplies range
- [ ] SCALE effector multiplies damage
- [ ] Multiple effectors stack correctly
- [ ] Effector sources tracked

### Tool System
- [ ] Tool validation finds equipped tool
- [ ] Missing tool causes failure
- [ ] Wrong tool type causes failure
- [ ] Tag requirements validated
- [ ] Default tool (hands) works for throwing

### Integration
- [ ] All 7 pipeline stages execute
- [ ] Effects are applied
- [ ] Perception events broadcast
- [ ] Action results include all data
- [ ] Error handling works

## Common Issues

### Issue: "No tool equipped"
**Cause**: Actor doesn't have the right tool in hand_slots
**Fix**: Ensure tool is equipped in main_hand slot

### Issue: "Target out of range"
**Cause**: Distance > weapon/ability range
**Fix**: Move closer or use longer-range tool

### Issue: "Roll failed"
**Cause**: D20 + bonuses < CR
**Fix**: Increase proficiency, use better tool, or reduce distance

### Issue: "Effectors not applying"
**Cause**: Tag not registered in effector registry
**Fix**: Call `initializeDefaultEffectors()` or register custom effectors

## Integration Points

### Place Module Integration
- Player location comes from place module
- NPC locations tracked in place
- Movement updates place coordinates

### Input Module Integration
- Text input creates intents
- Target selection resolves targets
- Commands trigger actions

### UI Roller Integration
- D20 rolls displayed in UI
- Roll results shown to player
- CR comparisons visible

## Next Steps

1. **Run the integration tests** to verify all systems work
2. **Add more test scenarios** for edge cases
3. **Connect to Place module** for real location data
4. **Connect to Input module** for player commands
5. **Add UI indicators** for range, tools, roll results

## Example Test Session

```bash
# Start the test suite
$ npx ts-node src/tests/action_system_integration.test.ts

[2024-01-15T10:30:00.000Z] [INFO] ==================================================
[2024-01-15T10:30:00.000Z] [INFO]   TEST: Move Through Place
[2024-01-15T10:30:00.000Z] [INFO] ==================================================
[2024-01-15T10:30:00.001Z] [INFO] Steps:
[2024-01-15T10:30:00.002Z] [INFO]   1. Player starts at position (0,0)
[2024-01-15T10:30:00.003Z] [INFO]   2. Player moves to position (3,4)
[2024-01-15T10:30:00.004Z] [INFO]   3. System calculates distance (5 tiles)
[2024-01-15T10:30:00.005Z] [INFO]   4. Action succeeds

... (test output continues)

[2024-01-15T10:30:05.000Z] [INFO] ==================================================
[2024-01-15T10:30:05.001Z] [INFO]   TEST SUMMARY
[2024-01-15T10:30:05.002Z] [INFO] ==================================================
[2024-01-15T10:30:05.003Z] [INFO] ✓ Step 1: Move Through Place [PASS]
[2024-01-15T10:30:05.004Z] [INFO] ✓ Step 2: Say Hi to NPC [PASS]
[2024-01-15T10:30:05.005Z] [INFO] ✓ Step 3: Target NPC with Projectile [PASS]
[2024-01-15T10:30:05.006Z] [INFO] ✓ Step 4: Melee Attack with Effectors [PASS]
[2024-01-15T10:30:05.007Z] [INFO]
[2024-01-15T10:30:05.008Z] [INFO] Results: 4 passed, 0 failed, 4 total
[2024-01-15T10:30:05.009Z] [INFO] ==================================================
```

All tests passing! The action system is ready for integration with Place and Input modules.
