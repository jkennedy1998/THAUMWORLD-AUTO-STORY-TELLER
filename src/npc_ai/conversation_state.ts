/**
 * Conversation State Management
 * 
 * Tracks active conversations between NPCs and other entities.
 * Integrates with the movement system to pause/resume NPC goals.
 * 
 * Compatibility restore metadata for conversation-adjacent behavior.
 * Canonical conversation truth now lives in session/presence state.
 * This module exists to restore movement goals and preserve a short-lived
 * compatibility record for witness/movement flows that have not been fully removed yet.
 */

import type { Goal } from "./movement_state.js";
import { debug_log } from "../shared/debug.js";
import { SERVICE_CONFIG } from "../shared/constants.js";
import { clear_conversation_presence, get_conversation_presence, get_current_conversation_breath, set_conversation_presence } from "../shared/conversation_presence_store.js";

const CONVERSATION_DURATION_BREATHS = 30;
const data_slot = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;

/** Active conversation state for an NPC */
export interface ActiveConversation {
  npc_ref: string;
  target_entity: string;
  conversation_id: string;
  place_id?: string;
  started_at_breath: number;
  expires_at_breath: number;
  participants: string[];       // All involved entity refs
  previous_goal: Goal | null;   // Goal to restore after conversation
  previous_path_state: {
    path: Array<{ x: number; y: number }>;
    path_index: number;
  } | null;
  last_message_breath: number;
  message_count: number;        // How many messages exchanged
}

// Compatibility-only local restore metadata. Cross-process presence is the canonical
// truth for whether an NPC is still considered in conversation.
const active_conversations = new Map<string, ActiveConversation>();

/**
 * Generate unique conversation ID
 */
