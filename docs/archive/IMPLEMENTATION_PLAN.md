# THAUMWORLD Auto Story Teller - Implementation Plan
## Working Memory & Timed Events Architecture

**Version:** 1.0  
**Date:** February 1, 2026  
**Status:** Planning Phase  
**Approach:** Option C + Enhancements (Conversation-Centric Architecture)

---

## Executive Summary

This document outlines the complete implementation plan for transforming the THAUMWORLD Auto Story Teller into a robust tabletop RPG system with sophisticated AI-driven NPCs, working memory management, and timed event handling.

**Key Goals:**
- Modular architecture where steps can be added/modified in isolation
- Local data storage prevents AI hallucination (unless intentionally creating new content)
- Working memory system for context-aware NPC behavior
- Flexible NPC action system (AI-driven or scripted)
- Sustainable, legible codebase

---

## Core Architecture Principles

### 1. Unified Message System
All game events flow through a single pipeline:
```
User Input → Interpreter → Data Broker → Rules Lawyer → State Applier → Renderer → Display
                                    ↓
                              NPC AI (when needed)
```

### 2. Working Memory Pattern
- **Short-term:** Active timed events maintain working memory
- **Relevance-filtered:** Only load what's needed for current context
- **Prunable:** Automatic cleanup when too large or stale
- **Hierarchical:** Global → Regional → Event → Participant

### 3. Data Integrity
- All game state stored locally in JSONC files
- AI receives only references, not full data
- AI can suggest new content, but system validates before creation
- No hallucinated NPCs, items, or locations

### 4. Modular Services
Each service has a single responsibility:
- **Interpreter:** Natural language → Machine commands
- **Data Broker:** Reference resolution & data loading
- **Rules Lawyer:** THAUMWORLD rules validation
- **State Applier:** Game state modifications
- **Renderer:** Narrative generation
- **NPC AI:** NPC decision making (when needed)
- **Turn Manager:** Timed event coordination
- **Context Manager:** Working memory maintenance

---

## Phase 1: Foundation (Weeks 1-2)

### 1.1 Message System Refactoring

**Goal:** Fix current inbox/outbox issues, establish proper message flow

**Tasks:**
- [ ] Add `displayed` boolean flag to message schema
- [ ] Modify interface program to mark messages as displayed instead of clearing inbox
- [ ] Implement message retention policy (keep last 100 messages, archive older)
- [ ] Add `conversation_id` field to messages
- [ ] Create message routing logic based on `role` field

**Files to Modify:**
- `src/interface_program/main.ts` - Breath() function
- `src/engine/message.ts` - Message schema
- `src/engine/inbox_store.ts` - Display tracking

**Success Criteria:**
- NPC responses appear in UI without being consumed
- Messages persist for conversation history
- No message loss during processing

### 1.2 Conversation Threading

**Goal:** Group related messages into conversations

**Tasks:**
- [ ] Generate `conversation_id` for COMMUNICATE actions
- [ ] Track `turn_number` within conversations
- [ ] Add conversation metadata (participants, topic, start_time)
- [ ] Create conversation lookup functions
- [ ] Handle conversation branching (multiple people talking)

**Files to Modify:**
- `src/interpreter_ai/main.ts` - Generate conversation IDs
- `src/state_applier/main.ts` - Track conversation state
- `src/npc_ai/main.ts` - Inherit conversation context

**Success Criteria:**
- "hello grenda" and her response share same conversation_id
- Can retrieve full conversation history
- Multiple NPCs can join same conversation

### 1.3 Data Broker Enhancement

**Goal:** Ensure robust parsing with normalization

**Tasks:**
- [ ] Implement machine text normalization (already done - verify working)
- [ ] Add aggressive normalization fallback
- [ ] Log normalization events for debugging
- [ ] Create validation layer before parsing

**Files to Modify:**
- `src/data_broker/main.ts` - Normalization functions (already implemented)
- `src/system_syntax/parser.ts` - Error handling

**Success Criteria:**
- JSON-style syntax auto-corrected
- Clear error messages when parsing fails
- Pipeline doesn't get stuck on syntax errors

---

## Phase 2: Working Memory System (Weeks 3-4)

