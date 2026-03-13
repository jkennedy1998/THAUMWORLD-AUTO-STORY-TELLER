/**
 * WebSocket Client for Renderer
 * 
 * Connects to WebSocket server and receives real-time tag updates
 * Replaces the broken EventEmitter approach that doesn't work across
 * Electron process boundaries.
 */

import type { TagChangeEvent } from '../shared/event_emitter.js';

/**
 * WebSocket client for receiving tag events
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectInterval: number = 5000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private eventHandlers: Map<string, ((event: any) => void)[]> = new Map();

  constructor(port: number = 8789) {
    this.url = `ws://localhost:${port}`;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    try {
      console.log('[WebSocketClient] Connecting to', this.url);
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WebSocketClient] Connected successfully');
        // Clear any pending reconnect timer
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (message: MessageEvent) => {
        try {
          const data = JSON.parse(message.data);
          this.handleMessage(data);
        } catch (err) {
          console.error('[WebSocketClient] Failed to parse message:', err);
        }
      };

      this.ws.onclose = () => {
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

    if (t === 'CONNECTED') {
      console.log('[WebSocketClient] Server says:', data.message);
      return;
    }

    // Standard bridge payload shape: { type, data }
    this.emit(t, (data as any)?.data);
  }

  /**
   * Emit event to registered handlers
   */
  private emit(eventType: string, event: TagChangeEvent): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(event);
        } catch (err) {
          console.error('[WebSocketClient] Handler error:', err);
        }
      });
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
export function initWebSocketClient(port?: number): WebSocketClient {
  if (!client) {
    client = new WebSocketClient(port);
    client.connect();
  }
  return client;
}

/**
 * Get existing WebSocket client instance
 */
export function getWebSocketClient(): WebSocketClient | null {
  return client;
}

export default WebSocketClient;
