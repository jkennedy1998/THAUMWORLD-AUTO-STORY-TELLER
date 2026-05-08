import * as http from 'node:http';
import { Buffer } from 'node:buffer';
import { WebSocketServer, WebSocket } from 'ws';
import { RemoteRelayStore, type RelayRoomRecord } from './store.js';
import { REMOTE_RELAY_CORS_RESPONSE_HEADERS, handle_remote_relay_cors_preflight } from './http_cors.js';
import type {
  RemoteRelayHostCloseRequest,
  RemoteRelayHostRefreshRequest,
  RemoteRelayHostSocketMessage,
  RemoteRelayHostRegisterRequest,
  RemoteRelayResolveJoinCodeRequest,
} from '../shared/remote_relay_protocol.js';

const DEFAULT_HTTP_PORT = Number(process.env.THAUM_REMOTE_RELAY_PORT ?? 8795) || 8795;
const DEFAULT_WS_PORT = Number(process.env.THAUM_REMOTE_RELAY_WS_PORT ?? DEFAULT_HTTP_PORT) || DEFAULT_HTTP_PORT;
const HTTP_PROXY_TIMEOUT_MS = 15_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const REGISTER_RATE_LIMIT_MAX = 20;
const RESOLVE_RATE_LIMIT_MAX = 120;
const REFRESH_RATE_LIMIT_MAX = 240;
const CLOSE_RATE_LIMIT_MAX = 40;

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...REMOTE_RELAY_CORS_RESPONSE_HEADERS });
  res.end(JSON.stringify(payload));
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function readBodyBuffer(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function log(event: string, payload: Record<string, unknown>): void {
  console.log('[REMOTE_RELAY]', JSON.stringify({ event, method: 'remote_relay', ...payload }));
}

type HostConnection = {
  room: RelayRoomRecord;
  socket: WebSocket;
  pending_http: Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
};

type ClientConnection = {
  client_id: string;
  room_id: string;
  attach_token: string;
  socket: WebSocket;
};

export class RemoteRelayServer {
  private readonly store = new RemoteRelayStore();
  private httpServer: http.Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private readonly hostsByRoomId = new Map<string, HostConnection>();
  private readonly clientsById = new Map<string, ClientConnection>();
  private readonly rateLimitBuckets = new Map<string, number[]>();

  start(): void {
    this.httpServer = http.createServer((req, res) => { void this.handleHttp(req, res); });
    this.httpServer.listen(DEFAULT_HTTP_PORT, () => log('http_listening', { port: DEFAULT_HTTP_PORT }));
    this.wsServer = new WebSocketServer({ port: DEFAULT_WS_PORT });
    this.wsServer.on('connection', (socket, req) => this.handleWsConnection(socket, req));
    log('ws_listening', { port: DEFAULT_WS_PORT });
  }

  private getRequestId(req: http.IncomingMessage): string {
    return String(req.headers['x-remote-request-id'] ?? req.headers['x-request-id'] ?? '').trim() || `relay_req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private getRemoteAddress(req: http.IncomingMessage): string {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    }
    return req.socket.remoteAddress || 'unknown';
  }

  private isRateLimited(req: http.IncomingMessage, scope: string, max: number): boolean {
    const key = `${scope}:${this.getRemoteAddress(req)}`;
    const now = Date.now();
    const existing = this.rateLimitBuckets.get(key) ?? [];
    const recent = existing.filter((timestamp) => (timestamp + RATE_LIMIT_WINDOW_MS) > now);
    if (recent.length >= max) {
      this.rateLimitBuckets.set(key, recent);
      return true;
    }
    recent.push(now);
    this.rateLimitBuckets.set(key, recent);
    return false;
  }

  private closeRoomConnections(room_id: string, reason: string): void {
    const host = this.hostsByRoomId.get(room_id);
    if (host?.socket.readyState === WebSocket.OPEN) {
      try { host.socket.close(1000, reason); } catch {}
    }
    for (const [client_id, client] of this.clientsById.entries()) {
      if (client.room_id !== room_id) continue;
      try { client.socket.close(1000, reason); } catch {}
      this.clientsById.delete(client_id);
    }
  }

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (handle_remote_relay_cors_preflight(req, res)) {
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/api/remote_relay/health') {
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/remote_relay/host/register') {
      const request_id = this.getRequestId(req);
      if (this.isRateLimited(req, 'host_register', REGISTER_RATE_LIMIT_MAX)) {
        log('host_register_rate_limited', { request_id, remote_address: this.getRemoteAddress(req) });
        json(res, 429, { ok: false, error: 'rate_limited' });
        return;
      }
      const body = await parseJsonBody(req).catch(() => null) as RemoteRelayHostRegisterRequest | null;
      if (!body || !body.slot) {
        json(res, 400, { ok: false, error: 'invalid_request' });
        return;
      }
      const registration = this.store.registerHost({
        slot: body.slot,
        app_kind: body.app_kind ?? 'unknown',
        visibility: body.visibility ?? 'private',
        world_label: body.world_label ?? null,
        host_display_name: body.painter_display_name ?? null,
        painter_document_id: body.painter_document_id ?? null,
      });
      const origin = this.publicHttpOrigin(req);
      const wsOrigin = this.publicWsOrigin(req);
      log('host_registered', { request_id, room_id: registration.room.room_id, join_code: registration.room.join_code ?? null, slot: body.slot, app_kind: body.app_kind ?? 'unknown', remote_address: this.getRemoteAddress(req) });
      json(res, 200, { ok: true, room: registration.room, host_token: registration.host_token, relay_https_origin: origin, relay_wss_origin: wsOrigin, lease_expires_at_ms: registration.lease_expires_at_ms });
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/remote_relay/host/refresh') {
      const request_id = this.getRequestId(req);
      if (this.isRateLimited(req, 'host_refresh', REFRESH_RATE_LIMIT_MAX)) {
        log('host_refresh_rate_limited', { request_id, remote_address: this.getRemoteAddress(req) });
        json(res, 429, { ok: false, error: 'rate_limited' });
        return;
      }
      const body = await parseJsonBody(req).catch(() => null) as RemoteRelayHostRefreshRequest | null;
      const refreshed = this.store.refreshHost(String(body?.host_token ?? '').trim());
      if (!refreshed) {
        log('host_refresh_not_found', { request_id, remote_address: this.getRemoteAddress(req) });
        json(res, 404, { ok: false, error: 'host_not_found' });
        return;
      }
      log('host_refreshed', { request_id, room_id: refreshed.room.room_id, lease_expires_at_ms: refreshed.lease_expires_at_ms, remote_address: this.getRemoteAddress(req) });
      json(res, 200, {
        ok: true,
        room: refreshed.room,
        relay_https_origin: this.publicHttpOrigin(req),
        relay_wss_origin: this.publicWsOrigin(req),
        lease_expires_at_ms: refreshed.lease_expires_at_ms,
      });
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/remote_relay/host/close') {
      const request_id = this.getRequestId(req);
      if (this.isRateLimited(req, 'host_close', CLOSE_RATE_LIMIT_MAX)) {
        log('host_close_rate_limited', { request_id, remote_address: this.getRemoteAddress(req) });
        json(res, 429, { ok: false, error: 'rate_limited' });
        return;
      }
      const body = await parseJsonBody(req).catch(() => null) as RemoteRelayHostCloseRequest | null;
      const closed = this.store.closeHost(String(body?.host_token ?? '').trim());
      if (!closed) {
        log('host_close_not_found', { request_id, remote_address: this.getRemoteAddress(req) });
        json(res, 404, { ok: false, error: 'host_not_found' });
        return;
      }
      this.closeRoomConnections(closed.room_id, 'host_closed');
      log('host_closed', { request_id, room_id: closed.room_id, remote_address: this.getRemoteAddress(req) });
      json(res, 200, { ok: true, room_id: closed.room_id });
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/remote_relay/join/resolve') {
      const request_id = this.getRequestId(req);
      if (this.isRateLimited(req, 'join_resolve', RESOLVE_RATE_LIMIT_MAX)) {
        log('join_resolve_rate_limited', { request_id, remote_address: this.getRemoteAddress(req) });
        json(res, 429, { ok: false, error: 'rate_limited' });
        return;
      }
      const body = await parseJsonBody(req).catch(() => null) as RemoteRelayResolveJoinCodeRequest | null;
      const join_code = String(body?.join_code ?? '').trim();
      if (!join_code) {
        log('join_resolve_invalid_request', { request_id, remote_address: this.getRemoteAddress(req) });
        json(res, 400, { ok: false, error: 'join_code_required' });
        return;
      }
      const resolved = this.store.resolveJoinCode(join_code);
      if (!resolved) {
        log('join_resolve_not_found', { request_id, join_code, remote_address: this.getRemoteAddress(req) });
        json(res, 404, { ok: false, error: 'join_code_not_found' });
        return;
      }
      log('join_resolved', { request_id, room_id: resolved.room.room_id, join_code, host_online: resolved.host_online, app_kind: resolved.room.app_kind, remote_address: this.getRemoteAddress(req) });
      json(res, 200, {
        ok: true,
        room: resolved.room,
        attach_token: resolved.attach_token,
        host_online: resolved.host_online,
        relay_https_origin: this.publicHttpOrigin(req),
        relay_wss_origin: this.publicWsOrigin(req),
      });
      return;
    }
    const relayMatch = requestUrl.pathname.match(/^\/api\/relay\/room\/([^/]+)\/attach\/([^/]+)(\/.*)?$/);
    if (relayMatch) {
      const room_id = String(relayMatch[1] ?? '').trim();
      const attach_token = String(relayMatch[2] ?? '').trim();
      const suffix = String(relayMatch[3] ?? '');
      await this.handleRelayProxyHttp(req, res, room_id, attach_token, `${suffix}${requestUrl.search || ''}`);
      return;
    }
    json(res, 404, { ok: false, error: 'not_found' });
  }

  private publicHttpOrigin(req: http.IncomingMessage): string {
    const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').trim();
    const proto = forwardedProto || 'http';
    return `${proto}://${req.headers.host ?? `localhost:${DEFAULT_HTTP_PORT}`}`.replace(/\/+$/, '');
  }

  private publicWsOrigin(req: http.IncomingMessage): string {
    return this.publicHttpOrigin(req).replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  }

  private async handleRelayProxyHttp(req: http.IncomingMessage, res: http.ServerResponse, room_id: string, attach_token: string, proxiedPath: string): Promise<void> {
    const relay_request_id = this.getRequestId(req);
    const room = this.store.useAttachTokenForHttp(room_id, attach_token);
    if (!room) {
      log('proxy_http_rejected', { request_id: relay_request_id, room_id, remote_address: this.getRemoteAddress(req), reason: 'invalid_attach_token' });
      json(res, 401, { ok: false, error: 'invalid_attach_token' });
      return;
    }
    const host = this.hostsByRoomId.get(room.room_id);
    if (!host || host.socket.readyState !== WebSocket.OPEN) {
      log('proxy_http_host_offline', { request_id: relay_request_id, room_id: room.room_id, remote_address: this.getRemoteAddress(req) });
      json(res, 503, { ok: false, error: 'host_offline' });
      return;
    }
    const request_id = `http_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const body = await readBodyBuffer(req);
    log('proxy_http_started', { request_id, relay_request_id, room_id: room.room_id, path: proxiedPath || '/', remote_address: this.getRemoteAddress(req) });
    const response = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        host.pending_http.delete(request_id);
        reject(new Error('proxy_timeout'));
      }, HTTP_PROXY_TIMEOUT_MS);
      host.pending_http.set(request_id, { resolve, reject, timer });
      host.socket.send(JSON.stringify({
        type: 'proxy_http_request',
        request_id,
        method: String(req.method ?? 'GET').toUpperCase(),
        path: proxiedPath || '/',
        headers: Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value ?? '')])),
        body_base64: body.length > 0 ? body.toString('base64') : undefined,
      } satisfies RemoteRelayHostSocketMessage));
    }).catch((error) => ({ status: 502, error: error instanceof Error ? error.message : String(error) }));
    if (response.error) {
      log('proxy_http_failed', { request_id, relay_request_id, room_id: room.room_id, path: proxiedPath || '/', error: response.error, status: response.status || 502, remote_address: this.getRemoteAddress(req) });
      json(res, response.status || 502, { ok: false, error: response.error });
      return;
    }
    const headers = typeof response.headers === 'object' && response.headers ? response.headers : {};
    const payloadBuffer = response.body_base64 ? Buffer.from(String(response.body_base64), 'base64') : Buffer.alloc(0);
    log('proxy_http_completed', { request_id, relay_request_id, room_id: room.room_id, path: proxiedPath || '/', status: Number(response.status) || 200, remote_address: this.getRemoteAddress(req) });
    res.writeHead(Number(response.status) || 200, headers);
    res.end(payloadBuffer);
  }

  private handleWsConnection(socket: WebSocket, req: http.IncomingMessage): void {
    const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (requestUrl.pathname === '/relay/host') {
      this.handleHostWs(socket, requestUrl);
      return;
    }
    const clientMatch = requestUrl.pathname.match(/^\/relay\/room\/([^/]+)\/attach\/([^/]+)$/);
    if (clientMatch) {
      const room_id = String(clientMatch[1] ?? '').trim();
      const attach_token = String(clientMatch[2] ?? '').trim();
      this.handleClientWs(socket, requestUrl, room_id, attach_token);
      return;
    }
    socket.close(1008, 'invalid_path');
  }

  private handleHostWs(socket: WebSocket, requestUrl: URL): void {
    const host_token = String(requestUrl.searchParams.get('host_token') ?? '').trim();
    const room_id = String(requestUrl.searchParams.get('room_id') ?? '').trim();
    const room = this.store.getRoomByHostToken(host_token);
    if (!room || room.room_id !== room_id) {
      socket.close(1008, 'invalid_host_token');
      return;
    }
    const existing = this.hostsByRoomId.get(room.room_id);
    if (existing && existing.socket.readyState === WebSocket.OPEN) {
      try { existing.socket.close(1000, 'replaced_by_new_host_connection'); } catch {}
    }
    const host: HostConnection = { room, socket, pending_http: new Map() };
    this.hostsByRoomId.set(room.room_id, host);
    this.store.markHostOnline(room.room_id, true);
    log('host_connected', { room_id: room.room_id, join_code: room.join_code, slot: room.slot, app_kind: room.app_kind });
    socket.on('message', (payload) => this.handleHostMessage(host, payload));
    socket.on('close', () => {
      this.hostsByRoomId.delete(room.room_id);
      this.store.markHostOnline(room.room_id, false);
      for (const pending of host.pending_http.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('host_disconnected'));
      }
      host.pending_http.clear();
      log('host_disconnected', { room_id: room.room_id, slot: room.slot, app_kind: room.app_kind });
    });
  }

  private handleHostMessage(host: HostConnection, payload: WebSocket.RawData): void {
    const message = JSON.parse(String(payload ?? '{}')) as RemoteRelayHostSocketMessage;
    if (message.type === 'proxy_http_response') {
      const pending = host.pending_http.get(message.request_id);
      if (!pending) return;
      clearTimeout(pending.timer);
      host.pending_http.delete(message.request_id);
      pending.resolve(message);
      return;
    }
    if (message.type === 'proxy_bridge_server_message') {
      const client = this.clientsById.get(message.client_id);
      if (!client || client.socket.readyState !== WebSocket.OPEN) return;
      client.socket.send(message.payload_text);
      return;
    }
    if (message.type === 'proxy_bridge_close') {
      const client = this.clientsById.get(message.client_id);
      if (!client) return;
      client.socket.close(message.code ?? 1000, message.reason ?? 'bridge_closed');
      this.clientsById.delete(message.client_id);
      return;
    }
    if (message.type === 'ping') {
      host.socket.send(JSON.stringify({ type: 'pong', sent_at_ms: message.sent_at_ms ?? Date.now() } satisfies RemoteRelayHostSocketMessage));
    }
  }

  private handleClientWs(socket: WebSocket, requestUrl: URL, room_id: string, attach_token: string): void {
    const room = this.store.useAttachTokenForBridgeWs(room_id, attach_token);
    if (!room) {
      socket.close(1008, 'invalid_or_consumed_attach_token');
      return;
    }
    const host = this.hostsByRoomId.get(room.room_id);
    if (!host || host.socket.readyState !== WebSocket.OPEN) {
      socket.close(1013, 'host_offline');
      return;
    }
    const slot = Math.max(1, Math.floor(Number(requestUrl.searchParams.get('slot') ?? room.slot) || room.slot));
    const session_token = String(requestUrl.searchParams.get('session_token') ?? '').trim();
    if (!session_token) {
      socket.close(1008, 'missing_session_token');
      return;
    }
    const client_id = `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const client: ClientConnection = { client_id, room_id: room.room_id, attach_token, socket };
    this.clientsById.set(client_id, client);
    log('client_connected', { room_id: room.room_id, client_id, slot, app_kind: room.app_kind });
    host.socket.send(JSON.stringify({ type: 'proxy_bridge_open', client_id, slot, session_token } satisfies RemoteRelayHostSocketMessage));
    socket.on('message', (payload) => {
      if (host.socket.readyState !== WebSocket.OPEN) return;
      host.socket.send(JSON.stringify({ type: 'proxy_bridge_client_message', client_id, payload_text: String(payload ?? '') } satisfies RemoteRelayHostSocketMessage));
    });
    socket.on('close', (code, reason) => {
      this.clientsById.delete(client_id);
      log('client_disconnected', { room_id: room.room_id, client_id, slot, app_kind: room.app_kind, code, reason: String(reason ?? '') || null });
      if (host.socket.readyState === WebSocket.OPEN) {
        host.socket.send(JSON.stringify({ type: 'proxy_bridge_close', client_id, code, reason: String(reason ?? '') } satisfies RemoteRelayHostSocketMessage));
      }
    });
  }
}

const isDirectRun = String(process.argv[1] ?? '').includes('remote_relay_service');
if (isDirectRun) {
  new RemoteRelayServer().start();
}
