# THAUMWORLD Agent Documentation

## Log File System

### Overview
THAUMWORLD uses a structured logging system to capture output from all processes. Understanding this system is crucial for debugging.

### Log Locations

**Primary Location (ALWAYS check this first):**
```
local_data/data_slot_<N>/logs/YYYY-MM-DD/
```

**Key Files:**
- `latest.log` - Reference file pointing to the current active session
- `session_<timestamp>_<id>.log` - Main session log (combined output from all processes)
- `session_<timestamp>_<id>_<process>.log` - Individual process logs

### Finding the Current Log

**Method 1: Use latest.log (Recommended)**
```bash
# The latest.log file contains a reference to the current session
cat local_data/data_slot_1/logs/2026-02-19/latest.log
# Output: CURRENT_LOG=path/to/session_xxx.log
```

**Method 2: Find Most Recent Session**
```bash
# List all session files sorted by time (newest last)
ls -lt local_data/data_slot_1/logs/2026-02-19/session_*.log | tail -1
```

### When Logs Are Created

**`npm run dev:logs`** - Creates a new session on each run:
1. Generates unique session ID
2. Creates log directory if needed
3. Updates `latest.log` to point to new session
4. Captures all process output

**`npm run launch`** - Creates new session via launcher system:
1. Same process as dev:logs
2. Uses compiled code (dist/) instead of tsx

### Log Structure

**Session Log Format:**
```
================================================================================
THAUMWORLD Log Session
Session ID: session_1771525575505_aj4y2ub
Start Time: 2026-02-19T18:26:15.505Z
Log Directory: C:\...\local_data\data_slot_1\logs\2026-02-19
================================================================================

[2026-02-19T18:26:15.626Z] [event_bridge] [INFO] websocket_server_listening {"port":8789}
[2026-02-19T18:26:15.627Z] [event_bridge] [INFO] started {"httpPort":8788,"wsPort":8789}
...
```

**Log Entry Format:**
```
[timestamp] [process_name] [level] message
```

Processes include:
- `interface` - Main HTTP API server
- `electron` - Electron main process + renderer logs
- `renderer` - AI renderer service
- `npc_ai` - NPC AI controller
- `state_applier` - State change processor
- `data_broker` - Message broker
- `rules_lawyer` - Rule validation
- `roller` - Dice roller service
- `turn_manager` - Turn management
- `vite` - Development server

### Common Debugging Patterns

**Finding Errors:**
```bash
# Search for errors in latest session
grep "ERROR" local_data/data_slot_1/logs/2026-02-19/latest.log

# Search for specific error type
grep "actor_not_found" local_data/data_slot_1/logs/2026-02-19/session_*.log
```

**Following a Session:**
```bash
# Tail the latest log in real-time
tail -f $(cat local_data/data_slot_1/logs/2026-02-19/latest.log | grep CURRENT_LOG | cut -d= -f2)
```

**Checking Multiple Sessions:**
```bash
# List all sessions from today with sizes
ls -lh local_data/data_slot_1/logs/2026-02-19/session_*.log
```

### Important Notes

1. **latest.log is a reference file** (not a symlink on Windows)
   - Contains: `CURRENT_LOG=path` and `SESSION_ID=id`
   - Updated automatically when new session starts

2. **Each session is isolated**
   - New file created on every `npm run dev:logs`
   - Old sessions preserved for debugging
   - Use `npm run logs:clean` to remove old logs

3. **Dev vs Production**
   - Dev mode (`dev:logs`): Uses tsx (immediate code changes)
   - Production (`launch`): Uses compiled dist/ (requires rebuild)

4. **Renderer logs are special**
   - Electron renderer logs appear as `[electron] [INFO] [Renderer log] ...`
   - Main process logs appear as `[electron] [INFO] ...` (no "Renderer" tag)

### Troubleshooting Stale latest.log

If `latest.log` points to an old/crashed session:

**Quick Fix (Automatic):**
```bash
# Validate and repair latest.log
npm run logs:validate  # Check if it's stale
npm run logs:fix       # Fix it automatically
```

**Manual Check:**
1. Check if the referenced file exists:
   ```bash
   ls -la $(cat local_data/data_slot_1/logs/2026-02-19/latest.log | grep CURRENT_LOG | cut -d= -f2)
   ```

2. If not, find the most recent session manually:
   ```bash
   ls -lt local_data/data_slot_1/logs/2026-02-19/session_*.log | head -5
   ```

3. To prevent this, ensure clean shutdown with Ctrl+C (not force kill)

**How the System Prevents Stale Data:**
- Each new session creates a fresh `latest.log` reference
- The reference includes `CREATED_AT` timestamp for validation
- Log readers now validate that the referenced file exists before using it
- If stale, the system automatically falls back to the most recent session file
- Use `npm run logs:validate` to check and `npm run logs:fix` to repair

### Related Commands

- `npm run logs:view` - Interactive log viewer
- `npm run logs:clean` - Remove old log files
- `npm run launch` - Production mode with logs
- `npm run dev:logs` - Development mode with logs

## Development Guidelines

### When Investigating Issues

1. **Always check latest.log FIRST**
   - Most recent session has the current issue
   - Don't waste time on stale logs

2. **Look for patterns**
   - Search for `[ERROR]` entries
   - Check timestamps around when issue occurred
   - Correlate between different process logs

3. **Use grep for specific issues**
   - Actor problems: `grep "actor" session.log`
   - API errors: `grep "API.*error" session.log`
   - Button clicks: `grep "DEBUG BUTTON" session.log`

### File Locations Quick Reference

```
Project Root
├── local_data/
│   └── data_slot_1/
│       └── logs/
│           └── 2026-02-19/
│               ├── latest.log              ← START HERE
│               ├── session_xxx.log         ← Main combined log
│               ├── session_xxx_interface.log
│               ├── session_xxx_electron.log
│               └── ...
├── tmp_dev_logs_out.log                    ← Dev process output (usually stale)
└── vite_run.log                            ← Vite dev server logs
```

**Remember:** Always prioritize `local_data/data_slot_*/logs/` over root-level `.log` files!
