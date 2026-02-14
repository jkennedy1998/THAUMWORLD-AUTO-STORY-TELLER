# Troubleshooting Guide

## Common Issues and Solutions

## Table of Contents

1. [Installation Issues](#installation-issues)
2. [Service Startup Issues](#service-startup-issues)
3. [AI Service Issues](#ai-service-issues)
4. [Message Pipeline Issues](#message-pipeline-issues)
5. [NPC Response Issues](#npc-response-issues)
6. [Turn Manager Issues](#turn-manager-issues)
7. [Memory/Performance Issues](#memoryperformance-issues)
8. [Data Corruption Issues](#data-corruption-issues)

---

## Installation Issues

### Issue: npm install fails

**Symptoms:**
```
npm ERR! code ENOENT
npm ERR! syscall open
npm ERR! path /package.json
```

**Solutions:**
1. Ensure you're in the project directory:
   ```bash
   cd THAUMWORLD-AUTO-STORY-TELLER
   npm install
   ```

2. Clear npm cache:
   ```bash
   npm cache clean --force
   npm install
   ```

3. Use yarn as alternative:
   ```bash
   yarn install
   ```

### Issue: TypeScript compilation errors

**Symptoms:**
```
error TS2307: Cannot find module
```

**Solutions:**
1. Install TypeScript globally:
   ```bash
   npm install -g typescript
   ```

2. Check tsconfig.json exists

3. Run type check:
   ```bash
   npx tsc --noEmit
   ```

### Issue: Missing Ollama

**Symptoms:**
```
Error: Cannot connect to Ollama at http://localhost:11434
```

**Solutions:**
1. Install Ollama:
   ```bash
   # macOS/Linux
   curl -fsSL https://ollama.com/install.sh | sh
   
   # Windows
   # Download from https://ollama.com/download
   ```

2. Start Ollama service:
   ```bash
   ollama serve
   ```

3. Pull required models:
   ```bash
   ollama pull llama3.2:latest
   ```

4. Verify connection:
   ```bash
   curl http://localhost:11434/api/tags
   ```

---

## Service Startup Issues

### Issue: Service won't start

**Symptoms:**
```
Error: Cannot find module '../engine/paths.js'
```

**Solutions:**
1. Check file structure is intact

2. Rebuild TypeScript:
   ```bash
   npm run build
   ```

3. Check for syntax errors:
   ```bash
   npx tsc --noEmit
   ```

4. Verify imports use `.js` extension:
   ```typescript
   // Correct
   import { something } from "./file.js";
   
   // Incorrect
   import { something } from "./file";
   ```

### Issue: Port already in use

**Symptoms:**
```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solutions:**
1. Find and kill process:
   ```bash
   # macOS/Linux
   lsof -i :3000
   kill -9 <PID>
   
   # Windows
   netstat -ano | findstr :3000
   taskkill /PID <PID> /F
   ```

2. Change port in configuration

### Issue: Permission denied

**Symptoms:**
```
Error: EACCES: permission denied, mkdir 'local_data'
```

**Solutions:**
1. Fix permissions:
   ```bash
   # macOS/Linux
   sudo chown -R $(whoami) .
   
   # Or change data directory
   export DATA_DIR=/path/with/permissions
   ```

2. Run as administrator (Windows)

---

## AI Service Issues

### Issue: AI responses are slow

**Symptoms:**
- Responses take > 10 seconds
- Timeout errors

**Solutions:**
1. Check Ollama performance:
   ```bash
   ollama ps  # Check if model is loaded
   ```

2. Use smaller model:
   ```bash
   ollama pull llama3.2:1b  # Smaller, faster
   ```

3. Adjust timeout:
   ```bash
   export NPC_AI_TIMEOUT_MS=300000  # 5 minutes
   ```

4. Enable GPU acceleration:
   ```bash
   # Check Ollama GPU support
   ollama serve --gpu
   ```

### Issue: AI generates invalid format

**Symptoms:**
```
Error: Cannot parse machine text
```

**Solutions:**
1. Current build: `interpreter_ai` is archived. Check ActionPipeline + witness logs in `interface_program` instead.

2. Add more explicit format instructions

3. Lower temperature for more consistent output:
   ```bash
   export NPC_AI_TEMPERATURE=0.3
   ```

4. Add validation and retry logic

### Issue: AI hallucinates entities

**Symptoms:**
- NPCs mention non-existent characters
- Invented locations or items

**Solutions:**
1. Strengthen constraints in prompts:
   ```
   CONSTRAINTS:
   - Only use entities from the provided list
   - Never invent new names
   ```

2. Use working memory to limit context

3. Add validation layer

### Issue: AI service crashes

**Symptoms:**
```
Error: Connection reset by peer
```

**Solutions:**
1. Restart Ollama:
   ```bash
   ollama stop
   ollama serve
   ```

2. Check system resources:
   ```bash
   # macOS/Linux
   top
   free -h
   
   # Windows
   taskmgr
   ```

3. Reduce concurrent AI calls

4. Enable auto-retry in service config

---

## Message Pipeline Issues

### Issue: Messages not flowing

**Symptoms:**
- Player input not processed
- No response from NPCs
- Stuck at certain stage

**Solutions:**
1. Check inbox/outbox:
   ```bash
   cat local_data/data_slot_1/inbox.jsonc
   cat local_data/data_slot_1/outbox.jsonc
   ```

2. Check service logs:
   ```bash
   tail -f local_data/data_slot_1/log.jsonc
   ```

3. Verify services are running:
   ```bash
   ps aux | grep -E "interpreter|npc_ai|turn_manager"
   ```

4. Clear stuck messages:
   ```bash
   # Backup first
   cp local_data/data_slot_1/outbox.jsonc outbox_backup.jsonc
   
   # Clear outbox
   echo '{"messages": []}' > local_data/data_slot_1/outbox.jsonc
   ```

### Issue: Duplicate messages

**Symptoms:**
- Same message processed multiple times
- NPCs respond multiple times

**Solutions:**
1. Check message IDs are unique

2. Verify `processedMessages` tracking in services

3. Check for multiple service instances:
   ```bash
   ps aux | grep npc_ai
   # Kill duplicates
   ```

### Issue: Message routing wrong

**Symptoms:**
- Messages go to wrong service
- Stage not advancing

**Solutions:**
1. Check stage field in messages

2. Verify service routing logic:
   ```typescript
   // Should check stage
   if (msg.stage === "my_stage") {
       // Process
   }
   ```

3. Check Breath() routing in interface_program

---

## NPC Response Issues

### Issue: NPCs not responding

**Symptoms:**
- Player talks to NPC, no response
- NPCs ignore communication

**Solutions:**
1. Check NPC awareness tags:
   ```bash
   cat local_data/data_slot_1/npcs/grenda.jsonc | grep -A 5 "tags"
   ```

2. Verify NPC is in same region:
   ```bash
   # Check actor location
   cat local_data/data_slot_1/actors/henry_actor.jsonc | grep -A 10 "location"
   
   # Check NPC location
   cat local_data/data_slot_1/npcs/grenda.jsonc | grep -A 10 "location"
   ```

3. Check NPC AI service is running:
   ```bash
   ps aux | grep npc_ai
   ```

4. Check working memory exists:
   ```bash
   cat local_data/data_slot_1/working_memory.jsonc
   ```

### Issue: NPC responses out of character

**Symptoms:**
- NPC doesn't match personality
- Wrong tone or behavior

**Solutions:**
1. Check NPC personality definition:
   ```bash
   cat local_data/data_slot_1/npcs/grenda.jsonc | grep -A 20 "personality"
   ```

2. Verify working memory context is being passed

3. Check AI prompt includes personality

4. Adjust AI temperature:
   ```bash
   export NPC_AI_TEMPERATURE=0.7
   ```

### Issue: NPCs respond to wrong player

**Symptoms:**
- NPC responds to wrong actor
- Wrong conversation context

**Solutions:**
1. Check correlation_id in messages

2. Verify conversation_id is correct

3. Check working memory is event-specific

---

## Turn Manager Issues

### Issue: Turns not advancing

**Symptoms:**
- Stuck on same turn
- Initiative not progressing

**Solutions:**
1. Check turn state:
   ```bash
   grep "TurnManager" local_data/data_slot_1/log.jsonc
   ```

2. Verify timed event is active:
   ```bash
   cat local_data/data_slot_1/world/world.jsonc | grep -A 5 "timed_event"
   ```

3. Check turn manager service is running

4. Manually advance turn (debug only):
   ```typescript
   // In code
   transition_phase(turn_state, "TURN_END");
   ```

### Issue: Initiative order wrong

**Symptoms:**
- Wrong actor goes first
- Initiative not based on DEX

**Solutions:**
1. Check DEX scores:
   ```bash
   cat local_data/data_slot_1/actors/henry_actor.jsonc | grep "dex"
   ```

2. Verify initiative roll logic in turn_manager

3. Check for initiative bonuses/penalties

### Issue: Actions not validating

**Symptoms:**
- Invalid actions allowed
- Valid actions rejected

**Solutions:**
1. Check action validation rules:
   ```typescript
   // In validator.ts
   const result = validate_action(context);
   console.log(result); // Check validation result
   ```

2. Verify actor state is correct:
   - Health
   - Status effects
   - Equipment

3. Check range calculations

---

## Memory/Performance Issues

### Issue: High memory usage

**Symptoms:**
- System slows down
- Out of memory errors
- Services crash

**Solutions:**
1. Clear caches:
   ```typescript
   // In code
   clear_summary_cache();
   clear_memory_cache();
   ```

2. Prune old data:
   ```bash
   # Remove old conversations
   find local_data/data_slot_1/conversations -mtime +30 -delete
   ```

3. Reduce working memory TTL:
   ```typescript
   // In constants.ts
   TTL_SECONDS: 180  // 3 minutes instead of 5
   ```

4. Monitor memory:
   ```bash
   # macOS/Linux
   top -p $(pgrep -d',' node)
   ```

### Issue: Slow performance

**Symptoms:**
- Long delays between actions
- UI unresponsive

**Solutions:**
1. Check AI call frequency in metrics

2. Enable decision hierarchy (Phase 3):
   - Should reduce AI calls by 75%

3. Optimize working memory building:
   - Cache participant data
   - Lazy load information

4. Check disk I/O:
   ```bash
   # macOS/Linux
   iotop
   ```

### Issue: Disk space full

**Symptoms:**
```
Error: ENOSPC: no space left on device
```

**Solutions:**
1. Clean up logs:
   ```bash
   rm local_data/data_slot_1/log.jsonc
   ```

2. Archive old conversations:
   ```bash
   tar -czf old_conversations.tar.gz local_data/data_slot_1/conversations/
   rm -rf local_data/data_slot_1/conversations/
   ```

3. Set up log rotation

---

## Data Corruption Issues

### Issue: Corrupted JSON files

**Symptoms:**
```
Error: Unexpected token } in JSON
```

**Solutions:**
1. Validate JSON:
   ```bash
   # Check file
   cat local_data/data_slot_1/world/world.jsonc | python -m json.tool
   ```

2. Restore from backup:
   ```bash
   cp local_data/data_slot_1/world/world_backup.jsonc local_data/data_slot_1/world/world.jsonc
   ```

3. Use JSONC parser (allows comments):
   ```typescript
   import { parse } from "jsonc-parser";
   const data = parse(jsonc_text);
   ```

### Issue: Missing data files

**Symptoms:**
```
Error: ENOENT: no such file or directory
```

**Solutions:**
1. Check file exists:
   ```bash
   ls -la local_data/data_slot_1/actors/
   ```

2. Regenerate defaults:
   ```bash
   npm run setup  # If available
   ```

3. Copy from default:
   ```bash
   cp -r local_data/data_slot_default/actors local_data/data_slot_1/
   ```

### Issue: Working memory corrupted

**Symptoms:**
- Events not recorded
- Wrong context in AI prompts

**Solutions:**
1. Clear working memory:
   ```bash
   echo '{"memories": []}' > local_data/data_slot_1/working_memory.jsonc
   ```

2. Rebuild from event data

3. Check for concurrent access issues

---

## Debug Commands

### Check Service Status

```bash
# List all Node processes
ps aux | grep node

# Check specific service
ps aux | grep turn_manager

# Check port usage
lsof -i :3000
```

### Inspect Data

```bash
# View last 10 messages
tail -n 10 local_data/data_slot_1/inbox.jsonc

# Search for specific message
grep "message_id" local_data/data_slot_1/log.jsonc

# Check working memory
cat local_data/data_slot_1/working_memory.jsonc | python -m json.tool

# View NPC data
cat local_data/data_slot_1/npcs/grenda.jsonc | grep -A 5 "personality"
```

### Monitor Logs

```bash
# Real-time log monitoring
tail -f local_data/data_slot_1/log.jsonc

# Filter by service
tail -f local_data/data_slot_1/log.jsonc | grep "TurnManager"

# Filter by error
tail -f local_data/data_slot_1/log.jsonc | grep "ERROR"
```

### Test Components

```bash
# Test AI connection
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.2:latest",
  "prompt": "Say hello"
}'

# Type check
npx tsc --noEmit

# Run specific service
npm run npc_ai_dev
```

---

## Emergency Recovery

### Complete Reset

**⚠️ WARNING: This will delete all game data!**

```bash
# Backup first
cp -r local_data/data_slot_1 local_data/data_slot_1_backup_$(date +%Y%m%d)

# Reset to defaults
rm -rf local_data/data_slot_1/*
cp -r local_data/data_slot_default/* local_data/data_slot_1/

# Restart services
npm run dev
```

### Service Restart

```bash
# Kill all Node processes
killall node

# Or more specific
pkill -f "turn_manager"
pkill -f "npc_ai"
pkill -f "interpreter"

# Restart
npm run dev
```

### Clear All Messages

```bash
# Clear inbox/outbox
echo '{"messages": []}' > local_data/data_slot_1/inbox.jsonc
echo '{"messages": []}' > local_data/data_slot_1/outbox.jsonc

# Clear logs
echo '{"logs": []}' > local_data/data_slot_1/log.jsonc
```

---

## Getting Help

### Before Asking for Help

1. Check this troubleshooting guide
2. Review logs for error messages
3. Try the debug commands above
4. Check if issue is reproducible

### Information to Provide

When reporting issues:
- Error message (full text)
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, versions)
- Relevant log excerpts

### Resources

- [Architecture Overview](../design/ARCHITECTURE.md)
- [Developer Guide](./DEVELOPER_GUIDE.md)
- [AI Prompts](./AI_PROMPTS.md)
- GitHub Issues: Report bugs

---

## Quick Reference

| Issue | Quick Fix |
|-------|-----------|
| Service won't start | Check `npx tsc --noEmit` |
| AI not responding | Check `ollama serve` |
| Messages stuck | Clear outbox.jsonc |
| NPCs not responding | Check awareness tags |
| High memory | Clear caches |
| Slow performance | Check AI call frequency |
| Corrupted data | Restore from backup |

## Debug Levels

```bash
DEBUG_LEVEL=1  # Errors only
DEBUG_LEVEL=2  # Warnings + errors
DEBUG_LEVEL=3  # Service flow
DEBUG_LEVEL=4  # Full content
```

## Environment Variables

```bash
OLLAMA_HOST=http://localhost:11434
NPC_AI_MODEL=llama3.2:latest
NPC_AI_TIMEOUT_MS=120000
NPC_AI_TEMPERATURE=0.8
DATA_SLOT=1
DEBUG_LEVEL=3
```
