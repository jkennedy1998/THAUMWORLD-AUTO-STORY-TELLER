# AI Prompt Patterns

## Overview

This document describes the AI prompt patterns used throughout THAUMWORLD for consistent, high-quality responses.

## Prompt Engineering Principles

1. **Clear Role Definition** - AI knows exactly what role to play
2. **Explicit Constraints** - Clear boundaries on what to generate
3. **Format Specification** - Structured output formats
4. **Context Inclusion** - Relevant context without overload
5. **Example Guidance** - Examples of desired output

---

## Service Prompts

### 1. Interpreter AI Prompt (Archived)

Current build note: `interpreter_ai` is archived. Player/NPC actions are created in `interface_program` and executed via the ActionPipeline; this prompt is preserved for historical reference only.

**Purpose (legacy):** Parse natural language into machine commands

**Pattern:**
```
You are a command parser for a fantasy RPG system.

RULES:
1. Convert player input to machine commands
2. Use format: actor.<id>.<VERB>(param=value,...)
3. Available verbs: [LIST]
4. Resolve ambiguous references
5. Never invent new entities

EXAMPLES:
Input: "attack the goblin"
Output: actor.player.ATTACK(target=npc.goblin)

Input: "say hello to Grenda"
Output: actor.player.COMMUNICATE(target=npc.grenda, message="hello")

INPUT: "{player_input}"
OUTPUT:
```

**Key Elements:**
- Clear role (command parser)
- Format specification
- Available actions list
- Examples of input/output pairs
- Explicit constraints

**Location:** `archive/interpreter_ai/` (archived in this build)

---

### 2. Renderer AI Prompt

**Purpose:** Convert system events into narrative text

**Pattern:**
```
You are a fantasy RPG narrator.

STYLE:
- Engaging and immersive
- Show, don't tell
- Use sensory details
- Maintain consistent tone
- Never break character

INPUT:
Events: [list of system events]
Context: [working memory context]

OUTPUT:
Generate a narrative description of what happens.
Keep it to 2-3 paragraphs.
Focus on the player's perspective.
```

**Key Elements:**
- Creative role (narrator)
- Style guidelines
- Input data structure
- Output constraints

**Location:** `src/renderer_ai/main.ts`

---

### 3. NPC AI Prompt (Basic)

**Purpose:** Generate NPC responses

**Pattern:**
```
You are {NPC_NAME}, {NPC_ROLE}.

PERSONALITY:
- Goal: {story_goal}
- Fear: {fear}
- Flaw: {flaw}
- Passion: {passion}

CURRENT SITUATION:
{memory_context}

Player says: "{player_message}"

Respond as {NPC_NAME} would:
- Stay in character
- Reference personality traits
- React to situation
- Keep to 1-2 sentences
```

**Key Elements:**
- Character roleplay
- Personality context
- Current situation
- Response constraints

**Location:** `src/npc_ai/main.ts`

---

### 4. NPC AI Prompt (Enhanced - Phase 3+)

**Purpose:** Generate NPC responses with decision hierarchy

**Pattern:**
```
You are {NPC_NAME}, {NPC_ROLE}.

PERSONALITY:
{personality_summary}

CURRENT SITUATION:
{working_memory_context}

AVAILABLE ACTIONS:
1. {action_1} - {reason} (priority: {priority})
2. {action_2} - {reason} (priority: {priority})
...

DECISION:
Choose ONE action and describe your response.

RESPONSE FORMAT:
ACTION: {chosen_action}
REASONING: {why you chose this}
DIALOGUE: {what you say}
```

**Key Elements:**
- Action selection guidance
- Priority information
- Structured output format
- Decision reasoning

**Location:** `src/npc_ai/main.ts` (enhanced version)

---

### 5. Conversation Summarizer Prompt

**Purpose:** Summarize conversations for NPC memory

**Pattern:**
```
You are {NPC_NAME}. {personality}

You just had this conversation:
{formatted_conversation}

Create a memory from YOUR perspective:

MEMORY: [2-3 sentences summarizing what happened]

EMOTION: [how you feel: "pleased", "angry", "suspicious", etc.]

LEARNED:
- [fact 1]
- [fact 2]

DECIDED:
- [decision 1]
- [decision 2]

RELATIONSHIPS:
- [person]: [improved/worsened/unchanged] - [reason]
```

**Key Elements:**
- First-person perspective
- Structured sections
- Emotional context
- Relationship tracking

**Location:** `src/conversation_manager/summarizer.ts`

---

## Common Patterns

### Pattern 1: Role-First

Always start with role definition:
```
You are a {role}.

{specific_instructions}
```

### Pattern 2: Context Sandwich

Wrap instructions around context:
```
{role_definition}

CONTEXT:
{dynamic_context}

{output_instructions}
```

### Pattern 3: Structured Output

Specify exact output format:
```
Respond in this format:
FIELD_1: [value]
FIELD_2: [value]
```

### Pattern 4: Few-Shot Examples

Provide examples for complex tasks:
```
EXAMPLES:
Input: X → Output: Y
Input: A → Output: B

YOUR TURN:
Input: {actual_input}
Output:
```

### Pattern 5: Constraint Listing

