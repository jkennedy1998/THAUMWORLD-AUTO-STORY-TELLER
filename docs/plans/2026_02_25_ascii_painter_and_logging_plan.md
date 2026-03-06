# ASCII Painter + Shared Renderer Plan (2026-02-25)

**Status:** Planning Phase  
**Priority:** High  
**Related Work:** Independent of item system development (no conflicts)

## Executive Summary

This plan creates a standalone ASCII Painter development mode using the existing render system, while fixing critical log discovery issues that affect model/tooling reliability. The goal is one renderer kernel (`src/mono_ui/`) used by both game mode and painter mode, with isolated logging namespaces.

**Core Principle:** Renderer changes must automatically propagate to both runs. No renderer branching by mode.

---

## Phase Overview

| Phase | Focus | Est. Duration | Testable Deliverables |
|-------|-------|---------------|----------------------|
| 1 | Logging Foundation & Reliability | 1-2 days | All log discovery issues resolved, shared logging utilities extracted |
| 2 | Painter Launch Mode | 1 day | `npm run dev:ascii` works, logs isolated |
| 3 | Typography & Font Fixes | 1-2 days | Legibility improved, fallback fonts work |
| 4 | ASCII Painter Core Module | 2-3 days | Grid model, tools, undo/redo functional |
| 5 | PNG Clipboard Import | 2-3 days | Image → ASCII conversion pipeline works |
| 6 | Painter App Shell | 2-3 days | Standalone painter UI complete |

---

## Current State Assessment

### Logging Infrastructure Issues (Critical for Model Reliability)

**Problem 1: Session Naming Inconsistency**
- `scripts/dev_with_logs.js`: `session_${timestamp}_${randomSuffix}.log` (9-char alphanumeric suffix)
- `src/launcher/log_capture.ts`: `session_${timestamp}_${random}_${HHMMSS}.log` (6-char suffix + time)
- `scripts/view_logs.js:233`: Filters with `/session_\d+_\d+\.log$/` — misses alphanumeric suffixes

**Problem 2: Date Directory Mismatch**
- Uses UTC date: `new Date().toISOString().split("T")[0]`
- Logs appear in "tomorrow's" folder around local midnight
- Tools expecting local date miss recent logs

**Problem 3: No Stale Reference Recovery**
- `latest.log` points to deleted files after crashes
- No automatic fallback to most recent valid session
- Manual intervention required to fix

**Problem 4: Scattered Log Locations**
- Root-level temp files may exist: `tmp_dev_logs_out.log`, `vite_run.log`
- No unified location policy

### Renderer State

**Typography Issues:**
- `src/canvas_app/app_state.ts:38`: `base_letter_spacing_mult: -0.18` (too tight)
- `src/mono_ui/runtime/canvas_runtime.ts:282,389`: Font-family quoted as single string (blocks fallback stack)

**Layer System:**
- `render_index` exists in cell types (`src/mono_ui/types.ts:30`)
- Composition is last-write-wins by module order (`src/mono_ui/compose.ts`)
- True layer compositing is future work, not required for painter v1

---

## Phase 1: Logging Foundation & Reliability

**Goal:** Fix all log discovery issues so models/tools find logs reliably every time. Extract shared utilities for game and painter launchers.

### 1.1 Audit Current Log Locations

**Files to inspect:**
- Project root for temp logs
- `local_data/data_slot_*/` structure
- Any hardcoded log paths in scripts

**Tasks:**
- [x] List all locations where logs are currently written
- [x] Identify any log files/directories outside `local_data/data_slot_*/logs/`
- [x] Document existing log file patterns
- [x] **Test:** Run `find . -name "*.log" -mtime -1` to find recent logs

**Success Criteria:**
- Complete inventory of all log locations
- No stray log files outside designated paths
- Documented pattern variations between launchers

### 1.2 Create Shared Logging Utilities

**New file:** `src/launcher/log_utils.ts`

**Exports needed:**
```typescript
export function generateSessionId(): string;
export function getLogDir(dataSlot: number, mode: 'game' | 'painter', date?: Date): string;
export function formatDateLocal(date: Date): string; // YYYY-MM-DD local time
export function getLatestLogPath(dataSlot: number, mode: 'game' | 'painter'): string | null;
export function updateLatestPointer(logDir: string, targetLog: string): void;
export function findMostRecentSession(logDir: string): string | null;
export function parseLatestLog(latestPath: string): { currentLog: string; sessionId: string; createdAt: Date } | null;
```

