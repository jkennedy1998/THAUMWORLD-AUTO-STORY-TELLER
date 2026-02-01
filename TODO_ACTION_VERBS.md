# TODO: Add remaining THAUMWORLD action verb narrative generators
# Current implementation covers: INSPECT, ATTACK, COMMUNICATE, MOVE, USE
# Remaining verbs to implement: HELP, DEFEND, GRAPPLE, DODGE, CRAFT, SLEEP, REPAIR, WORK, GUARD, HOLD
#
# Implementation pattern:
# 1. Create generate<Verb>NarrativePrompt() function
# 2. Add case in build_renderer_prompt() switch statement
# 3. Include THAUMWORLD-specific context from docs/EFFECTS.md
# 4. Keep prompts descriptive, 1-3 sentences output
# 5. Use second person perspective
# 6. Handle both success and failure cases
#
# Priority order based on frequency:
# 1. HELP - Assist allies in combat or tasks
# 2. DEFEND - Block/parry incoming attacks  
# 3. DODGE - Evade attacks or hazards
# 4. GRAPPLE - Wrestle and restrain targets
# 5. CRAFT - Create items and equipment
# 6. SLEEP - Rest and recover (extended action)
# 7. REPAIR - Fix damaged items (extended action)
# 8. WORK - Labor and production (extended action)
# 9. GUARD - Watch and protect area
# 10. HOLD - Ready action for trigger condition
#
# Reference: See docs/EFFECTS.md for THAUMWORLD mechanics
