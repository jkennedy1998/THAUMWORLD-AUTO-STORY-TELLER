/**
 * Event Bridge Service
 * 
 * Centralized event routing service that receives events from all backend
 * processes via HTTP and broadcasts them to the renderer via WebSocket.
 * 
 * This solves the fundamental issue where each backend process has its own
 * isolated EventEmitter and events don't cross process boundaries.
 */

import * as http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { debug_event } from '../shared/debug_event.js';
import type { TagChangeEvent } from '../shared/event_emitter.js';

const HTTP_PORT = 8788;
const WS_PORT = 8789;

/**
 * Event Bridge Server
 * Combines HTTP endpoint for receiving events and WebSocket for broadcasting
 */
export class EventBridge {
  private httpServer: http.Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private wsClients: Set<WebSocket> = new Set();

  /**
   * Start both HTTP and WebSocket servers
   */
  start(): void {
    this.startHTTPServer();
    this.startWebSocketServer();
    debug_event('EVENT_BRIDGE', 'started', { httpPort: HTTP_PORT, wsPort: WS_PORT });
  }

  /**
   * Start HTTP server to receive events from backend processes
   */
  private startHTTPServer(): void {
    this.httpServer = http.createServer((req, res) => {
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method === 'POST' && req.url === '/api/events/emit') {
        this.handleEventPost(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.httpServer.listen(HTTP_PORT, () => {
      debug_event('EVENT_BRIDGE', 'http_server_listening', { port: HTTP_PORT });
    });

    this.httpServer.on('error', (err) => {
      debug_event('EVENT_BRIDGE', 'http_server_error', { error: err.message });
    });
  }

  /**
   * Handle POST request with event data
   */
  private handleEventPost(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const event: TagChangeEvent = JSON.parse(body);
        
        // Validate event
        if (!event.type || !event.entityRef || !event.tagName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid event format' }));
          return;
        }

        // Broadcast to all WebSocket clients
        this.broadcastToRenderer(event);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          clientsNotified: this.wsClients.size 
        }));

        debug_event('EVENT_BRIDGE', 'event_received_and_broadcast', {
          type: event.type,
          entityRef: event.entityRef,
          tagName: event.tagName,
          clientCount: this.wsClients.size
        });

      } catch (err) {
        debug_event('EVENT_BRIDGE', 'event_parse_error', { error: (err as Error).message });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  /**
   * Start WebSocket server for renderer connections
   */
  private startWebSocketServer(): void {
    this.wsServer = new WebSocketServer({ port: WS_PORT });

    this.wsServer.on('connection', (ws: WebSocket) => {
      debug_event('EVENT_BRIDGE', 'renderer_connected', { clientCount: this.wsClients.size + 1 });
      this.wsClients.add(ws);

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'CONNECTED',
        message: 'Event bridge connected',
        timestamp: Date.now()
      }));

      ws.on('close', () => {
        debug_event('EVENT_BRIDGE', 'renderer_disconnected', { clientCount: this.wsClients.size - 1 });
        this.wsClients.delete(ws);
      });

      ws.on('error', (err: Error) => {
        debug_event('EVENT_BRIDGE', 'renderer_error', { error: err.message });
        this.wsClients.delete(ws);
      });
    });

    this.wsServer.on('error', (err: Error) => {
      debug_event('EVENT_BRIDGE', 'websocket_server_error', { error: err.message });
    });

    debug_event('EVENT_BRIDGE', 'websocket_server_listening', { port: WS_PORT });
  }

  /**
   * Broadcast event to all connected renderer clients
   */
  private broadcastToRenderer(event: TagChangeEvent): void {
    const message = JSON.stringify({
      type: event.type,
      data: event
    });

    let sentCount = 0;
    this.wsClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        sentCount++;
      }
    });

    if (sentCount > 0) {
      debug_event('EVENT_BRIDGE', 'broadcast_sent', {
        type: event.type,
        recipientCount: sentCount
      });
    }
  }

  /**
   * Stop both servers
   */
  stop(): void {
    // Close all WebSocket clients
    this.wsClients.forEach((client) => {
      client.close();
    });
    this.wsClients.clear();

    // Close WebSocket server
    if (this.wsServer) {
      this.wsServer.close();
      this.wsServer = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }

    debug_event('EVENT_BRIDGE', 'stopped', {});
  }

  /**
   * Get number of connected renderer clients
   */
  getClientCount(): number {
    return this.wsClients.size;
  }
}

// Singleton instance
let bridge: EventBridge | null = null;

/**
 * Initialize and start the event bridge
 */
export function initEventBridge(): EventBridge {
  if (!bridge) {
    bridge = new EventBridge();
    bridge.start();
  }
  return bridge;
}

/**
 * Get existing event bridge instance
 */
export function getEventBridge(): EventBridge | null {
  return bridge;
}

// Start the event bridge service
// This file should only be run as a standalone service, not imported
initEventBridge();
console.log('Event Bridge service started');
console.log(`HTTP endpoint: http://localhost:${HTTP_PORT}/api/events/emit`);
console.log(`WebSocket: ws://localhost:${WS_PORT}`);

export default EventBridge;