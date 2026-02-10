/**
 * Conversation State Management
 * 
 * Tracks active conversations between NPCs and other entities.
 * Integrates with the movement system to pause/resume NPC goals.
 * 
 * A conversation:
 * - Starts when an NPC is addressed or detects communication
 * - Lasts for 30 in-game seconds (renewed with each message)
 * - Ends on timeout, farewell, or explicit end
 * - Restores previous goal when ended
 */

import type { Goal } from "./movement_state.js";
import { debug_log } from "../shared/debug.js";
import { SERVICE_CONFIG } from "../shared/constants.js";

// Duration in real-world milliseconds (30 seconds)
const CONVERSATION_DURATION_MS = 30 * 1000;

/** Active conversation state for an NPC */
export interface ActiveConversation {
  npc_ref: string;
  target_entity: string;
  conversation_id: string;
  started_at_ms: number;        // Real-world timestamp (Date.now())
  timeout_at_ms: number;        // Auto-expire time (Date.now() based)
  participants: string[];       // All involved entity refs
  previous_goal: Goal | null;   // Goal to restore after conversation
  previous_path_state: {
    path: Array<{ x: number; y: number }>;
    path_index: number;
  } | null;
  last_message_at: number;      // Last activity timestamp (Date.now())
  message_count: number;        // How many messages exchanged
}

// In-memory storage - Map<npc_ref, ActiveConversation>
const active_conversations = new Map<string, ActiveConversation>();

/**
 * Generate unique conversation ID
 */
function generate_conversation_id(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get current time in milliseconds for conversation tracking
 * Uses real-world time (Date.now()) for accurate timeout handling
 */
function get_conversation_time_ms(): number {
  return Date.now();
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
  previous_path_state: ActiveConversation["previous_path_state"] = null
): string {
  const now = get_conversation_time_ms();
  
  const conversation: ActiveConversation = {
    npc_ref,
    target_entity,
    conversation_id: generate_conversation_id(),
    started_at_ms: now,
    timeout_at_ms: now + CONVERSATION_DURATION_MS,
    participants,
    previous_goal,
    previous_path_state,
    last_message_at: now,
    message_count: 1
  };
  
  active_conversations.set(npc_ref, conversation);
  
  debug_log("Conversation", `Started conversation for ${npc_ref}`, {
    with: target_entity,
    participants: participants.length,
    timeout: new Date(conversation.timeout_at_ms).toISOString()
  });
  
  return conversation.conversation_id;
}

/**
 * End a conversation
 * Called on timeout, farewell, or explicit end
 * Returns the previous goal for restoration
 */
export function end_conversation(npc_ref: string): ActiveConversation | null {
  const conv = active_conversations.get(npc_ref);
  if (!conv) return null;
  
  active_conversations.delete(npc_ref);
  
  debug_log("Conversation", `Ended conversation for ${npc_ref}`, {
    duration_ms: get_conversation_time_ms() - conv.started_at_ms,
    messages: conv.message_count
  });
  
  return conv;
}

/**
 * Update conversation timeout when new message arrives
 * Extends conversation by another 30 seconds
 */
export function update_conversation_timeout(npc_ref: string): boolean {
  const conv = active_conversations.get(npc_ref);
  if (!conv) return false;
  
  const now = get_conversation_time_ms();
  conv.timeout_at_ms = now + CONVERSATION_DURATION_MS;
  conv.last_message_at = now;
  conv.message_count++;
  
  debug_log("Conversation", `Extended conversation for ${npc_ref}`, {
    message_count: conv.message_count,
    new_timeout: new Date(conv.timeout_at_ms).toISOString()
  });
  
  return true;
}

/**
 * Check if NPC is currently in a conversation
 */
export function is_in_conversation(npc_ref: string): boolean {
  return active_conversations.has(npc_ref);
}

/**
 * Get active conversation for an NPC
 */
export function get_conversation(npc_ref: string): ActiveConversation | null {
  return active_conversations.get(npc_ref) ?? null;
}

/**
 * Check if conversation has timed out
 */
export function has_conversation_timed_out(npc_ref: string): boolean {
  const conv = active_conversations.get(npc_ref);
  if (!conv) return false;
  
  const now = get_conversation_time_ms();
  return now >= conv.timeout_at_ms;
}

/**
 * Get conversation partner
 */
export function get_conversation_target(npc_ref: string): string | null {
  return active_conversations.get(npc_ref)?.target_entity ?? null;
}

/**
 * Check if entity is part of the conversation
 */
export function is_conversation_participant(
  npc_ref: string,
  entity_ref: string
): boolean {
  const conv = active_conversations.get(npc_ref);
  if (!conv) return false;
  
  return conv.participants.includes(entity_ref);
}

/**
 * Add participant to conversation
 */
export function add_conversation_participant(
  npc_ref: string,
  entity_ref: string
): boolean {
  const conv = active_conversations.get(npc_ref);
  if (!conv) return false;
  
  if (!conv.participants.includes(entity_ref)) {
    conv.participants.push(entity_ref);
    debug_log("Conversation", `Added ${entity_ref} to conversation with ${npc_ref}`);
  }
  
  return true;
}

/**
 * Remove participant from conversation
 * Ends conversation if target is removed
 */
export function remove_conversation_participant(
  npc_ref: string,
  entity_ref: string
): boolean {
  const conv = active_conversations.get(npc_ref);
  if (!conv) return false;
  
  const idx = conv.participants.indexOf(entity_ref);
  if (idx > -1) {
    conv.participants.splice(idx, 1);
    debug_log("Conversation", `Removed ${entity_ref} from conversation with ${npc_ref}`);
  }
  
  // End conversation if target left
  if (entity_ref === conv.target_entity) {
    end_conversation(npc_ref);
    return true;
  }
  
  return false;
}

/**
 * Update all conversations, ending timed-out ones
 * Call this periodically (e.g., every tick)
 */
export function update_conversations(): string[] {
  const ended: string[] = [];
  const now = get_conversation_time_ms();
  
  for (const [npc_ref, conv] of active_conversations) {
    if (now >= conv.timeout_at_ms) {
      end_conversation(npc_ref);
      ended.push(npc_ref);
    }
  }
  
  if (ended.length > 0) {
    debug_log("Conversation", `Auto-ended ${ended.length} timed-out conversation(s)`);
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
  const duration = get_conversation_time_ms() - conv.started_at_ms;
  return `${conv.npc_ref} talking to ${conv.target_entity} (${conv.message_count} msgs, ${Math.floor(duration / 1000)}s)`;
}
