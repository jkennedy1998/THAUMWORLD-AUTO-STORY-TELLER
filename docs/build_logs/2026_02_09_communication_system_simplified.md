# Communication System - Build Log

**Date:** 2026-02-09  
**Status:** ✅ Week 1, Day 3 Revised: Using Existing Systems

---

## ✅ Completed: Simplified Visual Feedback

### User Feedback: Use Existing Systems

**Key Insight:** The existing hover system already provides highlighting and entity info display. Don't create duplicate systems.

### What Already Existed

**1. Hover Highlighting** (`place_module.ts` lines 786-811)
- Shows pale_orange highlight on hover
- Uses canvas cell color inversion
- Works for any entity under mouse

**2. Hover Info Display** (`place_module.ts` lines 845-862)
- Shows `[ref] status` at bottom-left
- Updates in real-time
- Displays entity reference and current status

**3. Target Selection Callback** (`place_module.ts` config)
- `on_select_target` callback in PlaceModuleConfig
- Already designed for target selection

### Changes Made

#### 1. `src/mono_ui/modules/place_module.ts`

**Added Target Tracking:**
```typescript
// Added alongside existing 'hovered' variable
let targeted: HoveredTile = null;
```

**Added Target Functions:**
```typescript
function set_target(entity: HoveredTile): void
function clear_target(): void  
function get_target(): HoveredTile | null
```

**Updated OnClick Handler:**
- Left-click on entity now calls `set_target()`
- Also calls `config.on_select_target(ref)` if provided
- Logs target selection for debugging

**Updated Draw Function:**
```typescript
// Draw target highlight FIRST (persistent)
if (targeted) {
  // Yellow pale_yellow highlight
  // Bold weight (stronger than hover)
}

// Draw hover highlight SECOND (only if different from target)
if (hovered && (!targeted || hovered.x !== targeted.x || hovered.y !== targeted.y)) {
  // Existing pale_orange hover highlight
}
```

**Updated Info Display:**
```typescript
// Show target info (if targeted)
if (targeted && targeted.entity) {
  // Draw "Talking to: grenda" at bottom
} else if (hovered && hovered.entity) {
  // Draw hover info (existing behavior)
}
```

### Simplified Architecture

**Before (Overcomplicated):**
```
Backend sends HIGHLIGHT command
    ↓
Outbox
    ↓
Frontend polls
    ↓
visual_feedback.ts spawns particles
    ↓
Particles rendered
```

**After (Simple):**
```
User clicks entity
    ↓
place_module.set_target()
    ↓
Internal state updated
    ↓
Draw() shows yellow highlight
Draw() shows "Talking to: X"
```

### Visual Differences

| State | Visual | Color | Weight |
|-------|--------|-------|--------|
| **Targeted** | Persistent highlight | pale_yellow | Bold (7) |
| **Hovered** | Temporary highlight | pale_orange | Normal (6) |
| **Info** | Bottom-left text | pale_yellow | - |

### Files Modified

- `src/mono_ui/modules/place_module.ts`
  - Added `targeted` variable
  - Added `set_target()`, `clear_target()`, `get_target()` functions
  - Modified `OnClick()` to set target on entity click
  - Modified `Draw()` to show target highlight
  - Modified info display to show "Talking to: X"

### Files Removed

- ~~`src/mono_ui/visual_feedback.ts`~~ (unnecessary duplicate system)

### Files Updated

- `src/mono_ui/modules/movement_command_handler.ts`
  - Simplified `execute_ui_highlight_command()` to just log
  - Simplified `execute_ui_target_command()` to just log
  - Comments explain that visual feedback is handled by place_module.ts

---

## 🎯 Result

**Visual Feedback Working:**
- ✅ Left-click entity → Yellow highlight appears
- ✅ Left-click entity → "Talking to: grenda" displayed
- ✅ Hover different entity → Orange hover highlight
- ✅ No particles needed (uses existing canvas rendering)
- ✅ No command system needed for UI feedback

**Code Quality:**
- ✅ Reused existing hover infrastructure
- ✅ No duplicate systems
- ✅ Simpler architecture
- ✅ Less code to maintain

---

## 📝 Technical Decisions

**Why Not Use Particles?**
- Existing hover system already works
- Particles would be overkill for static highlighting
- Canvas-based rendering is more efficient

**Why Not Use Commands?**
- User click is immediate feedback
- No latency needed (unlike backend->frontend commands)
- Simpler to handle entirely in frontend

**Target vs Hover:**
- **Target:** Persistent, yellow, shows "Talking to:"
- **Hover:** Temporary, orange, shows `[ref] status`
- Both can coexist (target one, hover another)

---

## 📊 Progress Update

**Week 1:**
- ✅ Day 1-2: Archive old systems
- ✅ Day 3: Click-to-target + visual feedback (simplified)

**Overall:** ~70% complete (simpler than expected!)

**Next:** Integration testing