function generate_conversation_id(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get current compatibility breath for conversation tracking
 */
function get_conversation_breath(place_id?: string | null): number {
  return get_current_conversation_breath(data_slot, place_id ?? null);
}

/**
 * Start a new conversation
 * Called when NPC should engage with a speaker
 */
export function start_conversation(
  npc_ref: string,
  target_entity: string,
  participants: string[],
  previous_goal: Goal | null = null,
  previous_path_state: ActiveConversation["previous_path_state"] = null,
  place_id?: string | null,
): string {
  const resolved_place_id = typeof place_id === "string" && place_id.length > 0 ? place_id : undefined;
  const now = get_conversation_breath(resolved_place_id);
  
  const conversation: ActiveConversation = {
    npc_ref,
    target_entity,
    conversation_id: generate_conversation_id(),
    place_id: resolved_place_id,
    started_at_breath: now,
    expires_at_breath: now + CONVERSATION_DURATION_BREATHS,
    participants,
    previous_goal,
    previous_path_state,
    last_message_breath: now,
    message_count: 1
  };
  
  active_conversations.set(npc_ref, conversation);
  set_conversation_presence(data_slot, npc_ref, target_entity, conversation.expires_at_breath, conversation.place_id);
  
  debug_log("Conversation", `Started conversation for ${npc_ref}`, {
    with: target_entity,
    participants: participants.length,
    expires_at_breath: conversation.expires_at_breath,
  });
  
  return conversation.conversation_id;
}

export function sync_conversation_restore_metadata(
  npc_ref: string,
  target_entity: string,
  participants: string[],
  place_id?: string | null,
  previous_goal: Goal | null = null,
  previous_path_state: ActiveConversation["previous_path_state"] = null,
): { conversation_id: string; created: boolean } {
  const resolved_place_id = typeof place_id === "string" && place_id.length > 0 ? place_id : undefined;
  const now = get_conversation_breath(resolved_place_id);
  const existing = active_conversations.get(npc_ref);
  if (!existing) {
    const conversation_id = start_conversation(npc_ref, target_entity, participants, previous_goal, previous_path_state, resolved_place_id);
    const created = active_conversations.get(npc_ref);
    if (created) {
      created.message_count = 0;
      created.last_message_breath = now;
      created.started_at_breath = now;
      created.expires_at_breath = now + CONVERSATION_DURATION_BREATHS;
      set_conversation_presence(data_slot, npc_ref, target_entity, created.expires_at_breath, created.place_id);
    }
    return { conversation_id, created: true };
  }

  existing.target_entity = target_entity;
  existing.place_id = resolved_place_id;
  existing.participants = Array.from(new Set([...existing.participants, ...participants]));
  existing.expires_at_breath = now + CONVERSATION_DURATION_BREATHS;
  existing.last_message_breath = now;
  set_conversation_presence(data_slot, npc_ref, target_entity, existing.expires_at_breath, existing.place_id);
  return { conversation_id: existing.conversation_id, created: false };
}

/**
 * End a conversation
 * Called on expiry, farewell, or explicit end
 * Returns the previous goal for restoration
 */
export function end_conversation(npc_ref: string): ActiveConversation | null {
  const conv = active_conversations.get(npc_ref);
  clear_conversation_presence(data_slot, npc_ref);
  if (!conv) return null;
  
  active_conversations.delete(npc_ref);
  
  debug_log("Conversation", `Ended conversation for ${npc_ref}`, {
    duration_breaths: get_conversation_breath(conv.place_id) - conv.started_at_breath,
    messages: conv.message_count
  });
  
  return conv;
}

/**
 * Extend conversation expiry when new message arrives
 * Extends conversation by another breath window
 */
export function update_conversation_timeout(npc_ref: string): boolean {
  const conv = active_conversations.get(npc_ref);
  if (!conv) return false;
  
  const now = get_conversation_breath(conv.place_id);
  conv.expires_at_breath = now + CONVERSATION_DURATION_BREATHS;
  conv.last_message_breath = now;
  conv.message_count++;
  set_conversation_presence(data_slot, npc_ref, conv.target_entity, conv.expires_at_breath, conv.place_id);
  
  debug_log("Conversation", `Extended conversation for ${npc_ref}`, {
    message_count: conv.message_count,
    expires_at_breath: conv.expires_at_breath,
  });
  
  return true;
}

/**
 * Check if NPC is currently in a conversation
 */
export function is_in_conversation(npc_ref: string): boolean {
  return get_conversation_presence(data_slot, npc_ref) !== null;
}

/**
 * Get active conversation for an NPC
 */
export function get_conversation(npc_ref: string): ActiveConversation | null {
  const conv = active_conversations.get(npc_ref) ?? null;
  if (!conv) return null;
  const presence = get_conversation_presence(data_slot, npc_ref);
  if (!presence) return null;
  conv.target_entity = presence.target_ref;
  conv.expires_at_breath = presence.expires_at_breath;
  conv.place_id = presence.place_id;
  return conv;
}

/**
 * Check if conversation has expired
 */
export function has_conversation_expired(npc_ref: string): boolean {
  return get_conversation_presence(data_slot, npc_ref) === null && active_conversations.has(npc_ref);
}

/**
 * Update all restore metadata records, ending expired ones.
 */
export function update_conversations(): ActiveConversation[] {
  const ended: ActiveConversation[] = [];
  
  for (const [npc_ref, conv] of active_conversations) {
    const presence = get_conversation_presence(data_slot, npc_ref);
    if (presence) {
      conv.target_entity = presence.target_ref;
      conv.expires_at_breath = presence.expires_at_breath;
      conv.place_id = presence.place_id;
      continue;
    }
    if (active_conversations.has(npc_ref)) {
      const ended_conv = end_conversation(npc_ref);
      if (ended_conv) ended.push(ended_conv);
    }
  }
  
  if (ended.length > 0) {
    debug_log("Conversation", `Auto-ended ${ended.length} expired conversation(s)`);
  }
  
  return ended;
}

/**
 * Get all active conversations
 */
export function get_all_conversations(): ActiveConversation[] {
  return Array.from(active_conversations.values());
}

/**
 * Get count of active conversations
 */
export function get_conversation_count(): number {
  return active_conversations.size;
}

/**
 * Clear all conversations
 * Use for cleanup/shutdown
 */
export function clear_all_conversations(): void {
  active_conversations.clear();
  debug_log("Conversation", "Cleared all conversations");
}

/**
 * Format conversation for debugging
 */
export function format_conversation_summary(conv: ActiveConversation): string {
  const duration = Math.max(0, get_conversation_breath(conv.place_id) - conv.started_at_breath);
  return `${conv.npc_ref} talking to ${conv.target_entity} (${conv.message_count} msgs, ${duration} breaths)`;
}