**Tasks:**
- [ ] Extract common logic from `dev_with_logs.js`, `launch_with_logs.js`, `log_capture.ts`
- [ ] Standardize session ID format: `session_${timestamp}_${random(8)}` (8-char alphanumeric, no time suffix)
- [ ] Implement local date formatting (not UTC)
- [ ] Implement robust latest.log parsing with fallback

**Test Plan:**
```typescript
// Unit tests for log_utils.ts
- generateSessionId() returns valid format
- getLogDir() returns correct path for game/painter modes
- formatDateLocal() uses local timezone
- findMostRecentSession() finds newest file by mtime
- parseLatestLog() handles valid reference file
- parseLatestLog() returns null for stale reference
- updateLatestPointer() creates valid reference file
```

**Success Criteria:**
- All log-related functions in one module
- No code duplication between launchers
- Comprehensive unit test coverage

### 1.3 Fix Date Directory Handling

**Files to modify:**
- `src/launcher/log_capture.ts:34-36`: Change from UTC to local date
- `scripts/dev_with_logs.js:45`: Change from UTC to local date
- `scripts/view_logs.js:29`: Ensure viewer uses same date logic

**Implementation:**
```typescript
// Use local date, not UTC
function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

**Tasks:**
- [x] Update all date formatting to use local time
- [ ] Add timezone offset to log header for debugging
- [ ] Update `scripts/view_logs.js` to handle both UTC and local date folders during transition

**Test Plan:**
- [ ] Run launcher at 23:30 local time, verify logs go in today's folder
- [ ] Run launcher at 00:30 local time, verify logs go in correct folder
- [ ] Verify `npm run logs:view` finds logs correctly around midnight

**Success Criteria:**
- Logs always appear in correct local date folder
- No "missing log" issues around midnight
- Backward compatibility for existing UTC folders

### 1.4 Fix Session Filename Patterns

**Current inconsistencies:**
- `dev_with_logs.js`: `${sessionId}.log` (no time suffix)
- `log_capture.ts`: `${session_id}_${format_time(now)}.log` (adds HHMMSS)

**Standard:** All sessions use `${sessionId}.log` only, no time suffix

**Files to modify:**
- `src/launcher/log_capture.ts:66`: Remove time suffix from filename
- `src/launcher/log_capture.ts:164-166`: Remove time suffix from process logs

**Tasks:**
- [x] Standardize on `${sessionId}.log` format everywhere
- [x] Update process log naming: `${sessionId}_${processName}.log`
- [x] Remove HHMMSS suffix generation entirely

**Test Plan:**
- [ ] Run `npm run dev:logs`, verify filename format
- [ ] Run `npm run launch`, verify filename format matches
- [ ] Verify both create files matching pattern: `session_${timestamp}_${8chars}.log`

**Success Criteria:**
- All session files follow identical naming convention
- No time suffixes in any log filenames
- Regex `/session_\d+_[a-z0-9]+\.log$/` matches all files

### 1.5 Fix Viewer Script Regex

**File:** `scripts/view_logs.js:233`

**Current:**
```javascript
const sessions = day.files.filter(f => f.name.match(/session_\d+_\d+\.log$/));
```

**Fixed:**
```javascript
const sessions = day.files.filter(f => f.name.match(/session_\d+_[a-z0-9]+\.log$/));
```

**Tasks:**
- [x] Update regex to accept alphanumeric suffixes
- [x] Ensure regex matches standardized format from 1.4
- [ ] Add test cases for filename matching

**Test Plan:**
- [ ] Create mock log files with various names
- [ ] Verify viewer lists all valid session files
- [ ] Verify viewer ignores non-session .log files

**Success Criteria:**
- `npm run logs:view` shows all session files
- No valid sessions missed due to naming variations

### 1.6 Implement Stale Reference Recovery

**New functionality:** Automatic fallback when `latest.log` points to deleted file

**Algorithm:**
1. Parse `latest.log` reference
2. Check if target file exists
3. If not, find most recent session file by mtime
4. Update `latest.log` to point to valid file
5. Log the recovery action

**Files to modify:**
- `src/launcher/log_utils.ts` (new): Add `validateAndRepairLatest()`
- `scripts/view_logs.js`: Add fallback lookup
- `scripts/validate_logs.js`: Already has logic, ensure it uses shared utils

**Tasks:**
- [x] Implement `validateAndRepairLatest()` function
- [x] Add option to auto-repair or just report
- [x] Update all log consumers to use fallback

**Test Plan:**
- [ ] Delete file referenced by `latest.log`
- [ ] Run viewer, verify it finds and reports stale reference
- [ ] Run with --fix flag, verify pointer updates
- [ ] Verify subsequent reads use repaired pointer

**Success Criteria:**
- Stale references automatically detected
- Recovery works without manual intervention
- User notified when recovery occurs

### 1.7 Consolidate Log Directory Structure

**Current structure:**
```
local_data/data_slot_1/logs/YYYY-MM-DD/
  ├── latest.log (reference file)
  ├── session_xxx.log (main log)
  ├── session_xxx_process.log (process logs)
  └── ...
