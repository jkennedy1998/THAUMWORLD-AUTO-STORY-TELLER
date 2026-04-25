/**
 * WebSocket Client for Renderer
 * 
 * Connects to WebSocket server and receives real-time tag updates
 * Replaces the broken EventEmitter approach that doesn't work across
 * Electron process boundaries.
 */

import type { TagChangeEvent } from '../shared/event_emitter.js';
import { DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT } from '../shared/multiplayer_transport.js';

/**
 * WebSocket client for receiving tag events
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private sessionToken: string | null = null;
  private slot: number = 1;
  private reconnectInterval: number = 5000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: number = 10000;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatAckTimer: ReturnType<typeof setTimeout> | null = null;
  private mainThreadMonitorTimer: ReturnType<typeof setInterval> | null = null;
  private lastMainThreadMonitorAt: number = 0;
  private connectionId: string | null = null;
  private eventHandlers: Map<string, ((event: any) => void)[]> = new Map();

  private isMovementType(type: string): boolean {
    return type === 'CONTROLLED_ACTOR_MOVED' || type === 'ENTITY_MOVED_BATCH';
  }

  private logMovementStage(label: string, type: string, payload: any, extra: Record<string, unknown> = {}): void {
    console.log('[WebSocketClient] movement stage ' + JSON.stringify({
      label,
      type,
      sent_at_ms: Number(payload?.sent_at_ms ?? 0) || null,
      bridge_ws_sent_at_ms: Number(payload?.bridge_ws_sent_at_ms ?? 0) || null,
      seq: Number(payload?.seq ?? 0) || null,
      update_count: Array.isArray(payload?.updates) ? payload.updates.length : null,
      ...extra,
    }));
  }

  constructor(baseUrl: string = DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT.bridge_ws_base_url) {
    this.url = baseUrl;
  }

  private buildUrl(): string | null {
    const token = String(this.sessionToken ?? '').trim();
    if (!token) return null;
    return `${this.url}?slot=${encodeURIComponent(String(this.slot))}&session_token=${encodeURIComponent(token)}`;
  }

  updateConnectionOptions(options: { sessionToken?: string | null; slot?: number | null; baseUrl?: string | null }): void {
    const nextBaseUrl = typeof options.baseUrl === 'string' ? options.baseUrl.trim() : '';
    if (nextBaseUrl) {
      this.url = nextBaseUrl;
    }
    if (typeof options.sessionToken === 'string') {
      this.sessionToken = options.sessionToken.trim() || null;
    }
    if (typeof options.slot === 'number' && Number.isFinite(options.slot) && options.slot > 0) {
      this.slot = Math.floor(options.slot);
    }
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.connect();
      return;
    }
    this.disconnect();
    this.connect();
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    try {
      const connectionUrl = this.buildUrl();
      if (!connectionUrl) {
        console.log('[WebSocketClient] Waiting for multiplayer session before connecting');
        return;
      }
      console.log('[WebSocketClient] Connecting to', connectionUrl.replace(/session_token=[^&]+/, 'session_token=[redacted]'));
      this.ws = new WebSocket(connectionUrl);

      this.ws.onopen = () => {
        console.log('[WebSocketClient] Connected successfully');
        this.startMainThreadMonitor();
        // Clear any pending reconnect timer
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (message: MessageEvent) => {
        try {
          const data = JSON.parse(message.data);
          const received_at_ms = Date.now();
          const type = String(data?.type ?? '');
          const payload = data?.data ?? {};
          if (this.isMovementType(type)) {
            console.log('[WebSocketClient] movement message received ' + JSON.stringify({
              type,
              received_at_ms,
              sent_at_ms: Number(payload?.sent_at_ms ?? 0) || null,
              bridge_http_received_at_ms: Number(payload?.bridge_http_received_at_ms ?? 0) || null,
              bridge_ws_sent_at_ms: Number(payload?.bridge_ws_sent_at_ms ?? 0) || null,
              http_to_bridge_ms: (Number(payload?.sent_at_ms ?? 0) > 0 && Number(payload?.bridge_http_received_at_ms ?? 0) > 0)
                ? Math.max(0, Number(payload.bridge_http_received_at_ms) - Number(payload.sent_at_ms))
                : null,
              bridge_queue_ms: (Number(payload?.bridge_http_received_at_ms ?? 0) > 0 && Number(payload?.bridge_ws_sent_at_ms ?? 0) > 0)
                ? Math.max(0, Number(payload.bridge_ws_sent_at_ms) - Number(payload.bridge_http_received_at_ms))
                : null,
              ws_to_client_ms: (Number(payload?.bridge_ws_sent_at_ms ?? 0) > 0)
                ? Math.max(0, received_at_ms - Number(payload.bridge_ws_sent_at_ms))
                : null,
              seq: Number(payload?.seq ?? 0) || null,
              update_count: Array.isArray(payload?.updates) ? payload.updates.length : null,
            }));
            this.logMovementStage('onmessage_before_handle', type, payload, { received_at_ms });
          }
          const handle_started_at_ms = Date.now();
          this.handleMessage(data);
          if (this.isMovementType(type)) {
            this.logMovementStage('onmessage_after_handle', type, payload, {
              received_at_ms,
              handle_started_at_ms,
              handle_finished_at_ms: Date.now(),
              onmessage_handle_ms: Math.max(0, Date.now() - handle_started_at_ms),
            });
          }
        } catch (err) {
          console.error('[WebSocketClient] Failed to parse message:', err);
        }
      };

      this.ws.onclose = () => {
        this.clearHeartbeatTimers();
        this.stopMainThreadMonitor();
        console.log('[WebSocketClient] Connection closed, reconnecting in', this.reconnectInterval, 'ms');
        this.scheduleReconnect();
      };

      this.ws.onerror = (error: Event) => {
        console.error('[WebSocketClient] WebSocket error:', error);
      };

    } catch (err) {
      console.error('[WebSocketClient] Failed to connect:', err);
      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: any): void {
    const t = String(data?.type ?? '');
    if (!t) return;
    const payload = (data as any)?.data;
    const handle_started_at_ms = Date.now();

    if (t === 'CONNECTED') {
      console.log('[WebSocketClient] Server says:', data.message);
      this.connectionId = typeof data?.connection_id === 'string' ? data.connection_id : null;
      this.startHeartbeat();
      return;
    }

    if (t === 'SESSION_HEARTBEAT_ACK') {
      this.clearHeartbeatAckTimer();
      return;
    }

    if (t === 'SESSION_INVALIDATED' || t === 'CLAIM_INVALIDATED') {
      this.emit(t, (data as any)?.data);
      return;
    }

    // Standard bridge payload shape: { type, data }
    this.emit(t, (data as any)?.data);
    if (this.isMovementType(t)) {
      this.logMovementStage('handleMessage_after_emit', t, payload, {
        handle_started_at_ms,
        handle_finished_at_ms: Date.now(),
        handle_message_ms: Math.max(0, Date.now() - handle_started_at_ms),
      });
    }
  }

  /**
   * Emit event to registered handlers
   */
  private emit(eventType: string, event: TagChangeEvent): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const emit_started_at_ms = Date.now();
      handlers.forEach((handler) => {
        try {
          handler(event);
        } catch (err) {
          console.error('[WebSocketClient] Handler error:', err);
        }
      });
      if (this.isMovementType(eventType)) {
        this.logMovementStage('emit_handlers_complete', eventType, event, {
          handler_count: handlers.length,
          emit_started_at_ms,
          emit_finished_at_ms: Date.now(),
          emit_handler_ms: Math.max(0, Date.now() - emit_started_at_ms),
        });
      }
    }
  }

  /**
   * Schedule reconnect attempt
   */
  private scheduleReconnect(): void {
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, this.reconnectInterval);
    }
  }

  private send(type: string, data?: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, data }));
  }

  private clearHeartbeatAckTimer(): void {
    if (this.heartbeatAckTimer) {
      clearTimeout(this.heartbeatAckTimer);
      this.heartbeatAckTimer = null;
    }
  }

  private clearHeartbeatTimers(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearHeartbeatAckTimer();
  }

  private startMainThreadMonitor(): void {
    this.stopMainThreadMonitor();
    this.lastMainThreadMonitorAt = Date.now();
    this.mainThreadMonitorTimer = setInterval(() => {
      const now = Date.now();
      const delta_ms = Math.max(0, now - this.lastMainThreadMonitorAt);
      this.lastMainThreadMonitorAt = now;
      if (delta_ms >= 250) {
        console.log('[WebSocketClient] main thread stall ' + JSON.stringify({
          observed_at_ms: now,
          delta_ms,
        }));
      }
    }, 50);
  }

  private stopMainThreadMonitor(): void {
    if (this.mainThreadMonitorTimer) {
      clearInterval(this.mainThreadMonitorTimer);
      this.mainThreadMonitorTimer = null;
    }
    this.lastMainThreadMonitorAt = 0;
  }

  private scheduleHeartbeat(): void {
    this.heartbeatTimer = setTimeout(() => {
      this.sendHeartbeat();
    }, this.heartbeatInterval);
  }

  private startHeartbeat(): void {
    this.clearHeartbeatTimers();
    this.sendHeartbeat();
  }

  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.send('SESSION_HEARTBEAT', {
      connection_id: this.connectionId,
      sent_at_ms: Date.now(),
    });
    this.clearHeartbeatAckTimer();
    this.heartbeatAckTimer = setTimeout(() => {
      try {
        this.ws?.close();
      } catch {
        // ignore close failure
      }
    }, 4000);
    this.scheduleHeartbeat();
  }

  /**
   * Subscribe to tag events
   */
  on(eventType: string, handler: (event: any) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  /**
   * Unsubscribe from tag events
   */
  off(eventType: string, handler: (event: any) => void): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.clearHeartbeatTimers();
    this.stopMainThreadMonitor();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    console.log('[WebSocketClient] Disconnected');
  }
}

// Singleton instance
let client: WebSocketClient | null = null;

/**
 * Initialize WebSocket client (call from renderer startup)
 */
export function initWebSocketClient(baseUrl?: string, options?: { sessionToken?: string | null; slot?: number | null; baseUrl?: string | null }): WebSocketClient {
  if (!client) {
    client = new WebSocketClient(baseUrl || DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT.bridge_ws_base_url);
  }
  else if (baseUrl && baseUrl.trim()) {
    client.updateConnectionOptions({ baseUrl });
  }
  if (options) client.updateConnectionOptions(options);
  else client.connect();
  return client;
}

/**
 * Get existing WebSocket client instance
 */
export function getWebSocketClient(): WebSocketClient | null {
  return client;
}

export default WebSocketClient;
