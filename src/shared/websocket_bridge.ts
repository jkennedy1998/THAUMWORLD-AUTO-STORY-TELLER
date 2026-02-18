/**
 * WebSocket Bridge for Real-Time Tag Updates
 * 
 * Provides WebSocket server that broadcasts tag change events
 * from backend processes to renderer in real-time.
 * 
 * This solves the fundamental issue where EventEmitter doesn't
 * work across Electron process boundaries.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { debug_event } from '../shared/debug_event.js';
import { eventEmitter } from '../shared/event_emitter.js';
import type { TagChangeEvent } from '../shared/event_emitter.js';

/**
 * WebSocket bridge for broadcasting tag events
 */
export class WebSocketBridge {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private port: number;

  constructor(port: number = 8788) {
    this.port = port;
  }

  /**
   * Initialize WebSocket server and start forwarding events
   */
  start(): void {
    try {
      this.wss = new WebSocketServer({ port: this.port });
      
      debug_event('WEBSOCKET', 'server_started', { port: this.port });

      this.wss.on('connection', (ws: WebSocket) => {
        debug_event('WEBSOCKET', 'client_connected', { clientCount: this.clients.size + 1 });
        this.clients.add(ws);

        // Send initial connection confirmation
        ws.send(JSON.stringify({
          type: 'CONNECTED',
          message: 'WebSocket bridge connected',
          timestamp: Date.now()
        }));

        ws.on('close', () => {
          debug_event('WEBSOCKET', 'client_disconnected', { clientCount: this.clients.size - 1 });
          this.clients.delete(ws);
        });

        ws.on('error', (err: Error) => {
          debug_event('WEBSOCKET', 'client_error', { error: err.message });
          this.clients.delete(ws);
        });
      });

      this.wss.on('error', (err: Error) => {
        debug_event('WEBSOCKET', 'server_error', { error: err.message });
      });

      // Forward all tag events to connected clients
      this.setupEventForwarding();

    } catch (err) {
      debug_event('WEBSOCKET', 'server_start_failed', { error: (err as Error).message });
    }
  }

  /**
   * Forward EventEmitter events to WebSocket clients
   */
  private setupEventForwarding(): void {
    // Forward tag:changed events
    eventEmitter.on('tag:changed', (event: TagChangeEvent) => {
      this.broadcast({
        type: 'TAG_CHANGED',
        data: event
      });
    });

    // Forward tag:added events (event name is 'tag:tag_added' not 'tag:added')
    eventEmitter.on('tag:tag_added', (event: TagChangeEvent) => {
      this.broadcast({
        type: 'TAG_ADDED',
        data: event
      });
    });

    // Forward tag:removed events (event name is 'tag:tag_removed' not 'tag:removed')
    eventEmitter.on('tag:tag_removed', (event: TagChangeEvent) => {
      this.broadcast({
        type: 'TAG_REMOVED',
        data: event
      });
    });

    // Forward specific tag type events too
    eventEmitter.on('tag:tag_dispersing', (event: TagChangeEvent) => {
      this.broadcast({
        type: 'TAG_DISPERSING',
        data: event
      });
    });

    debug_event('WEBSOCKET', 'event_forwarding_initialized', {});
  }

  /**
   * Broadcast message to all connected clients
   */
  private broadcast(message: any): void {
    const data = JSON.stringify(message);
    
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });

    // Log broadcast for debugging (throttle to avoid spam)
    if (Math.random() < 0.1) { // Log ~10% of broadcasts
      debug_event('WEBSOCKET', 'broadcast', { type: message.type, clientCount: this.clients.size });
    }
  }

  /**
   * Stop WebSocket server
   */
  stop(): void {
    if (this.wss) {
      // Close all client connections
      this.clients.forEach((client) => {
        client.close();
      });
      this.clients.clear();

      // Close server
      this.wss.close();
      this.wss = null;

      debug_event('WEBSOCKET', 'server_stopped', {});
    }
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }
}

// Singleton instance
let bridge: WebSocketBridge | null = null;

/**
 * Initialize WebSocket bridge (call from interface_program startup)
 */
export function initWebSocketBridge(port?: number): WebSocketBridge {
  if (!bridge) {
    bridge = new WebSocketBridge(port);
    bridge.start();
  }
  return bridge;
}

/**
 * Get existing WebSocket bridge instance
 */
export function getWebSocketBridge(): WebSocketBridge | null {
  return bridge;
}

export default WebSocketBridge;