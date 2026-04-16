/**
 * Event Bridge Client
 * 
 * HTTP client for backend processes to send events to the event bridge.
 * All backend services use this to broadcast events to the renderer.
 */

import { debug_event } from './debug_event.js';
import type { TagChangeEvent } from './event_emitter.js';
import { WebSocket } from 'ws';

const BRIDGE_URL = 'http://127.0.0.1:8788';
const BRIDGE_WS_URL = 'ws://127.0.0.1:8789?role=publisher';

export type BridgeDeliveryScope =
  | { scope?: 'public' }
  | { scope: 'connection'; connection_id: string };

type BridgeMessageEnvelope = {
  type: string;
  data?: any;
  delivery?: BridgeDeliveryScope;
};

function isMovementBridgeType(type: string): boolean {
  return type === 'CONTROLLED_ACTOR_MOVED' || type === 'ENTITY_MOVED_BATCH';
}

let publisherSocket: WebSocket | null = null;
let publisherConnecting = false;
let publisherReconnectTimer: ReturnType<typeof setTimeout> | null = null;
const publisherQueue: BridgeMessageEnvelope[] = [];

function schedulePublisherReconnect(): void {
  if (publisherReconnectTimer) return;
  publisherReconnectTimer = setTimeout(() => {
    publisherReconnectTimer = null;
    ensurePublisherSocket();
  }, 250);
}

function flushPublisherQueue(): void {
  if (!publisherSocket || publisherSocket.readyState !== WebSocket.OPEN) return;
  while (publisherQueue.length > 0) {
    const next = publisherQueue.shift();
    if (!next) break;
    if (isMovementBridgeType(String(next.type ?? ''))) {
      const payload = next.data ?? {};
      debug_event('EVENT_BRIDGE_CLIENT', 'publisher_flush_send', {
        type: next.type,
        sent_at_ms: Number(payload?.sent_at_ms ?? 0) || null,
        resolved_at_ms: Number(payload?.resolved_at_ms ?? 0) || null,
        publish_call_started_at_ms: Number(payload?.publish_call_started_at_ms ?? 0) || null,
        publisher_emit_called_at_ms: Number(payload?.publisher_emit_called_at_ms ?? 0) || null,
        publisher_queue_pushed_at_ms: Number(payload?.publisher_queue_pushed_at_ms ?? 0) || null,
        publisher_socket_send_called_at_ms: Date.now(),
        queue_remaining: publisherQueue.length,
        seq: Number(payload?.seq ?? 0) || null,
        update_count: Array.isArray(payload?.updates) ? payload.updates.length : null,
      });
    }
    publisherSocket.send(JSON.stringify(next));
  }
}

function ensurePublisherSocket(): void {
  if (publisherSocket && (publisherSocket.readyState === WebSocket.OPEN || publisherSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (publisherConnecting) return;
  publisherConnecting = true;
  try {
    const socket = new WebSocket(BRIDGE_WS_URL);
    publisherSocket = socket;
    socket.onopen = () => {
      publisherConnecting = false;
      flushPublisherQueue();
    };
    socket.onclose = () => {
      publisherConnecting = false;
      if (publisherSocket === socket) publisherSocket = null;
      schedulePublisherReconnect();
    };
    socket.onerror = () => {
      publisherConnecting = false;
    };
    socket.onmessage = () => {
      // no-op
    };
  } catch {
    publisherConnecting = false;
    schedulePublisherReconnect();
  }
}

function tryEmitViaPublisherSocket(message: BridgeMessageEnvelope): boolean {
  const type = String(message.type ?? '');
  const movement = isMovementBridgeType(type);
  const payload = movement ? { ...(message.data ?? {}) } : message.data;
  const emit_called_at_ms = Date.now();
  if (movement) {
    (payload as any).publisher_emit_called_at_ms = emit_called_at_ms;
  }
  const nextMessage = movement
    ? { ...message, data: payload }
    : message;
  ensurePublisherSocket();
  if (publisherSocket && publisherSocket.readyState === WebSocket.OPEN) {
    if (movement) {
      (payload as any).publisher_socket_send_called_at_ms = Date.now();
      debug_event('EVENT_BRIDGE_CLIENT', 'publisher_direct_send', {
        type,
        sent_at_ms: Number((payload as any)?.sent_at_ms ?? 0) || null,
        resolved_at_ms: Number((payload as any)?.resolved_at_ms ?? 0) || null,
        publish_call_started_at_ms: Number((payload as any)?.publish_call_started_at_ms ?? 0) || null,
        resolved_to_emit_call_ms: (Number((payload as any)?.resolved_at_ms ?? 0) > 0 && Number((payload as any)?.publish_call_started_at_ms ?? 0) > 0)
          ? Math.max(0, Number((payload as any).publish_call_started_at_ms) - Number((payload as any).resolved_at_ms))
          : null,
        emit_call_to_publisher_emit_ms: (Number((payload as any)?.publish_call_started_at_ms ?? 0) > 0 && Number((payload as any)?.publisher_emit_called_at_ms ?? 0) > 0)
          ? Math.max(0, Number((payload as any).publisher_emit_called_at_ms) - Number((payload as any).publish_call_started_at_ms))
          : null,
        publisher_emit_called_at_ms: Number((payload as any)?.publisher_emit_called_at_ms ?? 0) || null,
        publisher_socket_send_called_at_ms: Number((payload as any)?.publisher_socket_send_called_at_ms ?? 0) || null,
        socket_ready_state: publisherSocket.readyState,
        queue_length: publisherQueue.length,
        seq: Number((payload as any)?.seq ?? 0) || null,
        update_count: Array.isArray((payload as any)?.updates) ? (payload as any).updates.length : null,
      });
    }
    publisherSocket.send(JSON.stringify(nextMessage));
    return true;
  }
  if (publisherQueue.length < 512) {
    if (movement) {
      (payload as any).publisher_queue_pushed_at_ms = Date.now();
      debug_event('EVENT_BRIDGE_CLIENT', 'publisher_queued', {
        type,
        sent_at_ms: Number((payload as any)?.sent_at_ms ?? 0) || null,
        resolved_at_ms: Number((payload as any)?.resolved_at_ms ?? 0) || null,
        publish_call_started_at_ms: Number((payload as any)?.publish_call_started_at_ms ?? 0) || null,
        publisher_emit_called_at_ms: Number((payload as any)?.publisher_emit_called_at_ms ?? 0) || null,
        publisher_queue_pushed_at_ms: Number((payload as any)?.publisher_queue_pushed_at_ms ?? 0) || null,
        socket_ready_state: publisherSocket?.readyState ?? null,
        queue_length_before_push: publisherQueue.length,
        seq: Number((payload as any)?.seq ?? 0) || null,
        update_count: Array.isArray((payload as any)?.updates) ? (payload as any).updates.length : null,
      });
    }
    publisherQueue.push(nextMessage);
  }
  return false;
}

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
export async function emitBridgeMessage(type: string, data?: any, delivery?: BridgeDeliveryScope): Promise<void> {
  const t = String(type ?? '').trim();
  if (!t) return;
  const message = { type: t, data, delivery: delivery ?? { scope: 'public' } };
  if (tryEmitViaPublisherSocket(message)) {
    return;
  }
  try {
    const response = await fetch(`${BRIDGE_URL}/api/events/emit_any`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
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
