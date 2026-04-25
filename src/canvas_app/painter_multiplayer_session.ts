import { initWebSocketClient, type WebSocketClient } from '../mono_ui/websocket_client.js';
import { debug_log, debug_warn } from '../shared/debug.js';
import type { PainterDocumentBootstrap, PainterSessionLifecycle } from '../shared/painter_protocol.js';
import type { MultiplayerTransportConfig } from '../shared/multiplayer_transport.js';
import { fetch_host_status } from './world_discovery.js';

export type PainterMultiplayerSessionState = PainterDocumentBootstrap & {
  lifecycle: PainterSessionLifecycle;
};

type PainterMultiplayerSessionOptions = {
  slot: number;
  get_api_base_url: () => string;
  get_bridge_ws_base_url: () => string;
  reconnect_token_storage_key: string;
};

type SessionSubscriber = (state: PainterMultiplayerSessionState) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function get_boot_role(): string {
  return String((window as Window).electronAPI?.bootRole ?? '').trim().toLowerCase();
}

function is_local_host_transport(transport: MultiplayerTransportConfig): boolean {
  const host = String(transport.host_input ?? '').trim().toLowerCase();
  const hostname = host.replace(/:\d+$/, '');
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === 'local';
}

function resolve_painter_transport(options: PainterMultiplayerSessionOptions): MultiplayerTransportConfig {
  const api_url = new URL(options.get_api_base_url());
  const bridge_ws_url = new URL(options.get_bridge_ws_base_url());
  return {
    host_input: api_url.host || 'localhost',
    host_origin: api_url.origin,
    api_base_url: `${api_url.origin}${api_url.pathname.replace(/\/+$/, '')}`,
    bridge_http_url: api_url.origin,
    bridge_ws_base_url: bridge_ws_url.origin,
  };
}

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
      if (existing) {
        debug_log('[PAINTER_SESSION]', 'reusing reconnect token', {
          slot: options.slot,
          reconnect_token_storage_key: options.reconnect_token_storage_key,
        });
        return existing;
      }
    } catch {
      // ignore persistence failure
    }
    const next = `painter_reconnect_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      window.localStorage.setItem(options.reconnect_token_storage_key, next);
    } catch {
      // ignore persistence failure
    }
    debug_log('[PAINTER_SESSION]', 'created reconnect token', {
      slot: options.slot,
      reconnect_token_storage_key: options.reconnect_token_storage_key,
    });
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
    client.on('PAINTER_HOSTED_SESSION_UPDATED', (payload: any) => {
      window.dispatchEvent(new CustomEvent('painter-hosted-session-updated', { detail: payload ?? {} }));
    });
    client.on('PAINTER_SESSION_ENDED', (payload: any) => {
      debug_warn('[PAINTER_SESSION]', 'painter session ended by host', payload ?? {});
      console.warn('[PAINTER_SESSION_ENDED]', JSON.stringify({
        slot: options.slot,
        payload: payload ?? null,
        api_base_url: options.get_api_base_url(),
        bridge_ws_base_url: options.get_bridge_ws_base_url(),
      }));
      window.dispatchEvent(new CustomEvent('painter-session-ended', { detail: payload ?? {} }));
    });
  }

  async function ensure_ready(force: boolean = false): Promise<PainterMultiplayerSessionState> {
    if (!force && (state.lifecycle === 'multiplayer_ready' || state.lifecycle === 'local_only')) {
      return state;
    }
    if (!force && bootstrap_promise) return bootstrap_promise;
    bootstrap_promise = (async () => {
      set_state({ ...state, lifecycle: 'connecting', error: null });
      const transport = resolve_painter_transport(options);
      const boot_role = get_boot_role();
      const strict_local_host_boot = boot_role === 'host' && is_local_host_transport(transport);
      const max_attempts = strict_local_host_boot ? 8 : 1;
      debug_log('[PAINTER_SESSION]', 'bootstrapping painter multiplayer session', {
        slot: options.slot,
        force,
        reconnect_token_storage_key: options.reconnect_token_storage_key,
        api_base_url: transport.api_base_url,
        bridge_ws_base_url: transport.bridge_ws_base_url,
        boot_role,
        strict_local_host_boot,
        max_attempts,
      });
      console.log('[PAINTER_SESSION_BOOT]', JSON.stringify({
        slot: options.slot,
        force,
        api_base_url: transport.api_base_url,
        bridge_ws_base_url: transport.bridge_ws_base_url,
        boot_role,
        strict_local_host_boot,
        max_attempts,
      }));
      let host_status: Awaited<ReturnType<typeof fetch_host_status>> = null;
      for (let attempt = 1; attempt <= max_attempts; attempt += 1) {
        console.log('[JOIN_CONNECT]', JSON.stringify({
          event: 'painter_host_status_started',
          slot: options.slot,
          api_base_url: transport.api_base_url,
          bridge_ws_base_url: transport.bridge_ws_base_url,
          attempt,
          max_attempts,
          boot_role,
        }));
        host_status = await fetch_host_status(options.slot, transport);
        console.log('[JOIN_CONNECT]', JSON.stringify({
          event: 'painter_host_status_completed',
          slot: options.slot,
          api_base_url: transport.api_base_url,
          attempt,
          max_attempts,
          supports_join: Boolean(host_status?.supports_join),
          join_mode: host_status?.join_mode ?? null,
          host_mode: host_status?.host_mode ?? null,
          painter_document_id: host_status?.painter_document_id ?? null,
        }));
        if (host_status?.ok && host_status.supports_join) break;
        if (attempt < max_attempts) {
          console.warn('[PAINTER_SESSION_BOOT]', JSON.stringify({
            slot: options.slot,
            reason: 'host_status_retry_wait',
            attempt,
            max_attempts,
            api_base_url: transport.api_base_url,
            boot_role,
          }));
          await sleep(400 * attempt);
        }
      }
      if (!host_status?.ok || !host_status.supports_join) {
        debug_warn('[PAINTER_SESSION]', 'local host join unavailable; using local compatibility mode', {
          slot: options.slot,
          host_status,
          boot_role,
          strict_local_host_boot,
        });
        console.warn('[PAINTER_SESSION_BOOT]', JSON.stringify({
          slot: options.slot,
          reason: 'host_join_unavailable',
          host_status,
          boot_role,
          strict_local_host_boot,
        }));
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
      let response: Response | null = null;
      let data: any = null;
      let last_connect_error: string | null = null;
      for (let attempt = 1; attempt <= max_attempts; attempt += 1) {
        console.log('[JOIN_CONNECT]', JSON.stringify({
          event: 'painter_connect_started',
          slot: options.slot,
          api_base_url: transport.api_base_url,
          bridge_ws_base_url: transport.bridge_ws_base_url,
          reconnect_token_present: Boolean(reconnect_token),
          attempt,
          max_attempts,
          boot_role,
        }));
        try {
          response = await fetch(`${transport.api_base_url}/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slot: options.slot, reconnect_token }),
          });
          data = await response.json().catch(() => null) as any;
          if (response.ok && data?.ok) break;
          last_connect_error = String(data?.error ?? `painter_connect_failed:${response.status}`);
          console.warn('[JOIN_CONNECT]', JSON.stringify({
            event: 'painter_connect_failed',
            slot: options.slot,
            status: response.status,
            api_base_url: transport.api_base_url,
            error: data?.error ?? null,
            attempt,
            max_attempts,
          }));
        } catch (error) {
          last_connect_error = error instanceof Error ? error.message : String(error);
          console.warn('[JOIN_CONNECT]', JSON.stringify({
            event: 'painter_connect_error',
            slot: options.slot,
            api_base_url: transport.api_base_url,
            message: last_connect_error,
            attempt,
            max_attempts,
          }));
        }
        if (attempt < max_attempts) {
          console.warn('[PAINTER_SESSION_BOOT]', JSON.stringify({
            slot: options.slot,
            reason: 'connect_retry_wait',
            attempt,
            max_attempts,
            api_base_url: transport.api_base_url,
            boot_role,
            last_connect_error,
          }));
          await sleep(400 * attempt);
        }
      }
      if (!response?.ok || !data?.ok) {
        throw new Error(last_connect_error ?? `painter_connect_failed:${response?.status ?? 'unknown'}`);
      }
      const session_token = String(data?.session_token ?? '').trim();
      if (!session_token) throw new Error('painter_connect_invalid_session_token');
      const next_reconnect_token = String(data?.reconnect_token ?? reconnect_token).trim() || reconnect_token;
      persist_reconnect_token(next_reconnect_token);
      debug_log('[PAINTER_SESSION]', 'painter multiplayer session connected', {
        slot: options.slot,
        reconnect_token_storage_key: options.reconnect_token_storage_key,
        connection_id: String(data?.connection_id ?? '').trim() || null,
        reconnect_token_reused: next_reconnect_token === reconnect_token,
      });
      console.log('[PAINTER_SESSION_CONNECTED]', JSON.stringify({
        slot: options.slot,
        connection_id: String(data?.connection_id ?? '').trim() || null,
        reconnect_token_reused: next_reconnect_token === reconnect_token,
        api_base_url: transport.api_base_url,
        bridge_ws_base_url: transport.bridge_ws_base_url,
      }));
      console.log('[JOIN_CONNECT]', JSON.stringify({
        event: 'painter_connect_succeeded',
        slot: options.slot,
        connection_id: String(data?.connection_id ?? '').trim() || null,
        reconnect_token_reused: next_reconnect_token === reconnect_token,
        api_base_url: transport.api_base_url,
        bridge_ws_base_url: transport.bridge_ws_base_url,
      }));
      ws_client = initWebSocketClient(transport.bridge_ws_base_url, {
        baseUrl: transport.bridge_ws_base_url,
        sessionToken: session_token,
        slot: options.slot,
      });
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
      console.warn('[PAINTER_SESSION_BOOT]', JSON.stringify({
          slot: options.slot,
        reason: 'bootstrap_failed',
        message,
        stack: error instanceof Error ? error.stack ?? null : null,
        api_base_url: options.get_api_base_url(),
        bridge_ws_base_url: options.get_bridge_ws_base_url(),
      }));
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
