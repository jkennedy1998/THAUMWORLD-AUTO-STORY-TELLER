# Action Verbs - Implementation TODO

**Date:** February 6, 2026  
**Status:** Active Implementation Plan  
**Priority:** Medium

---

## Overview

This document tracks the remaining THAUMWORLD action verb narrative generators that need to be implemented in the Renderer AI system.

## Current Implementation Status

### ✅ Completed Verbs
1. **INSPECT** - Environmental descriptions and discoveries
2. **ATTACK** - Combat actions with hit/miss narratives
3. **COMMUNICATE** - Speech and conversation handling
4. **MOVE** - Travel and movement descriptions
5. **USE** - Item interactions and usage

### ⏳ Pending Implementation

#### High Priority
1. **HELP** - Assist allies in combat or tasks
2. **DEFEND** - Block/parry incoming attacks  
3. **DODGE** - Evade attacks or hazards
4. **GRAPPLE** - Wrestle and restrain targets

#### Medium Priority
5. **CRAFT** - Create items and equipment
6. **GUARD** - Watch and protect area
7. **HOLD** - Ready action for trigger condition

#### Lower Priority (Extended Actions)
8. **SLEEP** - Rest and recover
9. **REPAIR** - Fix damaged items
10. **WORK** - Labor and production

---

## Implementation Pattern

For each verb, create:

1. **Narrative Generator Function**
   ```typescript
   function generate<Verb>NarrativePrompt(context: RendererContext): string
   ```

2. **Prompt Characteristics:**
   - Descriptive, immersive language
   - 1-3 sentences output
   - Second person perspective ("You...")
   - Handle both success and failure cases
   - Include THAUMWORLD-specific context from docs/EFFECTS.md

3. **Integration:**
   - Add case in `build_renderer_prompt()` switch statement
   - Include in action verb type definitions
   - Add to test suite

---

## Verb Specifications

### HELP
**Use Cases:**
- Assist ally in combat (+2 to ally's roll)
- Help with skill check (advantage)
- Provide distraction/support

**Narrative Elements:**
- Ally being helped
- Type of assistance
- Success/failure outcome
- Visual description

**Example Output:**
```
You position yourself beside Grenda, ready to intercept any attacks. 
Your presence bolsters her confidence as she focuses on her task.
```

---

### DEFEND
**Use Cases:**
- Block incoming attack
- Parry with weapon
- Shield ally
- Defensive stance

**Narrative Elements:**
- Attacker and attack type
- Defense method (shield/weapon/dodge)
- Success: Blocked/mitigated
- Failure: Partial/no protection

**Example Output:**
```
You raise your shield just as the bandit's blade descends. 
The impact shudders through your arm, but you hold firm, 
protecting yourself from the brunt of the blow.
```

---

### DODGE
**Use Cases:**
- Evade melee attack
- Dodge projectile
- Avoid hazard/trap
- Dive for cover

**Narrative Elements:**
- What's being dodged
- Movement description
- Success: Clean evasion
- Failure: Partial hit/glancing blow

**Example Output:**
```
You see the arrow speeding toward you and throw yourself sideways. 
The missile whistles past your ear, close enough to ruffle your hair 
before thunking into the tree behind you.
```

---

### GRAPPLE
**Use Cases:**
- Wrestle opponent
- Restrain target
- Break grapple
- Pin enemy

**Narrative Elements:**
- Opponent
- Grapple type (wrestle/restrain/pin)
- Strength contest
- Success: Restrained/pinned
- Failure: Broken free

**Example Output:**
```
You lunge forward, wrapping your arms around the goblin. 
It squeals and thrashes, but you leverage your weight, 
slamming it to the ground and pinning its arms behind its back.
```

---

### CRAFT
**Use Cases:**
- Smith weapon/armor
- Brew potion
- Create item
- Repair equipment

**Narrative Elements:**
- Item being crafted
- Materials used
- Tools required
- Time investment
- Quality of result

**Example Output:**
```
Hours pass as you carefully fold and hammer the heated steel. 
Your sweat drips onto the anvil, sizzling away instantly. 
Finally, you quench the blade, and it emerges with a keen edge 
gleaming in the firelight.
```

---

### GUARD
**Use Cases:**
- Watch area for threats
- Protect person/place
- Stand sentry
- Monitor entrance

**Narrative Elements:**
- Area/person guarded
- Duration
- Alertness level
- Any discoveries

**Example Output:**
```
You find a defensible position near the cave entrance, 
weapons at the ready. Hours pass in tense silence as you 
scan the shadows for any movement, your senses heightened.
```

---

### HOLD
**Use Cases:**
- Ready action for trigger
- Prepare response
- Wait for condition
- Interrupt opportunity

**Narrative Elements:**
- Action being held
- Trigger condition
- Prepared state
- Resolution or expiration

**Example Output:**
```
You nock an arrow and draw the bowstring, eyes fixed on the corridor. 
 muscles tense, ready to loose the moment an enemy appears. 
Time stretches as you maintain your aim, waiting...
```

---

### SLEEP (Extended)
**Use Cases:**
- Rest and recover HP
- Overnight camping
- Long rest

**Narrative Elements:**
- Sleep location
- Rest quality
- Dreams (optional)
- HP recovery
- Time passed

---

### REPAIR (Extended)
**Use Cases:**
- Fix damaged equipment
- Mend armor
- Sharpen weapon

**Narrative Elements:**
- Item being repaired
- Damage extent
- Tools used
- Success level
- Time required

---

### WORK (Extended)
**Use Cases:**
- Manual labor
- Production tasks
- Foraging/gathering

**Narrative Elements:**
- Type of work
- Location
- Effort expended
- Results produced
- Time invested

---

## Files to Modify

1. `src/renderer_ai/main.ts` - Add narrative generator functions
2. `src/renderer_ai/types.ts` - Update action verb types
3. `docs/EFFECTS.md` - Document effect implementations
4. `tests/renderer_ai.test.ts` - Add test cases

---

## Success Criteria

For each implemented verb:
- [ ] Narrative generator function created
- [ ] Integrated into build_renderer_prompt switch
- [ ] Handles success case appropriately
- [ ] Handles failure case appropriately  
- [ ] Uses THAUMWORLD lore/terminology
- [ ] Produces 1-3 sentence output
- [ ] Tested with multiple scenarios
- [ ] Documented in EFFECTS.md

---

## Notes

**Priority Rationale:**
- High priority verbs are combat-critical and frequently used
- Medium priority supports core gameplay loops
- Lower priority are extended actions (less frequent)

**Implementation Tips:**
- Study existing verb implementations for patterns
- Reference docs/EFFECTS.md for mechanics
- Keep prompts descriptive but concise
- Consider both PC and NPC perspectives

---

**Last Updated:** February 6, 2026  
**Status:** Active Implementation Plan
