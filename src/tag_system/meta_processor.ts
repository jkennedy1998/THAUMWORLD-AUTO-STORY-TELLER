// Meta Tag Processor
// Applies meta-tag mechanics like DISPERSING to modify tag behavior over time

import { debug_event } from "../shared/debug_event.js";
import { tagRegistry } from "./registry.js";
import type { TagInstance } from "./registry.js";
import { load_actor, save_actor, find_actors } from "../actor_storage/store.js";
import { load_npc, save_npc, find_npcs } from "../npc_storage/store.js";
import { emitTagChange, type TagChangeEvent } from "../shared/event_emitter.js";

/**
 * MetaTagProcessor - Handles meta-tag mechanics
 * Currently implements: [DISPERSING] - auto-remove 1 MAG per turn
 */
export class MetaTagProcessor {
  
  // Rate limiting for free/non-timed mode (6 seconds = 1 turn equivalent)
  static lastDispersingTime: number = 0;
  static readonly DISPERSING_INTERVAL_MS = 6000; // 6 seconds per "turn" in free mode
  
  /**
   * Process dispersing tags on all entities in a data slot
   * Decreases MAG by 1 for any tag with [DISPERSING] meta tag
   * Removes tag when MAG reaches 0
   * 
   * Rate-limited: Only runs every 6 seconds in free/non-timed mode
   * (Timed events handle dispersing per turn via turn_manager hooks)
   */
  static async processDispersingTags(slot: number): Promise<void> {
    // Rate limiting check - skip if not enough time has passed
    const now = Date.now();
    if (now - this.lastDispersingTime < this.DISPERSING_INTERVAL_MS) {
      return;
    }
    this.lastDispersingTime = now;
    
    debug_event("META.TAGS", "process_dispersing.start", { slot, interval: this.DISPERSING_INTERVAL_MS });
    
    // Process all actors
    const actors = find_actors(slot, {});
    debug_event("META.TAGS", "process_dispersing.found_actors", { count: actors.length });
    
    for (const actor of actors) {
      if (actor.id) {
        const result = load_actor(slot, actor.id);
        if (result.ok && result.actor) {
          const actorData = result.actor as any;
          const tagSummary = actorData.tags?.map((t: any) => `${t.name}:${t.mag}`).join(', ') || 'none';
          debug_event("META.TAGS", "process_dispersing.checking_actor", { actor: actor.id, tags: tagSummary });
          
          if (actorData.tags && Array.isArray(actorData.tags) && actorData.tags.length > 0) {
            // Debug: Log detailed tag state before processing
            const beforeTags = actorData.tags.map((t: any) => ({ name: t.name, mag: t.mag, meta: t.meta }));
            debug_event("META.TAGS", "process_dispersing.tags_before", { actor: actor.id, tags: beforeTags });
            
            const changes = this.processDispersingForEntity(`actor.${actor.id}`, actorData.tags);
            if (changes.length > 0) {
              debug_event("META.TAGS", "process_dispersing.actor_changes", { actor: actor.id, changes });
              
              // Debug: Log tags after processing but before filter
              const afterProcessTags = actorData.tags.map((t: any) => ({ name: t.name, mag: t.mag, type: typeof t.mag }));
              debug_event("META.TAGS", "process_dispersing.tags_after_process", { actor: actor.id, tags: afterProcessTags });
              
              // Remove tags that reached 0
              const beforeFilterCount = actorData.tags.length;
              actorData.tags = actorData.tags.filter((tag: TagInstance) => {
                const keep = tag.mag > 0;
                debug_event("META.TAGS", "process_dispersing.filter_check", { tag: tag.name, mag: tag.mag, keep });
                return keep;
              });
              const afterFilterCount = actorData.tags.length;
              debug_event("META.TAGS", "process_dispersing.filter_result", { actor: actor.id, before: beforeFilterCount, after: afterFilterCount });
              
              // Save the actor
              save_actor(slot, actor.id, actorData);
              
              // Verify save by reloading
              const verifyResult = load_actor(slot, actor.id);
              const verifyTags = verifyResult.ok && verifyResult.actor ? (verifyResult.actor as any).tags?.length : 'error';
              debug_event("META.TAGS", "process_dispersing.actor_saved", { actor: actor.id, remainingTags: actorData.tags.length, verifyAfterSave: verifyTags });
            }
          }
        }
      }
    }
    
    // Process all NPCs
    const npcs = find_npcs(slot, {});
    for (const npc of npcs) {
      if (npc.id) {
        const result = load_npc(slot, npc.id);
        if (result.ok && result.npc) {
          const npcData = result.npc;
          if (npcData.tags && Array.isArray(npcData.tags) && npcData.tags.length > 0) {
            const changes = this.processDispersingForEntity(`npc.${npc.id}`, npcData.tags);
            if (changes.length > 0) {
              // Remove tags that reached 0
              npcData.tags = npcData.tags.filter((tag: TagInstance) => tag.mag > 0);
              // Save the NPC
              save_npc(slot, npc.id, npcData);
            }
          }
        }
      }
    }
    
    debug_event("META.TAGS", "process_dispersing.complete", { slot });
  }
  
  /**
   * Process dispersing tags for a single entity
   * Returns array of changes made for debug logging
   */
  static processDispersingForEntity(entityId: string, tags: TagInstance[]): Array<{
    tagName: string;
    oldMag: number;
    newMag: number;
    removed: boolean;
  }> {
    const changes: Array<{
      tagName: string;
      oldMag: number;
      newMag: number;
      removed: boolean;
    }> = [];
    
    for (const tag of tags) {
      // Check if this tag has the DISPERSING meta tag
      const hasDispersing = tag.meta && tag.meta.includes("DISPERSING");
      
      if (hasDispersing) {
        const oldMag = tag.mag;
        const newMag = Math.max(0, tag.mag - 1);
        
        if (newMag === 0) {
          // Tag will be removed - set mag to 0 so filter can remove it
          tag.mag = 0;
          
          changes.push({
            tagName: tag.name,
            oldMag,
            newMag: 0,
            removed: true
          });
          
          debug_event("META.TAGS", "tag.dispersing.removed", {
            entity: entityId,
            tag: tag.name,
            mag: oldMag
          });

          // Emit event for tag removal
          emitTagChange({
            type: 'TAG_REMOVED',
            entityRef: entityId,
            tagName: tag.name,
            oldMag,
            newMag: 0,
            meta: tag.meta,
            timestamp: Date.now(),
            source: 'dispersing'
          });
        } else {
          // Tag magnitude decreased
          tag.mag = newMag;
          changes.push({
            tagName: tag.name,
            oldMag,
            newMag,
            removed: false
          });
          
          debug_event("META.TAGS", "tag.dispersing.decreased", {
            entity: entityId,
            tag: tag.name,
            oldMag,
            newMag
          });

          // Emit event for tag dispersing
          emitTagChange({
            type: 'TAG_DISPERSING',
            entityRef: entityId,
            tagName: tag.name,
            oldMag,
            newMag,
            meta: tag.meta,
            timestamp: Date.now(),
            source: 'dispersing'
          });
        }
      }
    }
    
    return changes;
  }
  
  /**
   * Check if a tag instance should disperse
   */
  static shouldDisperse(tag: TagInstance): boolean {
    if (!tag.meta || tag.meta.length === 0) return false;
    
    return tag.meta.includes("DISPERSING");
  }
}

export default MetaTagProcessor;