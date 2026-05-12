# Container Format Migration - Status & Next Steps

## 🎯 Current Situation

**What We Did:**
- ✅ Updated type definitions (`ContainerContentEntry` interface)
- ✅ Updated core storage functions to use wrapped format
- ✅ Recovered Henry's items (tunic on torso, pants on leg)
- ✅ Prepared sack with empty container_data for testing

**What Went Wrong:**
- ⚠️ Game boots to white screen
- ⚠️ Background services crashing with access violations (exit code 3221226505)
- ⚠️ Some code still expects old format, causing null pointer crashes

**Root Cause:**
The data format changed from raw `ItemInstance[]` to wrapped `{instance, definition}`, but 2 critical locations still use old format accessors, causing crashes when services try to load data.

---

## 📋 Implementation Status

### ✅ COMPLETED
1. **Type System Updates**
   - `ContainerContentEntry` interface added
   - `Container.contents` type updated
   - `ContainerData.contents` type updated

2. **Core Storage Functions**
   - `get_container_contents()` - returns wrapped format
   - `calculate_item_weight()` - handles wrapped entries
   - `add_item_to_container()` - accepts wrapped entries
   - `remove_item_from_container()` - finds by `entry.instance.id`
   - `transfer_item_between_containers()` - full rewrite for wrapped format
   - `find_item_in_entity_containers()` - returns wrapped entries
   - `find_item_and_parent_container()` - returns wrapped entries

3. **Item Recovery**
   - Tunic restored to torso container
   - Pants restored to leg_right container
   - Body slot references updated

### 🔴 CRITICAL BUGS (Blocking Testing)

**Bug 1: Pickup API Uses Old Format**
- **File:** `src/interface_program/main.ts:2121`
- **Issue:** `entry.item_instance_id` → should be `entry.instance.id`
- **Impact:** Services crash on startup

**Bug 2: Nested Container Access**
- **File:** `src/canvas_app/app_state.ts:2586`
- **Issue:** `item.def_id` → should be `entry.instance.def_id`
- **Impact:** Opening nested containers crashes

---

## 🚀 FIRST STEP: Fix Critical Bugs

**Immediate Action Required:**

### Step 1.1: Fix Pickup API
```typescript
// src/interface_program/main.ts, line 2121
// CHANGE FROM:
const has_item = container.contents.some(
    (entry: any) => entry.item_instance_id === item_instance_id
);

// CHANGE TO:
const has_item = container.contents.some(
    (entry: any) => entry.instance.id === item_instance_id
);
```

### Step 1.2: Fix Nested Container Access
```typescript
// src/canvas_app/app_state.ts, line 2586
// CHANGE FROM:
for (const item of found_item.instance.container_data.contents) {
    const def_res = await fetch(`.../api/item_def?id=${item.def_id}`);

// CHANGE TO:
for (const entry of found_item.instance.container_data.contents) {
    const def_res = await fetch(`.../api/item_def?id=${entry.instance.def_id}`);
```

**Why These First?**
These two bugs are causing the white screen. Services crash before the UI can load. Fix these, and the game should boot successfully.

---

## 📚 Related Documentation

**Primary Plan:**
- `docs/plans/container_format_standardization.md` - Complete implementation roadmap

**Cross-References:**
- `docs/plans/2026_02_19_inventory_movement_plan.md` - Inventory drag-and-drop (BLOCKED until format fixed)
- `docs/plans/2026_02_22_character_module_rework.md` - Character module updates
- `docs/plans/2026_02_14_item_system_unification.md` - Overall item system design

**Technical Details:**
- `docs/plans/container_format_implementation_summary.md` - Implementation summary

---

## ✅ Success Criteria

After completing the migration:

1. **Boot Success**
   - [ ] Game launches without white screen
   - [ ] No service crashes (exit code 3221226505)
   - [ ] All services start successfully

2. **Item Display**
   - [ ] Tunic visible in torso slot
   - [ ] Pants visible in leg_right slot
   - [ ] Sack container opens and shows contents

3. **Item Transfer**
   - [ ] Can drag tunic from torso to sack
   - [ ] Can drag pants from leg to sack
   - [ ] Items persist after closing/reopening sack
   - [ ] Items persist after game restart

4. **Ground Items**
   - [ ] Can drop items to ground
   - [ ] Can pick up items from ground
   - [ ] No "item not found" errors

5. **Nested Containers**
   - [ ] Can open sack (nested container)
   - [ ] Items inside sack display correctly
   - [ ] Can move items in/out of nested containers

---

## 🎮 Testing Ready?

**Before testing, verify:**
- [ ] Both critical bugs are fixed
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run build` completes successfully
- [ ] Henry's actor file has correct wrapped format

**Then test:**
```bash
npm run launch
```

**Monitor logs for:**
- No "Failed to load URL" errors
- No access violation errors
- Services boot successfully

---

## 💡 Key Insight

The container format change is **architecturally correct** - having one consistent format is essential for a tabletop RPG with complex inventory. The crashes are just from 2 missed spots that didn't get updated. Once those are fixed, the system should work correctly.

**The wrapped format is the right long-term solution.** We're just cleaning up the transition.

---

## 📊 Summary

| Item | Status |
|------|--------|
| Type definitions | ✅ Complete |
| Core storage functions | ✅ Complete |
| Data migration | ✅ Complete (Henry's items) |
| Critical bug 1 | 🔴 Not fixed (pickup API) |
| Critical bug 2 | 🔴 Not fixed (nested containers) |
| Testing | 🔴 Blocked by bugs |
| Documentation | ✅ Complete |

**Next Action:** Fix the 2 critical bugs (15 minutes of work), then test.
