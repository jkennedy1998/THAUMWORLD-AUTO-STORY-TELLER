import { WebSocket } from 'ws';
import { build_multiplayer_transport_config } from '../shared/multiplayer_transport.js';
import { close_remote_relay_host, refresh_remote_relay_host, register_remote_relay_host } from '../shared/remote_control_client.js';
import type { RemoteRelayHostSocketMessage, RemoteRelayHostRegisterResponse } from '../shared/remote_relay_protocol.js';

export type RemoteHostRelayRuntimeState = {
  active: boolean;
  relay_origin: string | null;
  relay_wss_origin: string | null;
  room_id: string | null;
  join_code: string | null;
  host_token: string | null;
  host_connected: boolean;
  lease_expires_at_ms: number | null;
  last_error: string | null;
};

function log(event: string, payload: Record<string, unknown>): void {
  console.log('[REMOTE_HOST_RELAY]', JSON.stringify({ event, method: 'remote_relay', ...payload }));
}

function toBufferBase64(raw: string | undefined): Buffer {
  return Buffer.from(String(raw ?? ''), 'base64');
}

function headerRecord(headers: Headers): Record<string, string> {
  const next: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key.toLowerCase() === 'content-encoding' || key.toLowerCase() === 'transfer-encoding' || key.toLowerCase() === 'content-length' || key.toLowerCase() === 'connection') return;
    next[key] = value;
  });
  return next;
}

export class RemoteHostRelayRuntime {
  private state: RemoteHostRelayRuntimeState = {
    active: false,
    relay_origin: null,
    relay_wss_origin: null,
    room_id: null,
    join_code: null,
    host_token: null,
    host_connected: false,
    lease_expires_at_ms: null,
    last_error: null,
  };
  private socket: WebSocket | null = null;
  private reconnect_timer: ReturnType<typeof setTimeout> | null = null;
  private refresh_timer: ReturnType<typeof setInterval> | null = null;
  private readonly bridgeSockets = new Map<string, WebSocket>();

  constructor(private readonly options: {
    slot: number;
    local_api_base_url: string;
    local_bridge_ws_base_url: string;
    relay_origin: string;
    app_kind: 'thaumworld' | 'ascii_painter' | 'unknown';
    world_label?: string | null;
    painter_document_id?: string | null;
    painter_display_name?: string | null;
  }) {}

  getState(): RemoteHostRelayRuntimeState {
    return { ...this.state };
  }

  async start(): Promise<void> {
    if (this.state.active) return;
    this.state.active = true;
    try {
      const registration = await register_remote_relay_host(this.options.relay_origin, {
        slot: this.options.slot,
        app_kind: this.options.app_kind,
        visibility: 'private',
        world_label: this.options.world_label ?? null,
        painter_document_id: this.options.painter_document_id ?? null,
        painter_display_name: this.options.painter_display_name ?? null,
      });
      this.applyRegistration(registration);
      this.connectHostSocket();
    } catch (error) {
      this.state.last_error = error instanceof Error ? error.message : String(error);
      log('start_failed', { slot: this.options.slot, app_kind: this.options.app_kind, relay_origin: this.options.relay_origin, message: this.state.last_error });
      this.scheduleReconnect();
    }
  }

