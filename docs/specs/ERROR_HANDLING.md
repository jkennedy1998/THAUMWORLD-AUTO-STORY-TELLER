# THAUMWORLD Error Handling Standards

Standardized error logging and handling across all services.

## Overview

All services use unified error logging with:
- **Console output** (colored by severity)
- **File logging** (structured JSONC)
- **Consistent format** (service, operation, context, error)

## Error Logging Functions

### Primary Function: `log_service_error()`

**Location:** `src/shared/debug.ts`

**Signature:**
```typescript
log_service_error(
    service: string,      // Service name (e.g., "state_applier")
    operation: string,    // Operation being performed (e.g., "process_message")
    context: Record<string, unknown>,  // Relevant context data
    err: unknown,         // The error object
    severity?: 'error' | 'warning' | 'critical'  // Default: 'error'
): void
```

**Usage:**
```typescript
import { log_service_error } from "../shared/debug.js";

try {
    await process_message(outbox_path, log_path, msg);
} catch (err) {
    log_service_error(
        "state_applier",
        "process_message",
        { 
            message_id: msg.id,
            stage: msg.stage,
            correlation_id: msg.correlation_id,
            slot: data_slot_number
        },
        err,
        'error'
    );
}
```

**Output (Console):**
```
[StateApplier] ERROR in process_message
  Context: {"message_id":"2026-01-31...","stage":"ruling_1"}
  Error: Failed to apply damage: target not found
```

**Output (File):**
```jsonc
{
  "timestamp": "2026-01-31T12:00:00.000Z",
  "service": "state_applier",
  "operation": "process_message",
  "severity": "error",
  "context": {
    "message_id": "2026-01-31...",
    "stage": "ruling_1",
    "correlation_id": "..."
  },
  "error": {
    "message": "Failed to apply damage: target not found",
    "type": "Error",
    "stack": "..."  // Only if DEBUG_LEVEL >= 4
  }
}
```

### Convenience Functions

#### `log_critical_error()`
For system-critical failures that may require immediate attention.

```typescript
log_critical_error(
    "interface_program",
    "http_server",
    { port: 8787 },
    err
);
```

**Console Output:**
```
[InterfaceProgram] CRITICAL in http_server
  Context: {"port":8787}
  Error: EADDRINUSE: address already in use :::8787
```

#### `log_warning()`
For non-fatal issues that don't stop processing.

```typescript
log_warning(
    "rules_lawyer",
    "apply_damage",
    { target: "npc.goblin", amount: 5 },
    "Target already at minimum health"
);
```

**Console Output:**
```
[RulesLawyer] WARNING in apply_damage
  Context: {"target":"npc.goblin","amount":5}
  Message: Target already at minimum health
```

## Severity Levels

| Level | Color | Use Case | DEBUG_LEVEL |
|-------|-------|----------|-------------|
| `critical` | Red | System failure, data corruption | >= 1 |
| `error` | Red | Operation failed, state inconsistent | >= 1 |
| `warning` | Yellow | Non-fatal issue, recovered | >= 2 |

## Error Log File

**Location:** `local_data/data_slot_1/logs/error_log.jsonc`

**Structure:**
```jsonc
{
  "schema_version": 1,
  "entries": [
    {
      "timestamp": "2026-01-31T12:00:00.000Z",
      "service": "state_applier",
      "operation": "process_message",
      "severity": "error",
      "context": { ... },
      "error": {
        "message": "...",
        "type": "Error",
        "stack": "..."
      },
      "correlation_id": "...",
      "message_id": "..."
    }
  ]
}
```

**Retention:** Last 500 errors (automatically pruned)

## Service Error Handling Patterns

### Pattern 1: Try-Catch with Continue

Use when one failure shouldn't stop other processing.

```typescript
for (const msg of candidates) {
    try {
        await process_message(outbox_path, log_path, msg);
    } catch (err) {
        log_service_error(
            "state_applier",
            "process_message",
            { message_id: msg.id },
            err
        );
        // Continue to next message
    }
}
```

### Pattern 2: Try-Catch with Halt