### 2.1 Context Manager Service

**Goal:** New service to manage working memory for timed events

**Tasks:**
- [ ] Create `src/context_manager/main.ts`
- [ ] Define WorkingMemory data structures
- [ ] Implement memory building from region + participants
- [ ] Create relevance filtering algorithms
- [ ] Add memory pruning logic
- [ ] Implement TTL (time-to-live) for memories

**Data Structures:**
```typescript
type WorkingMemory = {
  event_id: string;
  event_type: "combat" | "conversation" | "exploration";
  created_at: string;
  last_updated: string;
  ttl_seconds: number;
  
  region: {
    id: string;
    name: string;
    description: string;
    atmosphere: string;
    conditions: string[]; // "dim_light", "rain", "noisy"
  };
  
  participants: ParticipantMemory[];
  recent_events: RecentEvent[];
  conversation_thread?: ConversationThread;
  
  memory_budget: {
    max_participants: number;
    max_recent_events: number;
    max_conversation_history: number;
  };
};

type ParticipantMemory = {
  ref: string;
  name: string;
  role: "ally" | "enemy" | "neutral" | "unknown";
  
  // Visual/observable only
  visible_equipment: string[];
  notable_features: string[];
  current_status: string[]; // "wounded", "defending", "casting"
  
  // Behavioral
  personality_summary: string;
  relationship_to_player: string;
  emotional_state: string;
  
  // Recent activity
  last_action?: string;
  turns_since_last_action: number;
  
  // For AI decision making
  likely_intentions?: string[];
  threat_level?: number;
};
```

**Files to Create:**
- `src/context_manager/main.ts` - Service entry point
- `src/context_manager/memory_builder.ts` - Build memory from data
- `src/context_manager/relevance_filter.ts` - Filter what to load
- `src/context_manager/pruning.ts` - Memory cleanup

**Integration Points:**
- Reads from: World storage, Actor storage, NPC storage
- Writes to: Working memory cache (in-memory + periodic save)
- Provides to: NPC AI, Renderer AI, Turn Manager

### 2.2 Relevance Filtering System

**Goal:** Smart loading of only relevant information

**Tasks:**
- [ ] Create action-to-context mapping
- [ ] Implement visibility checking (what can NPCs actually see?)
- [ ] Build relationship graph (who knows who)
- [ ] Create "notable features" extraction from character sheets

**Action Context Mapping:**
```typescript
const ACTION_CONTEXT_RULES = {
  "ATTACK": {
    load_for_observer: ["visible_weapons", "armor", "wounds", "stance"],
    load_for_target: ["defensive_options", "wounds", "status_effects"],
    ignore: ["inventory", "exact_stats", "background_lore"]
  },
  
  "COMMUNICATE": {
    load_for_all: ["personality", "emotional_state", "relationship"],
    load_from_history: ["last_3_exchanges", "unresolved_topics"],
    ignore: ["combat_stats", "equipment_not_visible"]
  },
  
  "INSPECT": {
    load_for_target: ["detailed_description", "hidden_features", "lore"],
    ignore: ["personality_not_relevant"]
  },
  
  "USE_ITEM": {
    load_for_observer: ["item_visual_effect", "skill_level_approximation"],
    ignore: ["item_stats", "inventory_contents"]
  }
};
```

**Files to Create:**
- `src/context_manager/relevance_rules.ts` - Action mapping
- `src/context_manager/visibility.ts` - What can be seen

### 2.3 Regional Awareness System

**Goal:** NPCs can overhear conversations if nearby

**Tasks:**
- [ ] Define "nearby" based on region layout
- [ ] Create awareness check at conversation start
- [ ] Add eavesdropping NPCs to conversation participants
- [ ] Track which NPCs are actively participating vs. just listening
- [ ] Allow NPCs to join mid-conversation