```

**Clean up tasks:**
- [x] Move any root-level temp logs to appropriate slot
- [x] Document the complete directory structure
- [x] Ensure no logs written outside `local_data/`
- [x] Add .gitignore entries if needed

**Files to check:**
- `tmp_dev_logs_out.log` (if exists at root)
- `vite_run.log` (if exists at root)
- Any other `*.log` at project root

**Test Plan:**
- [ ] Run full test suite, check for new log files at root
- [ ] Verify all log writes go to `local_data/`

**Success Criteria:**
- All logs consolidated under `local_data/data_slot_*/logs/`
- No stray log files at project root
- Clear directory structure documented

### 1.8 Update All Launchers to Use Shared Utils

**Files to refactor:**
- `scripts/dev_with_logs.js`: Replace inline log logic with shared utils
- `scripts/launch_with_logs.js`: Replace inline log logic with shared utils
- `src/launcher/log_capture.ts`: Use shared session ID and date functions

**Tasks:**
- [ ] Import functions from `log_utils.ts`
- [ ] Remove duplicated code
- [ ] Ensure all launchers produce identical log formats

**Test Plan:**
- [ ] Run each launcher type, verify output format
- [ ] Compare session file structures
- [ ] Verify all create valid `latest.log` references

**Success Criteria:**
- No code duplication between launchers
- All use shared utilities
- Identical behavior across launch modes

### Phase 1 Success Criteria

- [ ] All log discovery issues from assessment resolved
- [ ] Shared `log_utils.ts` module created and tested
- [x] Session naming standardized across all launch paths
- [x] Date handling uses local time consistently
- [ ] Viewer scripts find all log files reliably
- [x] Stale reference recovery implemented
- [x] All logs consolidated to proper directory structure
- [ ] Comprehensive test coverage for logging utilities

**Definition of Done:**
- Models can always find current logs via `latest.log`
- No missed logs due to naming/date issues
- Logging infrastructure is maintainable and tested

---

## Phase 2: Painter Launch Mode

**Goal:** Create isolated painter development mode with its own log namespace.

### 2.1 Create Painter Log Directory Structure

**New structure:**
```
local_data/data_slot_1/logs_ascii_painter/YYYY-MM-DD/
  ├── latest.log
  ├── session_xxx.log
  └── session_xxx_process.log
