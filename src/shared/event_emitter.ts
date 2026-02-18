/**
 * EventEmitter - Unified event system for THAUMWORLD
 * 
 * Provides publish/subscribe pattern for cross-system communication.
 * Used primarily for tag changes, but extensible for any events.
 * 
 * Features:
 * - Type-safe event handling
 * - Supports both actors and NPCs uniformly
 * - Singleton pattern for global access
 * - Debug logging integration
 */

import { debug_event } from "./debug_event.js";

/**
 * Tag change event types
 */
export type TagChangeType = 'TAG_ADDED' | 'TAG_REMOVED' | 'TAG_UPDATED' | 'TAG_DISPERSING';

/**
 * Event payload for tag changes
 */
export interface TagChangeEvent {
  type: TagChangeType;
  entityRef: string;           // e.g., "actor.henry_actor" or "npc.grenda"
  tagName: string;             // e.g., "FIRE!"
  oldMag?: number;             // Previous magnitude (if updating)
  newMag: number;              // Current magnitude
  meta: string[];              // Meta tags applied to this tag instance
  timestamp: number;           // Unix timestamp in milliseconds
  source?: string;             // Source of the change (e.g., "action", "dispersing", "manual")
}

/**
 * Generic event callback type
 */
export type EventCallback<T = any> = (data: T) => void;

/**
 * EventEmitter class - Implements pub/sub pattern
 */
export class EventEmitter {
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private onceListeners: Map<string, Set<EventCallback>> = new Map();

  /**
   * Subscribe to an event
   * @param event - Event name (e.g., 'tag:changed', 'tag:added')
   * @param callback - Function to call when event fires
   * @returns Unsubscribe function
   */
  on<T = any>(event: string, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.off(event, callback);
    };
  }

  /**
   * Subscribe to an event for one-time execution
   * @param event - Event name
   * @param callback - Function to call once
   * @returns Unsubscribe function
   */
  once<T = any>(event: string, callback: EventCallback<T>): () => void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }
    this.onceListeners.get(event)!.add(callback);

    return () => {
      this.off(event, callback);
    };
  }

  /**
   * Unsubscribe from an event
   * @param event - Event name
   * @param callback - Function to remove
   */
  off<T = any>(event: string, callback: EventCallback<T>): void {
    this.listeners.get(event)?.delete(callback);
    this.onceListeners.get(event)?.delete(callback);
  }

  /**
   * Emit an event to all subscribers
   * @param event - Event name
   * @param data - Event payload
   */
  emit<T = any>(event: string, data: T): void {
    // Log event for debugging
    debug_event("EVENT_EMITTER", event, data as Record<string, unknown>);

    // Notify regular listeners
    const regularListeners = this.listeners.get(event);
    if (regularListeners) {
      for (const callback of regularListeners) {
        try {
          callback(data);
        } catch (err) {
          console.error(`[EventEmitter] Error in listener for ${event}:`, err);
        }
      }
    }

    // Notify once listeners (and remove them)
    const oneTimeListeners = this.onceListeners.get(event);
    if (oneTimeListeners) {
      for (const callback of oneTimeListeners) {
        try {
          callback(data);
        } catch (err) {
          console.error(`[EventEmitter] Error in once-listener for ${event}:`, err);
        }
      }
      this.onceListeners.delete(event);
    }
  }

  /**
   * Remove all listeners for an event
   * @param event - Event name (if omitted, clears all events)
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
    }
  }

  /**
   * Get count of listeners for an event
   * @param event - Event name
   * @returns Number of listeners
   */
  listenerCount(event: string): number {
    const regular = this.listeners.get(event)?.size || 0;
    const once = this.onceListeners.get(event)?.size || 0;
    return regular + once;
  }

  /**
   * Check if event has any listeners
   * @param event - Event name
   * @returns True if has listeners
   */
  hasListeners(event: string): boolean {
    return this.listenerCount(event) > 0;
  }
}

/**
 * Global EventEmitter instance
 * Use this for all cross-system communication
 */
export const eventEmitter = new EventEmitter();

/**
 * Helper function to emit tag change events
 * @param event - TagChangeEvent payload
 */
export function emitTagChange(event: TagChangeEvent): void {
  // Emit specific event type
  eventEmitter.emit(`tag:${event.type.toLowerCase()}`, event);
  
  // Also emit generic tag:changed event
  eventEmitter.emit('tag:changed', event);
}

/**
 * Helper to check if entity is an actor
 * @param entityRef - Entity reference string
 */
export function isActor(entityRef: string): boolean {
  return entityRef.startsWith('actor.');
}

/**
 * Helper to check if entity is an NPC
 * @param entityRef - Entity reference string
 */
export function isNPC(entityRef: string): boolean {
  return entityRef.startsWith('npc.');
}

/**
 * Helper to extract entity type and ID
 * @param entityRef - Entity reference string
 * @returns Object with type and id
 */
export function parseEntityRef(entityRef: string): { type: 'actor' | 'npc' | 'unknown'; id: string } {
  if (entityRef.startsWith('actor.')) {
    return { type: 'actor', id: entityRef.slice(6) };
  } else if (entityRef.startsWith('npc.')) {
    return { type: 'npc', id: entityRef.slice(4) };
  }
  return { type: 'unknown', id: entityRef };
}

export default EventEmitter;