**Implementation:**
```typescript
function getNearbyNPCs(region_id: string, exclude: string[]): string[] {
  // Get all NPCs in same region
  // Filter out those who are asleep, deaf, or intentionally ignoring
  // Return list of NPC refs who can potentially hear
}

function startConversation(initiator: string, text: string): string {
  const conversation_id = generate_id();
  const nearby = getNearbyNPCs(current_region, [initiator]);
  
  // Add all nearby NPCs as listeners
  const participants = [initiator, ...nearby];
  
  // Mark which ones are active vs. passive
  const active_participants = [initiator]; // Only initiator starts active
  const passive_listeners = nearby;
  
  return conversation_id;
}
```

**Files to Modify:**
- `src/context_manager/conversation.ts` - Conversation management
- `src/npc_ai/main.ts` - Handle passive listening

---

## Phase 3: NPC AI Enhancement (Weeks 5-6)

### 3.1 Decision Hierarchy

**Goal:** Tiered decision making (scripted → cached → AI)

**Tasks:**
- [ ] Create decision tree for common situations
- [ ] Implement scripted response database
- [ ] Add template-based responses for frequent scenarios
- [ ] Build "should use AI?" checker
- [ ] Create AI call optimization

**Decision Flow:**
```
NPC Turn Triggered
  ↓
Check Scripted Responses
  - Greeting player? → Use cached greeting
  - Attacked? → Immediate counter-attack
  - Low health? → Run away
  ↓
If no scripted response fits:
  Check Template Database
  - Shopkeeper + question → Use shopkeeper template
  - Guard + threat → Use guard template
  ↓
If template insufficient:
  Call AI with Working Memory
  - AI decides action based on context
  - AI generates response text
  - Cache response for future similar situations
```

**Files to Create:**
- `src/npc_ai/decision_tree.ts` - Scripted logic
- `src/npc_ai/template_db.ts` - Cached responses
- `src/npc_ai/ai_caller.ts` - When to use AI

### 3.2 Action Selection System

**Goal:** NPCs can choose from available actions

**Tasks:**
- [ ] Create available actions list per NPC
- [ ] Build action prioritization logic
- [ ] Implement "what do you do?" prompt for AI
- [ ] Add action validation (can they actually do it?)
- [ ] Create action swaying system (influence NPC decisions)

**Available Actions Format:**
```typescript
type AvailableAction = {
  verb: ActionVerb;
  targets: string[]; // Who/what can be targeted
  reason: string; // Why this action is available
  priority: number; // 1-10, higher = more likely
  requirements: {
    min_health?: number;
    equipment_needed?: string[];
    status_required?: string[];
    status_forbidden?: string[];
  };
};

// Example for guard NPC:
const guard_actions: AvailableAction[] = [
  {
    verb: "ATTACK",
    targets: ["enemies_in_range"],
    reason: "Hostile targets present",
    priority: 8,
    requirements: { min_health: 30 }
  },
  {
    verb: "DEFEND",
    targets: ["self", "allies"],
    reason: "Protecting vulnerable allies",
    priority: 6,
    requirements: { equipment_needed: ["shield"] }
  },
  {
    verb: "COMMUNICATE",
    targets: ["player", "allies"],
    reason: "Warn about danger",
    priority: 5,
    requirements: {}
  },
  {
    verb: "USE",
    targets: ["healing_potion", "weapon"],
    reason: "Emergency survival",
    priority: 9,
    requirements: { 
      status_forbidden: ["POISONED"],
      min_health: 20
    }
  }
];
```

**AI Prompt Structure:**
```
You are [NPC Name], [personality summary].

Current Situation:
- You are in [location], which is [atmosphere]
- Your health is [status]
- You see: [list of visible participants with notable features]
- Recent events: [last 3 things that happened]

Available Actions:
1. ATTACK [target] - [reason] (priority: 8)
2. DEFEND [ally] - [reason] (priority: 6)
3. COMMUNICATE "warning" - [reason] (priority: 5)
4. USE healing_potion - [reason] (priority: 9)

What do you do? Choose ONE action and describe your intent.

Response format:
ACTION: [verb]
TARGET: [target_ref]
REASONING: [why you chose this]
DIALOGUE: [what you say, if anything]
```

**Files to Create:**
- `src/npc_ai/action_selector.ts` - Choose from available actions
- `src/npc_ai/prompt_builder.ts` - Build AI prompts

### 3.3 Sway System

**Goal:** Influence NPC decisions without forcing them

