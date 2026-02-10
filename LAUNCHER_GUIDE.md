# THAUMWORLD Launch & Log System

## Quick Start

### Launch Game with Log Capture

```bash
# Start game with automatic logging
npm run launch

# Or with specific data slot
npm run launch:slot1
```

### View Logs

```bash
# List all logs
npm run logs:view

# Open latest log file
npm run logs:view -- --latest

# Clean old logs (keeps last 30 days)
npm run logs:clean
```

### Build Executable

```bash
# Build standalone executable
npm run build:exe

# Executable will be in dist_exe/
```

---

## Log System

### Log Location

Logs are stored in:
```
local_data/data_slot_1/logs/YYYY-MM-DD/
```

### Log Format

Each log entry includes:
- **Timestamp** - ISO 8601 format
- **Process Name** - Which service generated the log
- **Level** - INFO, ERROR, EXIT
- **Message** - The actual log content

Example:
```
[2026-02-08T18:55:12.833Z] [npc_ai] [INFO] NPC_AI Tick started
[2026-02-08T18:55:12.833Z] [interface] [INFO] HTTP input received
[2026-02-08T18:55:12.833Z] [npc_ai] [ERROR] Failed to connect
```

### Files Generated

Each session creates:
- **Main log** - `session_TIMESTAMP_HHMMSS.log` - All processes combined
- **Process logs** - `session_TIMESTAMP_PROCESS.log` - Individual process logs
- **Latest pointer** - `latest.log` - Points to most recent main log

---

## For AI Agents

### Reading Logs Programmatically

```javascript
const { get_latest_log_path, list_logs } = require('./dist/launcher/log_capture.js');

// Get path to latest log
const latest = get_latest_log_path(1);
console.log(latest); // e.g., local_data/data_slot_1/logs/2026-02-08/session_xxx_185612.log

// List all logs
const logs = list_logs(1);
console.log(logs);
// [
//   { date: '2026-02-08', files: ['session_xxx.log', ...] },
//   { date: '2026-02-07', files: [...] }
// ]
```

### Log Parsing

Each line follows this format:
```regex
\[([^\]]+)\] \[([^\]]+)\] \[([^\]]+)\] (.+)
```

Groups:
1. Timestamp (ISO 8601)
2. Process name (e.g., npc_ai, interface, renderer)
3. Level (INFO, ERROR, EXIT)
4. Message content

---

## Troubleshooting

### "Failed to load log_capture module"

Run `npm run build` first to compile TypeScript.

### "Ollama not detected"

Download and install Ollama from https://ollama.ai, then start it before running the game.

### Logs not appearing

Check that the log directory exists:
```bash
ls local_data/data_slot_1/logs/
```

### Executable won't run

Make sure you have the required runtime. The executable includes Node.js but still requires:
- Windows: Visual C++ Redistributable
- macOS: No additional requirements
- Linux: Standard glibc

---

## Prerequisites

1. **Node.js 18+** - Required for building
2. **Ollama** - Required for AI features
3. **npm packages** - Run `npm install`

---

## Development Commands

```bash
# Run individual services
npm run npc_ai_dev
npm run interface_dev
npm run interpreter_dev
# ... etc

# Format code
npm run format

# Clean build
npm run build
```
