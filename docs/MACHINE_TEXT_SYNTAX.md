# Machine Text Syntax Specification

## Overview

Machine text is the strict, parseable format used for commands in the THAUMWORLD Auto Story Teller system. It bridges natural language input from players with the game engine's mechanical systems.

## Formal Grammar

```ebnf
command_line      ::= subject "." verb "(" named_args ")"
subject           ::= identifier ("." identifier)*
verb              ::= identifier | "SYSTEM." identifier
named_args        ::= (identifier "=" value ("," identifier "=" value)*)?
value             ::= string | number | boolean | identifier | list | object
string            ::= '"' (char | '\"' | '\\')* '"'
number            ::= [0-9]+ ("." [0-9]+)?
boolean           ::= "true" | "false"
identifier        ::= [a-zA-Z_][a-zA-Z0-9_]*
list              ::= "[" (value ("," value)*)? "]"
object            ::= "{" (identifier "=" value ("," identifier "=" value)*)? "}"
```

## Critical Syntax Rules

### 1. ALWAYS Use Equals Sign (=)
- **CORRECT**: `targets=[npc.glenda]`
- **CORRECT**: `{type=RESULT, amount=8}`
- **WRONG**: `targets=[{ref: npc.glenda}]` (uses colon)
- **WRONG**: `{type: RESULT, amount: 8}` (uses colons)

### 2. No Trailing Commas
- **CORRECT**: `[npc.glenda, npc.thorn]`
- **WRONG**: `[npc.glenda, npc.thorn,]`
- **CORRECT**: `{name=FLINCH, amount=2}`
- **WRONG**: `{name=FLINCH, amount=2,}`

### 3. All Strings Double-Quoted
- **CORRECT**: `text="hello there"`
- **WRONG**: `text=hello` (unquoted)
- **WRONG**: `text='hello'` (single quotes)

### 4. Subject-Verb Chain
- Must have at least one dot separating subject from verb
- **CORRECT**: `actor.player.ATTACK(...)`
- **CORRECT**: `SYSTEM.APPLY_DAMAGE(...)`
- **WRONG**: `ATTACK(...)` (missing subject)

## Reference Types

### Actors
Format: `actor.<actor_id>`

Examples:
- `actor.henry_actor`
- `actor.player`
- `actor.grenda` (if grenda is an actor, not NPC)

### NPCs
Format: `npc.<npc_id>`

Examples:
- `npc.grenda`
- `npc.gunther`
- `npc.thorn`
- `npc.sister_bramble`

### Items
Format: `item.<item_id>` or `actor.<id>.inventory.item_<id>`

Examples:
- `item.iron_dagger`
- `actor.player.inventory.item_torch`

### Locations
World tiles: `world_tile.<x>.<y>`
- Example: `world_tile.0.0`

Region tiles: `region_tile.<world_x>.<world_y>.<region_x>.<region_y>`
- Example: `region_tile.0.0.0.0`

Tiles: `tile.<world_x>.<world_y>.<region_x>.<region_y>.<tile_x>.<tile_y>`
- Example: `tile.0.0.0.0.5.5`

Regions (new format): `region.<region_id>`
- Example: `region.eden_crossroads`

## Action Verbs

These verbs require a `tool` argument:
- `USE` - Use an item
- `ATTACK` - Attack a target
- `HELP` - Assist someone
- `DEFEND` - Defensive stance
- `GRAPPLE` - Grapple with target
- `INSPECT` - Examine something
- `COMMUNICATE` - Speak to someone
- `DODGE` - Dodge action
- `CRAFT` - Create items
- `SLEEP` - Rest and recover
- `REPAIR` - Fix equipment
- `MOVE` - Change location
- `WORK` - Perform work
- `GUARD` - Guard position
- `HOLD` - Ready action

## System Verbs

Format: `SYSTEM.<effect>`

Common system effects:
- `SYSTEM.APPLY_DAMAGE(target=<ref>, amount=<number>, type=<damage_type>)`
- `SYSTEM.APPLY_HEAL(target=<ref>, amount=<number>)`
- `SYSTEM.APPLY_TAG(target=<ref>, tag=<tag_name>, stacks=<number>, duration=<number>)`
- `SYSTEM.REMOVE_TAG(target=<ref>, tag=<tag_name>)`
- `SYSTEM.ADJUST_INVENTORY(target=<ref>, item=<item_ref>, delta=<number>)`
- `SYSTEM.SET_AWARENESS(observer=<ref>, target=<ref>, clarity=<clarity_level>)`
- `SYSTEM.ADVANCE_TIME(turns=<number>)`

