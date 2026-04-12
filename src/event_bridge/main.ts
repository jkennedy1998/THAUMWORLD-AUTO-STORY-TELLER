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
import { load_actor } from '../actor_storage/store.js';
import { emitBridgeMessage } from '../shared/event_bridge_client.js';
import { resolve_multiplayer_session_by_token, touch_multiplayer_session_by_token } from '../shared/multiplayer_session.js';
import { get_controlled_actor_ref_for_client_session, refresh_controlled_actor_lease_for_client_session, release_controlled_actor_ref_for_client_session } from '../shared/session_control.js';

type BridgeMessage = {
  type: string;
  data?: any;
  delivery?: {
    scope?: 'public' | 'connection';
    connection_id?: string;
  };
};

type BridgeClientMeta = {
  connection_id: string | null;
  client_session_id: string | null;
  session_token: string | null;
  slot: number | null;
  last_heartbeat_at: number | null;
  last_claimed_actor_ref: string | null;
};

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
  private wsClientMeta: Map<WebSocket, BridgeClientMeta> = new Map();

  private breathTickCount: number = 0;

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
      } else if (req.method === 'POST' && req.url === '/api/events/emit_any') {
        this.handleAnyEventPost(req, res);
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
   * Handle POST request with arbitrary event data
   */
  private handleAnyEventPost(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const msg: BridgeMessage = JSON.parse(body);

        const t = String(msg?.type ?? '');
        if (!t) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing type' }));
          return;
        }

        this.broadcastToRendererAny(t, msg?.data, msg?.delivery ?? { scope: 'public' });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          clientsNotified: this.wsClients.size
        }));

        // Avoid log spam: breath ticks are high-frequency.
        if (t === 'PLACE_BREATH_TICK') {
          this.breathTickCount++;
          if (this.breathTickCount % 60 === 0) {
            debug_event('EVENT_BRIDGE', 'breath_tick_received', { clientCount: this.wsClients.size });
          }
          return;
        }

        debug_event('EVENT_BRIDGE', 'event_received_and_broadcast_any', {
          type: t,
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

    this.wsServer.on('connection', (ws: WebSocket, req) => {
      const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const slot = Number(requestUrl.searchParams.get('slot') ?? 1);
      const session_token = String(requestUrl.searchParams.get('session_token') ?? '').trim();
      const session = touch_multiplayer_session_by_token(slot, session_token) ?? resolve_multiplayer_session_by_token(slot, session_token);
      if (!session) {
        ws.close(1008, 'invalid_session');
        return;
      }
      debug_event('EVENT_BRIDGE', 'renderer_connected', { clientCount: this.wsClients.size + 1 });
      this.wsClients.add(ws);
      this.wsClientMeta.set(ws, {
        connection_id: session.connection_id,
        client_session_id: session.client_session_id,
        session_token,
        slot,
        last_heartbeat_at: Date.now(),
        last_claimed_actor_ref: null,
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'CONNECTED',
        message: 'Event bridge connected',
        timestamp: Date.now(),
        connection_id: session.connection_id,
      }));

      ws.on('close', () => {
        const meta = this.wsClientMeta.get(ws) ?? null;
        debug_event('EVENT_BRIDGE', 'renderer_disconnected', { clientCount: this.wsClients.size - 1 });
        this.wsClients.delete(ws);
        this.wsClientMeta.delete(ws);
        if (meta) {
          void this.handleRendererDisconnect(meta, 'close');
        }
      });

      ws.on('error', (err: Error) => {
        const meta = this.wsClientMeta.get(ws) ?? null;
        debug_event('EVENT_BRIDGE', 'renderer_error', { error: err.message });
        this.wsClients.delete(ws);
        this.wsClientMeta.delete(ws);
        if (meta) {
          void this.handleRendererDisconnect(meta, 'error');
        }
      });

      ws.on('message', (raw: Buffer) => {
        this.handleRendererMessage(ws, raw.toString());
      });
    });

    this.wsServer.on('error', (err: Error) => {
      debug_event('EVENT_BRIDGE', 'websocket_server_error', { error: err.message });
    });

    debug_event('EVENT_BRIDGE', 'websocket_server_listening', { port: WS_PORT });
  }

  private handleRendererMessage(ws: WebSocket, raw: string): void {
    const meta = this.wsClientMeta.get(ws);
    if (!meta) return;
    try {
      const message = JSON.parse(raw) as BridgeMessage;
      const type = String(message?.type ?? '');
      if (type === 'SESSION_HEARTBEAT') {
        this.handleRendererHeartbeat(ws, meta, message?.data ?? {});
      }
    } catch (err) {
      debug_event('EVENT_BRIDGE', 'renderer_message_error', { error: (err as Error).message });
    }
  }

  private handleRendererHeartbeat(ws: WebSocket, meta: BridgeClientMeta, data: any): void {
    const slot = Number(meta.slot ?? 0);
    const session_token = String(meta.session_token ?? '').trim();
    if (!slot || !session_token) {
      ws.send(JSON.stringify({ type: 'SESSION_INVALIDATED', data: { reason: 'missing_session_context' } }));
      return;
    }
    const session = touch_multiplayer_session_by_token(slot, session_token);
    if (!session) {
      ws.send(JSON.stringify({ type: 'SESSION_INVALIDATED', data: { reason: 'invalid_session_token' } }));
      return;
    }
    meta.last_heartbeat_at = Date.now();
    const controlled_actor_ref = refresh_controlled_actor_lease_for_client_session(slot, session.client_session_id);
    if (!controlled_actor_ref && meta.last_claimed_actor_ref) {
      meta.last_claimed_actor_ref = null;
      ws.send(JSON.stringify({ type: 'CLAIM_INVALIDATED', data: { reason: 'claim_expired' } }));
      return;
    }
    meta.last_claimed_actor_ref = controlled_actor_ref ?? null;
    ws.send(JSON.stringify({
      type: 'SESSION_HEARTBEAT_ACK',
      data: {
        connection_id: session.connection_id,
        echo_sent_at_ms: Number(data?.sent_at_ms ?? 0) || null,
        server_time_ms: Date.now(),
        session: {
          last_seen_at: session.last_seen_at,
          lease_expires_at: session.lease_expires_at,
        },
        claim: controlled_actor_ref ? {
          controlled_actor_ref,
        } : null,
      },
    }));
  }

  private async handleRendererDisconnect(meta: BridgeClientMeta, reason: 'close' | 'error'): Promise<void> {
    try {
      const slot = Number(meta.slot ?? 0);
      const client_session_id = String(meta.client_session_id ?? '').trim();
      if (!slot || !client_session_id) return;

      const actor_ref = String(meta.last_claimed_actor_ref ?? '').trim()
        || String(get_controlled_actor_ref_for_client_session(slot, client_session_id) ?? '').trim();
      if (!actor_ref) {
        debug_event('EVENT_BRIDGE', 'renderer_disconnect_cleanup', {
          reason,
          slot,
          client_session_id,
          connection_id: meta.connection_id,
          actor_ref: null,
          released_claim: false,
          place_id: null,
        });
        return;
      }

      let place_id: string | null = null;
      const actor_id = actor_ref.startsWith('actor.') ? actor_ref.slice('actor.'.length) : '';
      if (actor_id) {
        const actor_result = load_actor(slot, actor_id);
        if (actor_result.ok) {
          const candidate = String((actor_result.actor as any)?.location?.place_id ?? '').trim();
          if (candidate) place_id = candidate;
        }
      }

      const released_claim = release_controlled_actor_ref_for_client_session(slot, client_session_id);
      if (released_claim) {
        await emitBridgeMessage('ACTOR_CLAIM_STATE_CHANGED', {
          actor_ref,
          reason: reason === 'error' ? 'disconnect_error' : 'disconnect',
          sent_at_ms: Date.now(),
        });
      }
      if (released_claim && place_id) {
        await emitBridgeMessage('PLACE_PRESENCE_CHANGED', {
          place_id,
          actor_ref,
          reason: reason === 'error' ? 'disconnect_error' : 'disconnect',
          sent_at_ms: Date.now(),
        });
      }

      debug_event('EVENT_BRIDGE', 'renderer_disconnect_cleanup', {
        reason,
        slot,
        client_session_id,
        connection_id: meta.connection_id,
        actor_ref,
        released_claim,
        place_id,
      });
    } catch (err) {
      debug_event('EVENT_BRIDGE', 'renderer_disconnect_cleanup_error', {
        reason,
        connection_id: meta.connection_id,
        client_session_id: meta.client_session_id,
        error: (err as Error).message,
      });
    }
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

  private sendToConnection(connection_id: string, type: string, data: any): number {
    const target_connection_id = String(connection_id ?? '').trim();
    if (!target_connection_id) return 0;
    const message = JSON.stringify({ type, data });
    let sentCount = 0;
    for (const client of this.wsClients) {
      const meta = this.wsClientMeta.get(client);
      if (client.readyState === WebSocket.OPEN && meta?.connection_id === target_connection_id) {
        client.send(message);
        sentCount++;
      }
    }
    return sentCount;
  }

  private broadcastToRendererAny(type: string, data: any, delivery?: { scope?: 'public' | 'connection'; connection_id?: string }): void {
    const scope = String(delivery?.scope ?? 'public').trim().toLowerCase();
    if (scope === 'connection') {
      const sentCount = this.sendToConnection(String(delivery?.connection_id ?? ''), type, data);
      if (sentCount > 0 && type !== 'PLACE_BREATH_TICK') {
        debug_event('EVENT_BRIDGE', 'targeted_broadcast_sent', {
          type,
          recipientCount: sentCount,
          scope,
        });
      }
      return;
    }
    const message = JSON.stringify({ type, data });

    let sentCount = 0;
    this.wsClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        sentCount++;
      }
    });

    // Avoid log spam for breath ticks.
    if (sentCount > 0 && type !== 'PLACE_BREATH_TICK') {
      debug_event('EVENT_BRIDGE', 'broadcast_sent', {
        type,
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
