# THAUMWORLD Timed Events System

## Overview

The Timed Events system implements THAUMWORLD's turn-based mechanics for combat, conversation, and exploration. It manages initiative order, action costs, and turn advancement automatically.

Current build note (2026-02-13): `interpreter_ai` is archived. Timed events are triggered by completed `ruling_*` messages (file-backed pipeline) that include `.ATTACK(` or `.COMMUNICATE(` in `meta.events`/`meta.machine_text`.

## Features Implemented

### 1. Automatic Timed Event Triggers
- **Combat**: Starts when any actor/NPC attacks another in close proximity
- **Conversation**: Starts when actors communicate with NPCs
- **Exploration**: Can be triggered for time-sensitive exploration scenarios

### 2. Initiative System
- Rolls 1d20 + DEX bonus for all participants
- Higher DEX breaks ties
- Random tie-breaker if DEX is equal
- Sorted initiative order displayed to players

### 3. Turn Management
- Tracks whose turn it is
- Enforces action costs (FULL, PARTIAL, EXTENDED)
- Prevents actions when not your turn
- Prevents actions when no actions remaining
- Auto-advances to next participant when current is done

### 4. NPC AI in Timed Events
- NPCs take their own turns automatically
- Simple behavior based on event type:
  - Combat: Attack, defend, or assess
  - Conversation: Listen and respond
  - Exploration: Observe surroundings
- NPCs communicate once and pass turn (simplified for now)

### 5. Region Tracking
- Tracks which region the timed event is in
- NPCs/Actors automatically leave event if they exit the region
- Event ends when all participants are done or have left

### 6. Action Cost Enforcement
- **FULL actions**: Consume 1 full action per turn
- **PARTIAL actions**: Consume 1 partial action (or 1 full if no partials left)
- **EXTENDED actions**: Don't consume turn actions (happen between turns)
- System prevents actions if insufficient resources

## Architecture

### New Service: Turn Manager (`src/turn_manager/main.ts`)
- Polls every 500ms for state changes
- Watches for ATTACK and COMMUNICATE ruling messages
- Manages initiative rolling and turn order
- Processes NPC turns automatically
- Checks for region exits
- Ends events when complete

### Extended World Store (`src/world_storage/store.ts`)
Added data structures:
- `InitiativeEntry`: Tracks each participant's state
- `TimedEventEffect`: Queue for delayed effects
- Extended `WorldStore` with timed event fields
- Helper functions for managing timed events

### Action Cost Checking (`src/rules_lawyer/effects.ts`)
- Validates action costs during timed events
- Checks if it's the actor's turn
- Consumes actions after successful actions
- Reports errors for invalid actions

## Data Structures

### World Store Extension
```typescript
type WorldStore = {
  // ... existing fields ...
  
  // Timed Event State
  timed_event_active?: boolean;
  timed_event_id?: string;
  timed_event_type?: "combat" | "conversation" | "exploration";
  
  // Turn Management
  current_turn?: number;
  current_round?: number;
  initiative_order?: InitiativeEntry[];
  active_actor_index?: number;
  
  // Region tracking
  event_region?: {
    world_x: number;
    world_y: number;
    region_x: number;
    region_y: number;
  };
};

type InitiativeEntry = {
  actor_ref: string;
  initiative_roll: number;
  dex_score: number;
  has_acted_this_turn: boolean;
  actions_remaining: number;
  partial_actions_remaining: number;
  movement_remaining: number;
  status: "active" | "passed" | "left_region" | "done";
};
```

## Flow Diagram

```
Player: "attack goblin"
  ↓
[Rules/Effects Pipeline] → ruling_* (done)
  - Message `meta.events`/`meta.machine_text` includes `.ATTACK(` or `.COMMUNICATE(`
  ↓
[Turn Manager detects ATTACK]
  - Checks if timed event already active
  - If not, starts new combat event
  - Rolls initiative for all participants
  - Creates initiative announcement
  ↓
[Turn Manager manages turns]
  - Announces whose turn it is
  - If NPC turn: processes automatically
  - If Player turn: waits for input
  - Checks for region exits
  - Advances turn when actor is done
  ↓
[Event ends when all done]
  - Creates end announcement
  - Clears timed event state
```

## Testing

### Test 1: Combat Timed Event
```
1. Player: "attack goblin"
2. System: "Combat begins! 2 participants."
3. System: "Initiative order: 1. henry_actor (17), 2. goblin (12)"
4. System: "Turn 1: henry_actor's turn"
5. Player: (can take actions)
6. Player: "pass turn" or run out of actions
7. System: "Goblin prepares to attack."
8. System: "Turn 2: henry_actor's turn"
9. (Repeat until combat ends)
```

### Test 2: Conversation Timed Event
```
1. Player: "hello shopkeep"
2. System: "Conversation begins! 2 participants."
3. System: "Initiative order: 1. shopkeep (15), 2. henry_actor (13)"
4. System: "Turn 1: shopkeep's turn"
5. System: "Shopkeep listens attentively."
6. System: "Turn 2: henry_actor's turn"
7. Player: (can communicate)
8. (Ends when both pass)
```

### Test 3: Action Cost Enforcement
```
1. Combat begins
2. Player: "attack goblin" (uses FULL action)
3. Player: "attack goblin again" (uses PARTIAL action)
4. Player: "attack goblin third time"
5. System: "You have no actions remaining. Say 'pass turn' to end your turn."
6. Player: "pass turn"
7. System: "Turn 2: goblin's turn"
```

### Test 4: Region Exit
```
1. Combat begins in region (0,0,0,0)
2. Player moves to different region
3. System: "Henry_actor has left the region and is no longer participating."
4. Combat continues with remaining participants
```

## Commands

### During Your Turn
- Any action verb: ATTACK, DEFEND, DODGE, USE, etc.
- "pass turn" - End your turn early

### Action Costs
- FULL: Uses your main action for the turn
- PARTIAL: Uses a partial action (2 per turn)
- EXTENDED: Happens between turns, doesn't consume actions

## Files Modified/Created

### New Files
- `src/turn_manager/main.ts` - Turn management service

### Modified Files
- `src/world_storage/store.ts` - Added timed event data structures
- `src/rules_lawyer/effects.ts` - Added action cost checking
- `scripts/dev.js` - Added turn_manager to startup
- `package.json` - Added turn_manager_dev script

## Future Enhancements

1. **Initiative UI**: Visual tracker showing turn order
2. **Status Effects**: POISONED, DEFENDING, etc. with durations
3. **Complex NPC AI**: Tactical decision making
4. **Movement Tracking**: Track movement distance per turn
5. **Held Actions**: Support for HOLD action type
6. **Simultaneous Actions**: Handle tied initiative

## Debugging

### Enable Debug Logging
```bash
set DEBUG_LEVEL=3
npm run dev
```

### Check Timed Event State
```bash
# View world state
cat local_data/data_slot_1/world/world.jsonc | jq '.timed_event_active, .current_turn, .initiative_order'
```

### Monitor Turn Manager
```bash
# Run turn manager individually
npm run turn_manager_dev
```

## Integration with Existing Systems

- **Message Pipeline**: Turn manager watches ruling messages to detect triggers
- **Action System**: Rules lawyer enforces action costs
- **NPC AI**: NPCs automatically take turns
- **Renderer**: Shows turn announcements and initiative order
- **State Applier**: Applies effects normally during timed events

The timed events system integrates seamlessly with the existing pipeline without breaking any current functionality.