Explicit constraints prevent hallucination:
```
CONSTRAINTS:
- Never invent new characters
- Only use provided information
- Stay within the scene context
- Don't break the fourth wall
```

---

## Prompt Optimization

### Token Efficiency

**Before (inefficient):**
```
You are an NPC in a fantasy world. You should respond to the player...
[200 tokens of general instructions]
```

**After (efficient):**
```
You are {name}, {brief_description}.
Respond to: "{input}"
[50 tokens, specific context]
```

### Context Pruning

Only include relevant context:
- ✅ Recent events (last 3-5 turns)
- ✅ Visible participants
- ✅ Current location
- ❌ Full character backstory
- ❌ Distant events
- ❌ Irrelevant details

### Progressive Disclosure

Start simple, add complexity only when needed:
1. Basic prompt
2. Add personality if needed
3. Add working memory if needed
4. Add available actions if needed

---

## Phase-Specific Patterns

### Phase 2: Working Memory Integration

```
SITUATION:
You are in {location}. {atmosphere}

PRESENT:
{filtered_participants}

RECENTLY:
{recent_events}

{standard_prompt}
```

### Phase 3: Decision Hierarchy

```
{standard_prompt}

AVAILABLE ACTIONS:
{action_list_with_priorities}

Choose the most appropriate action based on:
- Your personality
- Current situation
- Available options
```

### Phase 4: Memory Integration

```
{standard_prompt}

YOU REMEMBER:
{formatted_memories}

Consider your past experiences when responding.
```

### Phase 5: Turn Context

```
{standard_prompt}

TURN CONTEXT:
- Round: {round}
- Your action points: {ap}
- Held action: {held_action}

Choose actions considering turn constraints.
```

---

## Testing Prompts

### Test Checklist

- [ ] Role is clear
- [ ] Format is specified
- [ ] Constraints are explicit
- [ ] Examples are provided (if complex)
- [ ] Context is relevant
- [ ] Output is structured
- [ ] Edge cases are handled

### A/B Testing

Test variations:
```
Version A: Detailed personality description
Version B: Brief personality keywords

Measure: Response quality, consistency, relevance
```

### Token Counting

Monitor token usage:
- System prompt: ~50-100 tokens
- Context: ~100-500 tokens
- User input: ~10-50 tokens
- Total: Keep under 2000 for speed

---

## Common Issues & Solutions

### Issue 1: Hallucination

**Problem:** AI invents information

**Solution:**
```
CONSTRAINTS:
- Only use information provided above
- If unsure, say "I don't know"
- Never invent names, places, or facts
```

### Issue 2: Format Violations

**Problem:** AI doesn't follow output format

**Solution:**
```
You MUST respond in this exact format:
FIELD: value

Any other format will be rejected.
```

### Issue 3: Out of Character

**Problem:** AI breaks character

**Solution:**
```
STAY IN CHARACTER:
- Never mention game mechanics
- Never break the fourth wall
- Never reference being an AI
- Always respond as {name} would
```

### Issue 4: Too Verbose

**Problem:** Responses too long

**Solution:**
```
CONSTRAINTS:
- Maximum 2 sentences
- Be concise
- Focus on key information
```

### Issue 5: Ignoring Context

**Problem:** AI ignores provided context

**Solution:**
```
IMPORTANT: Use the CURRENT SITUATION above.
Your response MUST reference:
- At least one visible participant
- The current location
- A recent event
```

---

## Advanced Techniques

### Chain of Thought

For complex decisions:
```
Think through your response:
1. What is the player asking?
2. How would {name} feel about this?
3. What is the most appropriate response?
4. [Generate response]
```

### Self-Correction

Ask AI to verify its output:
```
Generate your response, then verify:
- Is this in character?
- Does it reference the situation?
- Is it the appropriate length?

If not, revise before outputting.
```

### Dynamic Temperature

Adjust based on task:
- **Creative (narrative):** Temperature 0.8
- **Parsing (interpreter):** Temperature 0.3
- **Decision (NPC):** Temperature 0.7
- **Summary:** Temperature 0.5

---

## Model-Specific Notes

### Llama 3.2

**Strengths:**
- Good at following instructions
- Consistent formatting
- Fast inference

**Tips:**
- Use clear delimiters (###, ---)
- Be explicit about constraints
- Provide examples for complex tasks

### Other Models

If using different models:
- Test prompt format compatibility
- Adjust temperature
- Verify output consistency
- Check token limits

---

## Version Control

### Prompt Versioning

Track prompt changes:
```typescript
const PROMPT_VERSION = "1.2.0";
const PROMPT_CHANGES = [
    "1.0.0: Initial prompt",
    "1.1.0: Added working memory",
    "1.2.0: Added action selection"
];
```

### A/B Testing Results

Document test results:
```
Test: Personality detail level
Date: 2026-02-01
Result: Brief keywords > Detailed description
Quality: +15%
Speed: +20%
```

---

## Resources

- [OpenAI Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)
- [Anthropic Claude Best Practices](https://docs.anthropic.com/claude/docs/prompt-engineering)
- [Llama Prompting Guide](https://llama.meta.com/docs/prompting/)

## Examples

See `examples/prompts/` for:
- `interpreter_examples.md`
- `renderer_examples.md`
- `npc_ai_examples.md`
- `summarizer_examples.md`
