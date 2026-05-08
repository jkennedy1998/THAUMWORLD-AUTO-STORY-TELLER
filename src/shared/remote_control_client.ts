import { build_remote_relay_transport_config, type MultiplayerTransportConfig } from './multiplayer_transport.js';
import { make_request_id } from './request_id.js';
import type {
  RemoteRelayHostCloseRequest,
  RemoteRelayHostCloseResponse,
  RemoteRelayHostRefreshRequest,
  RemoteRelayHostRefreshResponse,
  RemoteRelayHostRegisterRequest,
  RemoteRelayHostRegisterResponse,
  RemoteRelayResolveJoinCodeRequest,
  RemoteRelayResolveJoinCodeResponse,
} from './remote_relay_protocol.js';

function trim_origin(raw: string): string {
  return String(raw ?? '').trim().replace(/\/+$/, '');
}

function log(event: string, payload: Record<string, unknown>): void {
  console.log('[REMOTE_CONTROL]', JSON.stringify({ event, method: 'remote_relay', ...payload }));
}

async function post_json<TResponse>(args: {
  relay_origin: string;
  path: string;
  request_id_prefix: string;
  action: string;
  body: unknown;
  log_fields?: Record<string, unknown>;
}): Promise<TResponse> {
  const request_id = make_request_id(args.request_id_prefix);
  const relay_origin = trim_origin(args.relay_origin);
  const url = `${relay_origin}${args.path}`;
  log('request_started', { request_id, action: args.action, relay_origin, ...args.log_fields });
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-remote-request-id': request_id },
    body: JSON.stringify(args.body),
  });
  const data = await response.json().catch(() => ({ ok: false, error: 'invalid_json' }));
  log('request_completed', {
    request_id,
    action: args.action,
    relay_origin,
    status: response.status,
    ok: Boolean((data as any)?.ok),
    error: (data as any)?.error ?? null,
    room_id: (data as any)?.room?.room_id ?? (data as any)?.room_id ?? null,
    lease_expires_at_ms: (data as any)?.lease_expires_at_ms ?? null,
    ...args.log_fields,
  });
  return data as TResponse;
}

export async function register_remote_relay_host(relay_origin: string, request: RemoteRelayHostRegisterRequest): Promise<RemoteRelayHostRegisterResponse> {
  return post_json<RemoteRelayHostRegisterResponse>({
    relay_origin,
    path: '/api/remote_relay/host/register',
    request_id_prefix: 'relay_register',
    action: 'host_register',
    body: request,
    log_fields: { slot: request.slot, app_kind: request.app_kind, visibility: request.visibility ?? 'private' },
  });
}

export async function refresh_remote_relay_host(relay_origin: string, request: RemoteRelayHostRefreshRequest): Promise<RemoteRelayHostRefreshResponse> {
  return post_json<RemoteRelayHostRefreshResponse>({
    relay_origin,
    path: '/api/remote_relay/host/refresh',
    request_id_prefix: 'relay_refresh',
    action: 'host_refresh',
    body: request,
  });
}

export async function close_remote_relay_host(relay_origin: string, request: RemoteRelayHostCloseRequest): Promise<RemoteRelayHostCloseResponse> {
  return post_json<RemoteRelayHostCloseResponse>({
    relay_origin,
    path: '/api/remote_relay/host/close',
    request_id_prefix: 'relay_close',
    action: 'host_close',
    body: request,
  });
}

export async function resolve_remote_relay_join_code(relay_origin: string, request: RemoteRelayResolveJoinCodeRequest): Promise<RemoteRelayResolveJoinCodeResponse> {
  return post_json<RemoteRelayResolveJoinCodeResponse>({
    relay_origin,
    path: '/api/remote_relay/join/resolve',
    request_id_prefix: 'relay_resolve',
    action: 'join_resolve',
    body: request,
    log_fields: { slot: request.slot ?? null, app_kind: request.app_kind ?? null, join_code: request.join_code },
  });
}

export function build_remote_relay_transport_from_resolved(args: {
  relay_origin: string;
  room_id: string;
  attach_token: string;
  join_code?: string | null;
  relay_wss_origin?: string | null;
}): MultiplayerTransportConfig {
  return build_remote_relay_transport_config({
    relay_https_origin: args.relay_origin,
    relay_wss_origin: args.relay_wss_origin,
    room_id: args.room_id,
    attach_token: args.attach_token,
    join_code: args.join_code,
    host_input: args.join_code ?? args.room_id,
  });
}