```

**Tasks:**
- [x] Update `getLogDir()` to support `mode: 'painter'`
- [x] Ensure painter logs never write to game log directory
- [x] Create directory structure on first painter launch

### 2.2 Create Painter Launcher Script

**New file:** `scripts/dev_ascii.js`

**Features:**
- Spawns only `vite` and `electron`
- Uses shared logging utilities
- Writes to painter log namespace
- Sets `THAUM_APP_MODE=ascii_painter` environment variable

**Tasks:**
- [x] Create launcher script
- [x] Add to package.json scripts: `"dev:ascii": "node scripts/dev_ascii.js"`
- [x] Ensure clean shutdown and log finalization

### 2.3 Update Viewer for Multi-Mode Support

**File:** `scripts/view_logs.js`

**New features:**
- `--mode=game` (default)
- `--mode=painter`
- `--list-all` shows both modes

**Tasks:**
- [ ] Add mode parameter support
- [ ] Update path resolution for painter logs
- [ ] Add painter log viewing commands

### Phase 2 Success Criteria

- [x] `npm run dev:ascii` launches painter mode
- [x] Painter logs isolated from game logs
- [ ] Viewer can access both log namespaces
- [x] Clean shutdown writes proper log footers

---

## Phase 3: Typography & Font Fixes

**Goal:** Improve legibility and enable proper font fallback for extended ASCII characters.

### 3.1 Fix Font Stack Handling

**Issue:** Runtime quotes full font-family string, preventing fallback

**Files:**
- `src/mono_ui/runtime/canvas_runtime.ts:282,389`

**Fix:**
```typescript
// Instead of: `"${config.font_family}"`
// Use: config.font_family (pass stack directly)
```

### 3.2 Update Font Configuration

**File:** `src/canvas_app/app_state.ts:31`

**Change:**
```typescript
font_family: '"Martian Mono", "Noto Sans Mono", monospace',
```

### 3.3 Tune Letter Spacing

**File:** `src/canvas_app/app_state.ts:38`

**Test values:**
- Original: `-0.18`
- Selected: `-0.10`

**Status:** ✅ COMPLETE - Both game and painter modes set to `-0.10`

**Additional status:** ✅ Viewport/mask alignment stabilized across pan/zoom in painter mode.

### 3.4 Add Glyph Coverage Test Panel

**New:** Built into painter mode for verification

**Features:**
- Display all box-drawing characters
- Display block shades
- Display extended ASCII range
- Visual verification of fallback rendering

### Phase 3 Success Criteria

- [ ] Font fallback stack works for extended characters
- [x] Letter spacing improved for readability
- [ ] Glyph coverage panel verifies fallback fonts
- [x] Changes apply to both game and painter modes

---

## Phase 4: ASCII Painter Core Module

**Goal:** Create reusable, engine-agnostic painting utilities.

### 4.1 Create Module Structure

**New directory:** `src/ascii_painter/`

**Files:**
- `types.ts` - Grid cell model
- `grid.ts` - Grid operations
- `history.ts` - Undo/redo
- `tools.ts` - Drawing tools
- `export.ts` - Import/export

### 4.2 Define Grid Cell Model

```typescript
interface GridCell {
  char: string;
  rgb: { r: number; g: number; b: number };
  weight_index: number; // 0-7
  render_index?: number; // optional layer
}

interface Grid {
  width: number;
  height: number;
  cells: GridCell[][];
}
```

### 4.3 Implement Tools

- [x] Pencil (single cell)
- [x] Eraser (clear cell)
- [x] Line (Bresenham)
- [x] Rectangle (stroke/fill)
- [x] Bucket fill (flood fill)
- [x] Eyedropper (sample cell)

### 4.4 Implement History

- [x] Undo stack (max 50)
- [x] Redo stack
- [x] Snapshots on tool completion

### Phase 4 Success Criteria

- [x] All tools functional
- [x] Undo/redo works
- [x] Grid import/export works
- [ ] Module is engine-agnostic

---

## Phase 5: PNG Clipboard Import

**Goal:** Convert clipboard images to ASCII grids.

### 5.1 Add Electron IPC Channel

**File:** `electron/main.js`

**Add handler:**
```javascript
ipcMain.handle('get-clipboard-image', async () => {
  // Return image data from clipboard
});
```

**File:** `electron/preload.js`

**Expose:**
```javascript
getClipboardImage: () => ipcRenderer.invoke('get-clipboard-image'),
```

### 5.2 Implement Conversion Pipeline

**File:** `src/ascii_painter/image_import.ts`

**Steps:**
1. Decode image to canvas
2. Convert to grayscale
3. Resize to target grid dimensions
4. Map luminance to character ramp
5. Optional: edge detection for detail preservation
6. Output GridCell[][]

**Character ramps:**
- Simple: `' .:-=+*#%@'`
- Detailed: extended with Unicode blocks

### Phase 5 Success Criteria

- [x] Paste image from clipboard works
- [x] Reasonable ASCII representation
- [x] Configurable target dimensions
- [ ] Optional color preservation

---

## Phase 6: Painter App Shell

**Goal:** Standalone painter UI using shared renderer.

### 6.1 Create Painter App State

**New file:** `src/ascii_painter_app/app_state.ts`

**Features:**
- Use `CanvasRuntime` from `mono_ui/`
- Compose painter-specific modules
- No game API dependencies
- Tool palette module
- Canvas viewport module
- Import/export UI

### 6.2 Create Painter Entry Point

**New file:** `src/ascii_painter_app/main.ts`

**Structure similar to:** `src/canvas_app/main.ts`

**Differences:**
- Uses `ascii_painter_app_state` instead of `canvas_app/app_state`
- Minimal module set (no place, no NPC, no containers)
- Tool-focused modules

### 6.3 Create Painter HTML

**New file:** `src/ascii_painter_app/index.html`

**Base on:** `src/canvas_app/index.html`

**Add:**
- Font preload for local fonts
- Same CSS structure

### 6.4 Create Modules

- [x] Tool palette (brush selector, char picker)
- [x] Color picker
- [x] Weight selector
- [x] Canvas viewport (grid display)
- [x] Import/export panel
- [ ] Glyph coverage tester

### Phase 6 Success Criteria

- [x] Painter launches independently
- [x] All tools accessible via UI
- [x] Mouse painting works
- [x] Import/export works
- [x] Renders using shared renderer

**Additional status:**
- ✅ Layer palette stays in sync when layers are added/removed/reordered
- ✅ Pen input supported via Pointer Events (driver-dependent; Windows Ink off recommended for Huion)

---

## Implementation Order

### Dependencies

```
Phase 1 (Logging)
    ↓