**Tasks:**
- [ ] Add "suggested_actions" field to working memory
- [ ] Create sway factors (intimidation, persuasion, bribes)
- [ ] Modify action priorities based on sway
- [ ] Ensure NPCs can still choose against suggestions

**Implementation:**
```typescript
type SwayFactor = {
  type: "intimidation" | "persuasion" | "bribe" | "threat" | "friendship";
  magnitude: number; // -10 to +10
  source: string; // Who is applying sway
  reason: string;
};

function applySway(actions: AvailableAction[], sway: SwayFactor[]): AvailableAction[] {
  return actions.map(action => {
    let priority_mod = 0;
    
    // Example: Intimidation increases DEFEND priority
    if (action.verb === "DEFEND" && sway.some(s => s.type === "intimidation")) {
      priority_mod += 2;
    }
    
    // Friendship increases HELP priority
    if (action.verb === "HELP" && sway.some(s => s.type === "friendship")) {
      priority_mod += 3;
    }
    
    return {
      ...action,
      priority: Math.min(10, action.priority + priority_mod)
    };
  });
}
```

---

## Phase 4: Conversation Memory (Weeks 7-8)

### 4.1 Conversation Storage

**Goal:** Full conversation data preserved before summarization

**Tasks:**
- [ ] Create conversation archive system
- [ ] Store full message text, timestamps, emotional tone
- [ ] Track conversation branches (side conversations)
- [ ] Link related conversations (continued later)

**Storage Format:**
```typescript
type ConversationArchive = {
  conversation_id: string;
  started_at: string;
  ended_at?: string;
  region_id: string;
  
  participants: {
    ref: string;
    joined_at: string;
    left_at?: string;
    role: "active" | "passive" | "eavesdropper";
  }[];
  
  messages: {
    turn: number;
    speaker: string;
    text: string;
    timestamp: string;
    emotional_tone: string;
    action_verb?: string;
  }[];
  
  topics_discussed: string[];
  unresolved_points: string[];
  agreements_reached: string[];
  conflicts_raised: string[];
};
```

**Files to Create:**
- `src/conversation_manager/archive.ts` - Store full conversations
- `src/conversation_manager/retrieval.ts` - Query conversation history

### 4.2 Pre-AI Formatting

**Goal:** Systemic culling of formatting before AI processing

**Tasks:**
- [ ] Create conversation formatter
- [ ] Remove redundant information
- [ ] Extract key points only
- [ ] Standardize timestamp formats
- [ ] Compress repetitive exchanges

**Formatting Rules:**
```typescript
function formatForAI(conversation: ConversationArchive): string {
  // Remove system timestamps (keep relative time only)
  // Remove exact location coordinates (keep "in the shop" only)
  // Compress greetings ("hello" "hi" "greetings" → "[greeting exchange]")
  // Highlight key information discussed
  // Mark emotional turning points
  
  return `
Conversation at ${conversation.region_id}
Participants: ${conversation.participants.map(p => p.ref).join(', ')}
Duration: ${calculateDuration(conversation)}

Key Exchanges:
${conversation.messages
  .filter(m => isSignificant(m)) // Only significant messages
  .map(m => `${m.speaker}: ${m.text}`)
  .join('\n')}

Topics: ${conversation.topics_discussed.join(', ')}
Unresolved: ${conversation.unresolved_points.join(', ') || 'None'}
  `;
}
```

**Files to Create:**
- `src/conversation_manager/formatter.ts` - Pre-AI formatting

### 4.3 AI Summarization

**Goal:** Compress conversations for long-term NPC memory

**Tasks:**
- [ ] Create summarization prompts
- [ ] Store summaries in NPC memory
- [ ] Link summaries to full archives
- [ ] Retrieve relevant summaries based on context

**Summarization Prompt:**
```
Summarize this conversation for [NPC Name]'s memory:

[Formatted conversation]

Create a memory that includes:
1. Who was involved
2. What was discussed (main topics only)
3. Any agreements, conflicts, or promises made
4. [NPC Name]'s emotional reaction
5. What [NPC Name] learned or decided

Format as:
MEMORY: [2-3 sentence summary]
EMOTION: [how they feel about it]
LEARNED: [key information gained]
DECIDED: [any resolutions made]
```