  stop(): void {
    this.state.active = false;
    if (this.reconnect_timer) {
      clearTimeout(this.reconnect_timer);
      this.reconnect_timer = null;
    }
    if (this.refresh_timer) {
      clearInterval(this.refresh_timer);
      this.refresh_timer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    for (const socket of this.bridgeSockets.values()) {
      try { socket.close(); } catch {}
    }
    this.bridgeSockets.clear();
    this.state.host_connected = false;
    const relay_origin = String(this.state.relay_origin ?? '').trim();
    const host_token = String(this.state.host_token ?? '').trim();
    this.state.room_id = null;
    this.state.join_code = null;
    this.state.host_token = null;
    this.state.lease_expires_at_ms = null;
    if (relay_origin && host_token) {
      void close_remote_relay_host(relay_origin, { host_token }).catch((error) => {
        log('close_failed', { slot: this.options.slot, app_kind: this.options.app_kind, relay_origin, message: error instanceof Error ? error.message : String(error) });
      });
    }
  }

  private applyRegistration(registration: RemoteRelayHostRegisterResponse): void {
    if (!registration.ok || !registration.room?.room_id || !registration.host_token || !registration.relay_https_origin) {
      throw new Error(String(registration.error ?? 'host_registration_failed'));
    }
    this.state.relay_origin = registration.relay_https_origin;
    this.state.relay_wss_origin = registration.relay_wss_origin ?? registration.relay_https_origin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    this.state.room_id = registration.room.room_id;
    this.state.join_code = registration.room.join_code ?? null;
    this.state.host_token = registration.host_token;
    this.state.lease_expires_at_ms = registration.lease_expires_at_ms ?? null;
    this.state.last_error = null;
    log('registered', { slot: this.options.slot, app_kind: this.options.app_kind, room_id: this.state.room_id, join_code: this.state.join_code, relay_origin: this.state.relay_origin, lease_expires_at_ms: this.state.lease_expires_at_ms });
  }

  private buildHostSocketUrl(): string {
    const base = String(this.state.relay_wss_origin ?? '').trim();
    const room_id = String(this.state.room_id ?? '').trim();
    const host_token = String(this.state.host_token ?? '').trim();
    return `${base}/relay/host?room_id=${encodeURIComponent(room_id)}&host_token=${encodeURIComponent(host_token)}`;
  }

  private ensureRefreshLoop(): void {
    if (this.refresh_timer) return;
    this.refresh_timer = setInterval(() => {
      void this.refreshLease();
    }, 30_000);
  }

  private async refreshLease(): Promise<void> {
    if (!this.state.active || !this.state.relay_origin || !this.state.host_token) return;
    try {
      const response = await refresh_remote_relay_host(this.state.relay_origin, { host_token: this.state.host_token });
      if (!response.ok) {
        throw new Error(String(response.error ?? 'refresh_failed'));
      }
      this.state.lease_expires_at_ms = response.lease_expires_at_ms ?? this.state.lease_expires_at_ms;
      this.state.last_error = null;
      log('lease_refreshed', { slot: this.options.slot, app_kind: this.options.app_kind, room_id: this.state.room_id, lease_expires_at_ms: this.state.lease_expires_at_ms });
    } catch (error) {
      this.state.last_error = error instanceof Error ? error.message : String(error);
      log('lease_refresh_failed', { slot: this.options.slot, app_kind: this.options.app_kind, room_id: this.state.room_id, message: this.state.last_error });
      if (this.state.last_error === 'host_not_found') {
        this.state.room_id = null;
        this.state.join_code = null;
        this.state.host_token = null;
        this.state.lease_expires_at_ms = null;
        this.scheduleReconnect();
      }
    }
  }

  private connectHostSocket(): void {
    if (!this.state.active || !this.state.room_id || !this.state.host_token) return;
    const url = this.buildHostSocketUrl();
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      this.state.host_connected = true;
      this.state.last_error = null;
      this.ensureRefreshLoop();
      log('host_socket_connected', { slot: this.options.slot, app_kind: this.options.app_kind, room_id: this.state.room_id, join_code: this.state.join_code, lease_expires_at_ms: this.state.lease_expires_at_ms });
    };
    socket.onmessage = (event) => {
      try {
        this.handleHostMessage(JSON.parse(String(event.data ?? '{}')) as RemoteRelayHostSocketMessage);
      } catch (error) {
        log('host_socket_message_parse_failed', { slot: this.options.slot, app_kind: this.options.app_kind, room_id: this.state.room_id, message: error instanceof Error ? error.message : String(error) });
      }
    };
    socket.onerror = (error) => {
      this.state.last_error = error instanceof Error ? error.message : 'socket_error';
    };
    socket.onclose = () => {
      this.state.host_connected = false;
      log('host_socket_closed', { slot: this.options.slot, app_kind: this.options.app_kind, room_id: this.state.room_id });
      if (this.socket === socket) this.socket = null;
      if (this.state.active) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnect_timer || !this.state.active) return;
    this.reconnect_timer = setTimeout(async () => {
      this.reconnect_timer = null;
      if (!this.state.room_id || !this.state.host_token) {
        try {
          const registration = await register_remote_relay_host(this.options.relay_origin, {
            slot: this.options.slot,
            app_kind: this.options.app_kind,
            visibility: 'private',
            world_label: this.options.world_label ?? null,
            painter_document_id: this.options.painter_document_id ?? null,
            painter_display_name: this.options.painter_display_name ?? null,
          });
          this.applyRegistration(registration);
        } catch (error) {
          this.state.last_error = error instanceof Error ? error.message : String(error);
        }
      }
      this.connectHostSocket();
    }, 1500);
  }

  private send(message: RemoteRelayHostSocketMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private async handleHttpProxyRequest(message: Extract<RemoteRelayHostSocketMessage, { type: 'proxy_http_request' }>): Promise<void> {
    try {
      const target = `${this.options.local_api_base_url.replace(/\/+$/, '')}${String(message.path ?? '').startsWith('/') ? message.path : `/${String(message.path ?? '')}`}`;
      const response = await fetch(target, {
        method: message.method,
        headers: message.headers,
        body: message.body_base64 ? new Uint8Array(toBufferBase64(message.body_base64)) : undefined,
      });
      const body = Buffer.from(await response.arrayBuffer());
      this.send({
        type: 'proxy_http_response',
        request_id: message.request_id,
        status: response.status,
        headers: headerRecord(response.headers),
        body_base64: body.length > 0 ? body.toString('base64') : undefined,
      });
    } catch (error) {
      this.send({
        type: 'proxy_http_response',
        request_id: message.request_id,
        status: 502,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private openBridgeProxy(client_id: string, slot: number, session_token: string): void {
    if (this.bridgeSockets.has(client_id)) return;
    const url = `${this.options.local_bridge_ws_base_url}?slot=${encodeURIComponent(String(slot))}&session_token=${encodeURIComponent(session_token)}`;
    const socket = new WebSocket(url);
    this.bridgeSockets.set(client_id, socket);
    log('bridge_proxy_open_started', { slot: this.options.slot, app_kind: this.options.app_kind, room_id: this.state.room_id, client_id });
    socket.onmessage = (event) => {
      this.send({ type: 'proxy_bridge_server_message', client_id, payload_text: String(event.data ?? '') });
    };
    socket.onclose = (event) => {
      this.bridgeSockets.delete(client_id);
      log('bridge_proxy_closed', { slot: this.options.slot, app_kind: this.options.app_kind, room_id: this.state.room_id, client_id, code: event.code, reason: String(event.reason ?? '') || null });
      this.send({ type: 'proxy_bridge_close', client_id, code: event.code, reason: String(event.reason ?? '') });
    };
    socket.onerror = () => {
      log('bridge_proxy_error', { slot: this.options.slot, app_kind: this.options.app_kind, room_id: this.state.room_id, client_id });
      this.send({ type: 'proxy_bridge_close', client_id, code: 1011, reason: 'local_bridge_error' });
      try { socket.close(); } catch {}
    };
  }

  private handleHostMessage(message: RemoteRelayHostSocketMessage): void {
    if (message.type === 'proxy_http_request') {
      void this.handleHttpProxyRequest(message);
      return;
    }
    if (message.type === 'proxy_bridge_open') {
      this.openBridgeProxy(message.client_id, message.slot, message.session_token);
      return;
    }
    if (message.type === 'proxy_bridge_client_message') {
      const socket = this.bridgeSockets.get(message.client_id);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(message.payload_text);
      }
      return;
    }
    if (message.type === 'proxy_bridge_close') {
      const socket = this.bridgeSockets.get(message.client_id);
      this.bridgeSockets.delete(message.client_id);
      if (socket) {
        try { socket.close(message.code ?? 1000, message.reason ?? 'closed'); } catch {}
      }
      return;
    }
    if (message.type === 'ping') {
      this.send({ type: 'pong', sent_at_ms: message.sent_at_ms ?? Date.now() });
    }
  }
}

export function build_default_remote_host_runtime(slot: number, relay_origin: string): RemoteHostRelayRuntime {
  const transport = build_multiplayer_transport_config({ host: 'localhost' });
  return new RemoteHostRelayRuntime({
    slot,
    relay_origin,
    local_api_base_url: transport.api_base_url,
    local_bridge_ws_base_url: transport.bridge_ws_base_url,
    app_kind: 'thaumworld',
  });
}