Phase 2 (Painter Launch) - depends on logging utils
    ↓
Phase 3 (Typography) - can parallel with 4
    ↓
Phase 4 (Painter Core) - independent
    ↓
Phase 5 (PNG Import) - depends on 4
    ↓
Phase 6 (App Shell) - depends on 2, 3, 4
```

### Recommended Sequence

1. **Week 1:** Phase 1 (Logging foundation) - critical for model tooling
2. **Week 1:** Phase 2 (Painter launch) - quick win, enables testing
3. **Week 2:** Phase 3 + 4 in parallel (typography + core module)
4. **Week 3:** Phase 5 (PNG import)
5. **Week 3:** Phase 6 (App shell)

---

## Testing Strategy

### Unit Tests
- All `log_utils.ts` functions
- Grid operations
- Tool algorithms
- History management

### Integration Tests
- Full launcher lifecycle
- Log discovery scenarios
- Font rendering
- Clipboard pipeline

### Manual Testing
- Visual legibility at different scales
- Mouse painting responsiveness
- PNG conversion quality

---

## Definition of Done

### System-Level
- [ ] One renderer core powers both game and painter
- [ ] Renderer edits automatically apply to both
- [ ] Painter logs isolated and discoverable
- [ ] Game log discovery reliable for models
- [ ] Extended glyphs render with fallback

### Painter Features
- [ ] PNG import produces editable ASCII
- [ ] Mouse painting with all tools
- [ ] Undo/redo functional
- [ ] Export to reusable format

### Quality
- [ ] All phases have test coverage
- [ ] Documentation updated
- [ ] No console errors
- [ ] Clean shutdown in all modes

---

## Appendix

### File Inventory

**To be created:**
- `src/launcher/log_utils.ts`
- `src/launcher/log_utils.test.ts`
- `scripts/dev_ascii.js`
- `src/ascii_painter/types.ts`
- `src/ascii_painter/grid.ts`
- `src/ascii_painter/history.ts`
- `src/ascii_painter/tools.ts`
- `src/ascii_painter/export.ts`
- `src/ascii_painter/image_import.ts`
- `src/ascii_painter_app/main.ts`
- `src/ascii_painter_app/app_state.ts`
- `src/ascii_painter_app/index.html`

**To be modified:**
- `scripts/dev_with_logs.js`
- `scripts/launch_with_logs.js`
- `scripts/view_logs.js`
- `scripts/validate_logs.js`
- `src/launcher/log_capture.ts`
- `src/launcher/main.ts`
- `src/mono_ui/runtime/canvas_runtime.ts`
- `src/canvas_app/app_state.ts`
- `electron/main.js`
- `electron/preload.js`
- `package.json`

### Session Naming Standard

**Format:** `session_${timestamp}_${suffix}.log`

- `timestamp`: Unix epoch milliseconds (13 digits)
- `suffix`: 8-character alphanumeric lowercase
- No time suffix (HHMMSS)
- No process name in main log

**Process logs:** `session_${timestamp}_${suffix}_${processName}.log`

**Examples:**
```
session_1708987654321_a1b2c3d4.log
session_1708987654321_a1b2c3d4_vite.log
session_1708987654321_a1b2c3d4_electron.log
```

### Log Directory Structure

```
local_data/
└── data_slot_1/
    ├── logs/                           # Game logs
    │   └── 2026-02-27/
    │       ├── latest.log              # Reference file
    │       ├── session_xxx.log         # Main session
    │       └── session_xxx_process.log # Process logs
    ├── logs_ascii_painter/             # Painter logs
    │   └── 2026-02-27/
    │       ├── latest.log
    │       └── session_xxx.log
    └── ...
```

**No logs outside these directories.**