**Files to Create:**
- `src/conversation_manager/summarizer.ts` - AI summarization
- `src/npc_storage/memory.ts` - Store in NPC character sheets

---

## Phase 5: Turn Manager Enhancement (Weeks 9-10)

### 5.1 Turn State Machine

**Goal:** Robust turn management for all timed events

**Tasks:**
- [ ] Define turn phases (start, action, resolution, end)
- [ ] Create turn order management
- [ ] Implement simultaneous actions for tied initiative
- [ ] Add turn timer (optional)
- [ ] Handle turn interruptions (reactions, held actions)

**State Machine:**
```
TIMED_EVENT_START
  ↓
INITIATIVE_ROLL
  ↓
TURN_START (for each participant in order)
  ↓
ACTION_SELECTION
  - Player: Wait for input
  - NPC: Decision tree → AI if needed
  ↓
ACTION_RESOLUTION
  - Validate action
  - Apply effects
  - Update working memory
  ↓
TURN_END
  ↓
CHECK_EVENT_END_CONDITIONS
  - All enemies defeated? → End combat
  - Conversation resolved? → End conversation
  - Time limit reached? → End exploration
  ↓
TIMED_EVENT_END
```

**Files to Modify:**
- `src/turn_manager/main.ts` - State machine implementation

### 5.2 Action Validation

**Goal:** Ensure actions are valid before execution

**Tasks:**
- [ ] Check action costs (FULL, PARTIAL, EXTENDED)
- [ ] Validate targets are in range/visible
- [ ] Verify equipment requirements
- [ ] Check status effect restrictions
- [ ] Prevent impossible actions

**Files to Create:**
- `src/turn_manager/validator.ts` - Action validation

### 5.3 Reaction System

**Goal:** Allow actions outside normal turn order

**Tasks:**
- [ ] Implement HOLD action (ready an action)
- [ ] Add reaction triggers (opportunity attacks, etc.)
- [ ] Create reaction priority system
- [ ] Handle reaction chains

**Files to Create:**
- `src/turn_manager/reactions.ts` - Reaction handling

---

## Phase 6: Integration & Testing (Weeks 11-12)

### 6.1 Service Integration

**Goal:** All services work together seamlessly

**Tasks:**
- [ ] Wire Context Manager to all AI services
- [ ] Ensure Turn Manager coordinates with NPC AI
- [ ] Verify conversation flow between all components
- [ ] Test working memory updates across turns
- [ ] Validate message routing

**Integration Tests:**
1. Player talks to NPC → NPC responds with context
2. Combat starts → NPCs take turns → Actions use working memory
3. Long conversation → Gets summarized → NPC remembers key points
4. Multiple NPCs in region → All hear conversation → Can join
5. Timed event ends → Working memory archived → Clean state for next event

### 6.2 Performance Optimization

**Goal:** System runs smoothly with multiple NPCs

**Tasks:**
- [ ] Profile AI call frequency
- [ ] Optimize working memory building
- [ ] Cache frequently accessed data
- [ ] Implement request batching where possible
- [ ] Add performance metrics

**Files to Modify:**
- Add metrics collection to all services
- Optimize data loading patterns

### 6.3 Documentation

**Goal:** Clear documentation for future development

**Tasks:**
- [ ] Document all service APIs
- [ ] Create architecture diagrams
- [ ] Write developer guides for adding new actions
- [ ] Document AI prompt patterns
- [ ] Create troubleshooting guide

**Files to Create:**
- `docs/ARCHITECTURE.md` - System overview
- `docs/SERVICES.md` - Service documentation
- `docs/AI_PROMPTS.md` - AI prompt patterns
- `docs/DEVELOPER_GUIDE.md` - How to extend

---

## Technical Specifications

### Data Storage

**Working Memory:**
- Stored in-memory during active events
- Periodically saved to `local_data/data_slot_1/working_memory/` for crash recovery
- Cleared when timed event ends

