import { initWebSocketClient, type WebSocketClient } from '../mono_ui/websocket_client.js';
import { debug_warn } from '../shared/debug.js';
import type { PainterDocumentBootstrap, PainterSessionLifecycle } from '../shared/painter_protocol.js';
import { fetch_local_host_status } from './world_discovery.js';

export type PainterMultiplayerSessionState = PainterDocumentBootstrap & {
  lifecycle: PainterSessionLifecycle;
};

type PainterMultiplayerSessionOptions = {
  slot: number;
  api_base_url: string;
  websocket_port: number;
  reconnect_token_storage_key: string;
};

type SessionSubscriber = (state: PainterMultiplayerSessionState) => void;

function create_initial_state(slot: number): PainterMultiplayerSessionState {
  return {
    lifecycle: 'idle',
    document_id: `slot:${slot}:default_canvas`,
    authority_mode: 'local_compat',
    slot,
    revision: 0,
    snapshot: null,
    session_token: null,
    connection_id: null,
    reconnect_token: null,
    host_boot_id: null,
    join_mode: null,
    supports_join: false,
    error: null,
  };
}

export function create_painter_multiplayer_session(options: PainterMultiplayerSessionOptions): {
  get_state: () => PainterMultiplayerSessionState;
  subscribe: (listener: SessionSubscriber) => () => void;
  ensure_ready: (force?: boolean) => Promise<PainterMultiplayerSessionState>;
  get_ws_client: () => WebSocketClient | null;
} {
  let state = create_initial_state(options.slot);
  let bootstrap_promise: Promise<PainterMultiplayerSessionState> | null = null;
  let ws_client: WebSocketClient | null = null;
  const listeners = new Set<SessionSubscriber>();

  function emit(): void {
    for (const listener of listeners) listener(state);
  }

  function set_state(next: PainterMultiplayerSessionState): PainterMultiplayerSessionState {
    state = next;
    emit();
    return state;
  }

  function read_reconnect_token(): string {
    try {
      const existing = String(window.localStorage.getItem(options.reconnect_token_storage_key) ?? '').trim();
      if (existing) return existing;
    } catch {
      // ignore persistence failure
    }
    const next = `painter_reconnect_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      window.localStorage.setItem(options.reconnect_token_storage_key, next);
    } catch {
      // ignore persistence failure
    }
    return next;
  }

  function persist_reconnect_token(token: string | null): void {
    if (!token) return;
    try {
      window.localStorage.setItem(options.reconnect_token_storage_key, token);
    } catch {
      // ignore persistence failure
    }
  }

  function attach_ws_handlers(client: WebSocketClient): void {
    client.on('SESSION_INVALIDATED', (payload: any) => {
      set_state({
        ...state,
        lifecycle: 'error',
        error: typeof payload?.reason === 'string' ? payload.reason : 'session_invalidated',
      });
    });
  }

  async function ensure_ready(force: boolean = false): Promise<PainterMultiplayerSessionState> {
    if (!force && (state.lifecycle === 'multiplayer_ready' || state.lifecycle === 'local_only')) {
      return state;
    }
    if (!force && bootstrap_promise) return bootstrap_promise;
    bootstrap_promise = (async () => {
      set_state({ ...state, lifecycle: 'connecting', error: null });
      const host_status = await fetch_local_host_status(options.slot);
      if (!host_status?.ok || !host_status.supports_join) {
        return set_state({
          ...state,
          lifecycle: 'local_only',
          authority_mode: 'local_compat',
          host_boot_id: host_status?.host_boot_id ?? null,
          join_mode: host_status?.join_mode ?? null,
          supports_join: Boolean(host_status?.supports_join),
          revision: 0,
          snapshot: null,
          error: null,
        });
      }
      const reconnect_token = read_reconnect_token();
      const response = await fetch(`${options.api_base_url}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: options.slot, reconnect_token }),
      });
      const data = await response.json().catch(() => null) as any;
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error ?? `painter_connect_failed:${response.status}`));
      }
      const session_token = String(data?.session_token ?? '').trim();
      if (!session_token) throw new Error('painter_connect_invalid_session_token');
      const next_reconnect_token = String(data?.reconnect_token ?? reconnect_token).trim() || reconnect_token;
      persist_reconnect_token(next_reconnect_token);
      ws_client = initWebSocketClient(options.websocket_port, { sessionToken: session_token, slot: options.slot });
      attach_ws_handlers(ws_client);
      return set_state({
        lifecycle: 'multiplayer_ready',
        document_id: `slot:${options.slot}:default_canvas`,
        authority_mode: 'authoritative_host',
        slot: options.slot,
        revision: 0,
        snapshot: null,
        session_token,
        connection_id: String(data?.connection_id ?? '').trim() || null,
        reconnect_token: next_reconnect_token,
        host_boot_id: host_status.host_boot_id,
        join_mode: host_status.join_mode,
        supports_join: host_status.supports_join,
        error: null,
      });
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      debug_warn('[PAINTER_SESSION]', 'multiplayer bootstrap failed; using local compatibility mode', { message, slot: options.slot });
      return set_state({
        ...state,
        lifecycle: 'local_only',
        authority_mode: 'local_compat',
        revision: 0,
        snapshot: null,
        error: message,
      });
    }).finally(() => {
      bootstrap_promise = null;
    });
    return bootstrap_promise;
  }

  return {
    get_state: () => state,
    subscribe(listener: SessionSubscriber): () => void {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    ensure_ready,
    get_ws_client: () => ws_client,
  };
}
