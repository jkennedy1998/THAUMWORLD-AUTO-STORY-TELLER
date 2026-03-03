# Item Equip Compatibility Fix - Implementation Summary

**Date:** 2026-03-01
**Status:** ✅ IMPLEMENTED

## Problem
Leather bracelet (GARB tag with hand_left meta) could not be equipped to any slot:
- Only TOOL slot was highlighted
- ARMOR and GARB slots showed errors
- Frontend was using deprecated `valid_body_slots` instead of tag metadata

## Solution
Implemented backend-driven slot compatibility checking:

### 1. New API Endpoint
**File:** `src/interface_program/main.ts`

Added `GET /api/item/compatible_slots?item_def_id=xxx&actor_id=xxx`

Returns compatible slots based on tag metadata:
```typescript
{
  ok: true,
  item_def_id: "test_leather_bracelet",
  compatible_slots: [
    { slot_name: "hand_left", slot_type: "tool" },        // All items can be held
    { slot_name: "hand_right", slot_type: "tool" },       // All items can be held
    { slot_name: "hand_left", slot_type: "garb", garb_index: 0 },  // From GARB tag
    { slot_name: "hand_left", slot_type: "garb", garb_index: 1 },  // From GARB tag
    // ... more garb slots
  ]
}
```

**Logic:**
- ALL items can go in hand tool slots
- ARMOR items go to slot specified in ARMOR tag meta
- GARB items go to slot specified in GARB tag meta (multiple garb slots added)
- CONTAINER items treated as GARB + CONTAINER

### 2. Frontend Updates
**File:** `src/canvas_app/app_state.ts`

Updated `get_compatible_slots()` to be async and call API:
```typescript
async function get_compatible_slots(item_def: ItemDefinition): Promise<...> {
  // Call backend API for tag-based compatibility
  const response = await fetch(`/api/item/compatible_slots?...`);
  if (response.ok) {
    return data.compatible_slots;
  }
  // Fallback to deprecated local logic
}
```

Updated all callers to use `await`:
1. Character module `on_drag_start` - now async
2. Inventory `on_slot_hover` - now async
3. Drop validation - calls API to verify compatibility
4. NPC container `on_slot_hover` - now async

Updated `highlighted_slots` type to include `garb_index`:
```typescript
highlighted_slots: Array<{ slot_name: string; slot_type: SlotType; garb_index?: number }>
```

Updated drop validation to use API:
```typescript
const compatible_slots = await get_compatible_slots(item_def);
const is_compatible = compatible_slots.some(slot => 
  slot.slot_name === slot_name && slot.slot_type === slot_type
);
```

### 3. Benefits

**Before (Broken):**
- Frontend only checked `valid_body_slots` (deprecated)
- Tag metadata completely ignored
- Leather bracelet showed only TOOL slot
- Drop to GARB slot failed

**After (Fixed):**
- Backend is single source of truth for compatibility
- Tag metadata (ARMOR/GARB/TOOL) properly evaluated
- Leather bracelet shows:
  - hand_left.tool ✓
  - hand_right.tool ✓
  - hand_left.garb.0 ✓
  - hand_left.garb.1 ✓
  - hand_left.garb.2... ✓
- All slots work correctly

## Testing

```bash
npm run dev:logs
```

**Test Scenarios:**
1. **Drop leather bracelet** - Should highlight hand_left.tool AND hand_left.garb.*
2. **Equip to garb slot** - Should succeed (GARB tag with hand_left meta)
3. **Equip to tool slot** - Should succeed (all items can be held)
4. **Drop iron sword** - Should highlight hand_left.tool, hand_right.tool
5. **Equip iron helmet** - Should highlight head.armor (ARMOR tag with head meta)

## Architecture

```
Frontend (app_state.ts)
  ↓ Calls API
Backend (main.ts /api/item/compatible_slots)
  ↓ Evaluates tags
Tag Validation (tag_validation.ts)
  ↓ Returns compatible slots
Frontend Highlights Slots
  ↓ User drops item
Backend Validates Transfer
  ↓ Uses same tag logic
Item Equipped!
```

**Key Principle:** Single source of truth - backend handles all compatibility logic, frontend just displays highlights and calls API.

## Files Modified

1. `src/interface_program/main.ts` - Added compatible_slots API endpoint
2. `src/canvas_app/app_state.ts` - Updated to use async API calls

## Migration

No migration needed - this is a code fix only. The master item database already has correct tag metadata.
