/**
 * Event Bridge Client
 * 
 * HTTP client for backend processes to send events to the event bridge.
 * All backend services use this to broadcast events to the renderer.
 */

import { debug_event } from './debug_event.js';
import type { TagChangeEvent } from './event_emitter.js';

const BRIDGE_URL = 'http://localhost:8788';

/**
 * Send event to event bridge via HTTP POST
 * This allows cross-process event broadcasting
 */
export async function emitToBridge(event: TagChangeEvent): Promise<void> {
  try {
    const response = await fetch(`${BRIDGE_URL}/api/events/emit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      const errorText = await response.text();
      debug_event('EVENT_BRIDGE_CLIENT', 'emit_failed', {
        type: event.type,
        entityRef: event.entityRef,
        status: response.status,
        error: errorText
      });
      return;
    }

    const result = await response.json();
    
    if (result.success) {
      debug_event('EVENT_BRIDGE_CLIENT', 'emit_success', {
        type: event.type,
        entityRef: event.entityRef,
        tagName: event.tagName,
        clientsNotified: result.clientsNotified
      });
    }

  } catch (err) {
    // Silently fail - event bridge might not be running yet
    // This is okay during startup
    debug_event('EVENT_BRIDGE_CLIENT', 'emit_error', {
      type: event.type,
      entityRef: event.entityRef,
      error: (err as Error).message
    });
  }
}

/**
 * Send a generic message to the event bridge.
 * Used for non-tag high-frequency events like breath ticks.
 */
export async function emitBridgeMessage(type: string, data?: any): Promise<void> {
  const t = String(type ?? '').trim();
  if (!t) return;
  try {
    const response = await fetch(`${BRIDGE_URL}/api/events/emit_any`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: t, data }),
    });

    // Avoid per-tick spam; only log errors.
    if (!response.ok) {
      const errorText = await response.text();
      debug_event('EVENT_BRIDGE_CLIENT', 'emit_any_failed', {
        type: t,
        status: response.status,
        error: errorText,
      });
    }
  } catch (err) {
    debug_event('EVENT_BRIDGE_CLIENT', 'emit_any_error', {
      type: t,
      error: (err as Error).message,
    });
  }
}

/**
 * Check if event bridge is available
 */
export async function isBridgeAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${BRIDGE_URL}/api/events/emit`, {
      method: 'OPTIONS',
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default { emitToBridge, isBridgeAvailable };
