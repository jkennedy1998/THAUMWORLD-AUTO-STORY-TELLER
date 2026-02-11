# Communication System Bug Fixes

**Date:** 2026-02-10  
**Issue:** NPCs (like Grenda) appearing unresponsive

## Root Causes Found

### 1. Aggressive Content-Based Deduplication (Frontend)
**File:** `src/canvas_app/app_state.ts:638-643`

**Problem:** NPC messages were being filtered based on content, not just ID:
```typescript
// OLD CODE - Too aggressive
if (sender.startsWith('npc.')) {
    const contentKey = `${sender}:${content}`;
    if (seen_content.has(contentKey)) return false;  // Filters duplicates!
    seen_content.add(contentKey);
    return true;
}
```

This meant if Grenda said "Hello" twice (in different conversations), only the first would show!

**Fix:** Removed content-based deduplication, keeping only ID-based deduplication which prevents true duplicates:
```typescript
// NEW CODE - Allows same content, different messages
if (sender.startsWith('npc.')) return true;  // Allow all NPC messages
```

### 2. Log Accumulation (Performance Issue)
**File:** `src/canvas_app/app_state.ts` (frontend) and `src/engine/log_store.ts` (backend)

**Problem:** The log was never cleared, causing:
- Performance issues with sorting/filtering on every poll
- Frontend processing hundreds/thousands of old messages
- Memory bloat

**Fix:** 
- **Backend:** Added log rotation (keep last 500 messages)
- **Frontend:** Limit to processing only last 200 messages per poll

### 3. Missing Debug Logging
**Problem:** Hard to trace message flow when issues occur

**Fix:** Added console logging at key points:
- Frontend: Logs how many messages are processed/shown
- Backend: Logs when NPC messages are displayed in Breath function

## Changes Made

### 1. `src/canvas_app/app_state.ts`
- Removed aggressive content-based deduplication for NPC messages (lines 638-643)
- Added message limit (200) before sorting/filtering to prevent performance issues
- Added debug logging to track NPC message filtering

### 2. `src/engine/log_store.ts`
- Added log rotation to `append_log_message()` (keep last 500 messages)
- Added log rotation to `append_log_envelope()` (keep last 500 messages)

### 3. `src/interface_program/main.ts`
- Added console logging when NPC messages are displayed by Breath function

## Testing Recommendations

1. **Test NPC Response:** 
   - Click on Grenda
   - Type "hello"
   - Verify she responds

2. **Test Duplicate Content:**
   - Say "hello" to Grenda
   - Wait for her response
   - Say "hello" again
   - Both should appear (not filtered as duplicates)

3. **Check Console Logs:**
   - Look for `[Breath] Displaying NPC message from npc.grenda: ...`
   - Look for `[fetch_log_messages] Processed X messages, showing Y (Z NPC)`

## Files Modified

1. `src/canvas_app/app_state.ts` - Message filtering logic
2. `src/engine/log_store.ts` - Log rotation
3. `src/interface_program/main.ts` - Debug logging

## Verification

- TypeScript compilation: ✅ No new errors
- Frontend changes: ✅ Process only recent 200 messages
- Backend changes: ✅ Rotate log at 500 messages
- Debug logging: ✅ Added to trace NPC message flow

## Next Steps

If NPCs are still unresponsive after these fixes:

1. Check browser console for the new debug logs
2. Verify the backend `/api/log` endpoint returns messages with sender like "npc.grenda"
3. Check if NPC_AI is actually generating responses (check npc_ai logs)
4. Verify ActionPipeline is triggering witness reactions

The system should now properly display all NPC responses without filtering them out.