Use when error is fatal to the operation.

```typescript
try {
    const outbox = read_outbox(outbox_path);
} catch (err) {
    log_critical_error(
        "state_applier",
        "read_outbox",
        { outbox_path },
        err
    );
    return;  // Halt processing
}
```

### Pattern 3: Validation with Warning

Use for recoverable validation failures.

```typescript
if (!target_path) {
    log_warning(
        "state_applier",
        "resolve_target",
        { target_ref },
        "Target path not found, skipping effect"
    );
    return { diffs: [], warnings: ["Target not resolved"] };
}
```

## Context Best Practices

### Always Include:
- `message_id`: For tracing to specific message
- `correlation_id`: For tracing full pipeline run
- `slot`: Data slot number (for multi-slot systems)
- `stage`: Current processing stage
- Operation-specific data (e.g., `target`, `effect_type`)

### Example Contexts by Service:

**interface_program:**
```typescript
{
    http_path: "/api/input",
    actor_id: "henry_actor",
    input_length: text.length
}
```

**interpreter_ai (archived):**
```typescript
{
    session_id: session_key,
    model: INTERPRETER_MODEL,
    prompt_length: prompt.length,
    iteration: retry_count
}
```

**data_broker:**
```typescript
{
    command_count: commands.length,
    unresolved_refs: failed_refs,
    iteration: error_iteration
}
```

**rules_lawyer:**
```typescript
{
    command_verb: command.verb,
    target: command.args.target,
    roll_result: roll.total
}
```

**state_applier:**
```typescript
{
    message_id: msg.id,
    effects_count: effects.length,
    target_ref: target,
    effect_type: command.verb
}
```

**renderer_ai:**
```typescript
{
    session_id: session_key,
    events_count: events.length,
    effects_count: effects.length
}
```

**npc_ai:**
```typescript
{
    npc_id: npc_hit.id,
    npc_name: npc.name,
    target_actor: actor_id,
    perception_clarity: clarity
}
```

## Debugging with Error Logs

### View Recent Errors
```bash
# View last 10 errors
cat local_data/data_slot_1/logs/error_log.jsonc | jq '.entries | .[-10:]'

# Filter by service
cat local_data/data_slot_1/logs/error_log.jsonc | jq '.entries | map(select(.service == "state_applier"))'

# Filter by severity
cat local_data/data_slot_1/logs/error_log.jsonc | jq '.entries | map(select(.severity == "critical"))'
```

### Monitor in Real-Time
```bash
# Watch error log (Unix)
tail -f local_data/data_slot_1/logs/error_log.jsonc

# Or use DEBUG_LEVEL=3 and watch console
set DEBUG_LEVEL=3
npm run dev
```

### Find Errors by Correlation ID
```bash
# Find all errors in a specific pipeline run
cat local_data/data_slot_1/logs/error_log.jsonc | jq '.entries | map(select(.correlation_id == "2026-01-31..."))'
```

## Error Handling Checklist

When adding error handling to a service:

- [ ] Import `log_service_error` from `../shared/debug.js`
- [ ] Wrap risky operations in try-catch
- [ ] Include relevant context (message_id, correlation_id, slot)
- [ ] Choose appropriate severity level
- [ ] Decide: continue or halt on error?
- [ ] Test error scenario with DEBUG_LEVEL=3
- [ ] Verify error appears in console
- [ ] Verify error appears in error_log.jsonc (DEBUG_LEVEL >= 2)

## Migration from Old Error Handling

**Old Pattern:**
```typescript
try {
    await process();
} catch (err) {
    debug_error("Service", "Failed to process", err);
}
```

**New Pattern:**
```typescript
try {
    await process();
} catch (err) {
    log_service_error(
        "service_name",
        "process_operation",
        { message_id: msg.id, correlation_id: msg.correlation_id },
        err,
        'error'
    );
}
```

## Next Steps

- See [SERVICES.md](../design/SERVICES.md) for service-specific error handling
- See [examples/](./examples/) for working error handling patterns
- Use DEBUG_LEVEL=4 for full stack traces during development