## Valid Examples

### Communication
```javascript
actor.player.COMMUNICATE(
    tool=actor.player.voice,
    targets=[npc.grenda],
    text="hello!",
    language=lang.common,
    senses=[pressure],
    tone="neutral",
    contexts=[region_tile.0.0.0.0]
)
```

### Attack
```javascript
actor.player.ATTACK(
    target=npc.goblin,
    tool=actor.player.hands,
    action_cost=FULL,
    roll={type=RESULT, dice="D20", effectors=[], target_cr=10},
    potency={type=POTENCY, amount=1, dice="1d2", effectors=[]}
)
```

### Inspect
```javascript
actor.player.INSPECT(
    target=region_tile.0.0.0.0,
    tool=actor.player.hands,
    contexts=[region_tile.0.0.0.0]
)
```

### Move
```javascript
actor.player.MOVE(
    target=region.eden_commons,
    tool=actor.player.hands,
    mode="walk",
    action_cost=FULL
)
```

### System Effect
```javascript
SYSTEM.APPLY_DAMAGE(
    target=npc.goblin,
    amount=8,
    type=slashing
)
```

## Invalid Examples (NEVER DO THIS)

### Wrong: NPC as Subject
```javascript
// WRONG - NPCs cannot be subjects
actor.grenda.COMMUNICATE(...)

// CORRECT - Player is subject, NPC is target
actor.player.COMMUNICATE(targets=[npc.grenda], ...)
```

### Wrong: JSON-style Colons
```javascript
// WRONG - Uses colons
{ref: npc.glenda}
{type: RESULT, mag: 1}

// CORRECT - Uses equals
{ref= npc.glenda}
{type=RESULT, amount=1}
```

### Wrong: Trailing Commas
```javascript
// WRONG
[npc.glenda, npc.thorn,]
{name=FLINCH, amount=2,}

// CORRECT
[npc.glenda, npc.thorn]
{name=FLINCH, amount=2}
```

### Wrong: Unquoted Strings
```javascript
// WRONG
text=hello

// CORRECT
text="hello"
```

## Common Patterns

### Targets List
Simple list of references:
```javascript
targets=[npc.grenda]
targets=[npc.grenda, npc.thorn]
targets=[region_tile.0.0.0.0]
```

### Roll Objects
```javascript
roll={type=RESULT, dice="D20", effectors=[], target_cr=10}
roll={type=POTENCY, dice="1d4", effectors=[{stat=STR, bonus=2}]}
```

### Potency Objects
```javascript
potency={type=POTENCY, amount=2, dice="1d6", effectors=[]}
```

### Tag Arrays
```javascript
tags=[{name=POISONED, amount=3, info=[]}]
tags=[{name=FLINCH, amount=1, info=["duration=3"]}]
```

## Auto-Correction

The system includes auto-correction for common syntax errors:

1. **Colons to Equals**: `{ref: value}` → `{ref= value}`
2. **Simplify Targets**: `targets=[{ref: npc.x}]` → `targets=[npc.x]`
3. **Remove Trailing Commas**: `[a, b,]` → `[a, b]`
4. **Fix Double Equals**: `key==value` → `key=value`

While auto-correction helps, always aim to generate correct syntax.

## Debugging Tips

1. **Check for dots**: Every command needs `subject.verb(`
2. **Check equals signs**: Every key=value pair needs `=` not `:`
3. **Check quotes**: All text values must be "double-quoted"
4. **Check commas**: No trailing commas in lists or objects
5. **Check brackets**: Lists use `[]`, objects use `{}`

## Implementation Notes

- The parser uses recursive descent with clear error messages
- Error format: `E_EXPECTED:expected '=' after object key@1:66`
- Line and column numbers help locate errors
- The system attempts tolerant parsing with normalization
- Strict mode can be enabled for testing

## Version History

- **v1.0**: Initial specification
- **v1.1**: Added region references (region.<id>)
- **v1.2**: Clarified equals vs colon syntax
- **v1.3**: Added auto-correction documentation