**Conversation Archives:**
- Stored in `local_data/data_slot_1/conversations/`
- Full conversation: `[conversation_id]_full.jsonc`
- AI summary: `[conversation_id]_summary.jsonc`
- Pruned after 30 days (configurable)

**NPC Memories:**
- Stored in NPC character sheets
- Recent memories: Array of last 10 summaries
- Long-term: Key relationship events only

### Performance Targets

- **Message latency:** < 3 seconds from input to display
- **AI decision time:** < 5 seconds for NPC turns
- **Working memory build:** < 100ms
- **Conversation summary:** < 10 seconds (async)
- **Max concurrent events:** 5 timed events
- **Max participants per event:** 20

### Error Handling

**Graceful Degradation:**
- If AI service down: Use scripted responses
- If working memory fails: Fall back to basic context
- If parsing fails: Log error, use fallback template
- If data missing: Generate placeholder, log warning

**Recovery:**
- Auto-retry failed AI calls (3 attempts)
- Save state every 5 turns for crash recovery
- Clear corrupted working memory and rebuild from scratch

---

## Future Extensions (Post-Launch)

### Advanced Features
- **Long-term NPC relationships:** Track how NPCs feel about player over time
- **Faction system:** NPCs remember faction allegiances
- **Rumor propagation:** Information spreads between NPCs
- **Dynamic quests:** NPCs generate quests based on working memory
- **Emotional AI:** NPCs have persistent emotional states
- **Learning AI:** NPCs learn player patterns and adapt

### Scalability
- **Distributed services:** Run services on separate machines
- **Database backend:** Replace JSONC with proper database
- **Caching layer:** Redis for working memory
- **Load balancing:** Multiple AI service instances

---

## Development Guidelines

### Adding New Actions
1. Add to `ACTION_VERBS` list
2. Create relevance rules in context manager
3. Add scripted responses (optional)
4. Add to NPC action selector
5. Create narrative generator in renderer
6. Add validation rules
7. Test with working memory

### Modifying Services
1. Maintain backward compatibility for message formats
2. Update documentation
3. Add metrics for new functionality
4. Test integration with all other services
5. Document breaking changes

### AI Prompt Changes
1. Version control prompts
2. A/B test changes
3. Monitor response quality
4. Cache successful responses
5. Document prompt engineering decisions

---

## Success Metrics

**Technical:**
- Zero message loss
- < 5% AI call failure rate
- < 3 second average response time
- 100% data integrity

**Gameplay:**
- NPCs respond contextually 90% of the time
- Conversations feel natural (player feedback)
- Combat flows smoothly without delays
- Players feel NPCs remember them

**Development:**
- New features take < 1 week to implement
- Bugs are isolated to single services
- Code is readable and documented
- System is stable for long play sessions

---

## Current Status

**Completed:**
- ✅ Basic service architecture
- ✅ Message pipeline
- ✅ Timed events (turn manager)
- ✅ Data broker normalization
- ✅ Interpreter syntax improvements

**In Progress:**
- 🔄 Message display fix (Phase 1.1)

**Next Up:**
- ⏳ Context Manager service (Phase 2)
- ⏳ Working memory system
- ⏳ NPC AI enhancement

---

## Notes & Decisions

**Decision Log:**
- **Date:** 2026-02-01
- **Decision:** Use Option C + Enhancements (Conversation-Centric)
- **Rationale:** Supports all RPG requirements, modular, sustainable
- **Implications:** 12-week implementation, requires Context Manager service

**Open Questions:**
- Should we use a proper database instead of JSONC files? (Decision: Not for MVP)
- How many turns of history should working memory keep? (Decision: Last 5 events)
- Should NPCs share working memory or have individual views? (Decision: Shared with individual filters)

**Risk Mitigation:**
- **Risk:** AI costs too high
  - **Mitigation:** Aggressive caching, scripted responses for common cases
- **Risk:** Working memory too large
  - **Mitigation:** Strict pruning, relevance filtering, TTL
- **Risk:** Complex debugging
  - **Mitigation:** Extensive logging, metrics, clear service boundaries

---

**Document Owner:** Development Team  
**Review Schedule:** Weekly during implementation  
**Last Updated:** 2026-02-01  
**Next Review:** 2026-02-08
