export type RemoteRelayVisibility = 'private' | 'shared' | 'public';
export type RemoteRelayAppKind = 'thaumworld' | 'ascii_painter' | 'unknown';

export type RemoteRelayRoomSummary = {
  room_id: string;
  join_code?: string;
  visibility: RemoteRelayVisibility;
  app_kind: RemoteRelayAppKind;
  host_display_name?: string | null;
  world_label?: string | null;
};

export type RemoteRelayResolveJoinCodeRequest = {
  join_code: string;
  slot?: number;
  app_kind?: RemoteRelayAppKind;
};

export type RemoteRelayResolveJoinCodeResponse = {
  ok: boolean;
  room?: RemoteRelayRoomSummary;
  relay_https_origin?: string;
  relay_wss_origin?: string;
  attach_token?: string;
  host_online?: boolean;
  error?: string;
};

export type RemoteRelayHostRegisterRequest = {
  slot: number;
  app_kind: RemoteRelayAppKind;
  visibility?: RemoteRelayVisibility;
  world_label?: string | null;
  painter_document_id?: string | null;
  painter_display_name?: string | null;
};

export type RemoteRelayHostRegisterResponse = {
  ok: boolean;
  room?: RemoteRelayRoomSummary;
  host_token?: string;
  relay_https_origin?: string;
  relay_wss_origin?: string;
  lease_expires_at_ms?: number;
  error?: string;
};

export type RemoteRelayHostRefreshRequest = {
  host_token: string;
};

export type RemoteRelayHostRefreshResponse = {
  ok: boolean;
  room?: RemoteRelayRoomSummary;
  relay_https_origin?: string;
  relay_wss_origin?: string;
  lease_expires_at_ms?: number;
  error?: string;
};

export type RemoteRelayHostCloseRequest = {
  host_token: string;
};

export type RemoteRelayHostCloseResponse = {
  ok: boolean;
  room_id?: string;
  error?: string;
};

export type RemoteRelayHttpProxyRequest = {
  type: 'proxy_http_request';
  request_id: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body_base64?: string;
};

export type RemoteRelayHttpProxyResponse = {
  type: 'proxy_http_response';
  request_id: string;
  status: number;
  headers?: Record<string, string>;
  body_base64?: string;
  error?: string;
};

export type RemoteRelayBridgeOpenRequest = {
  type: 'proxy_bridge_open';
  client_id: string;
  slot: number;
  session_token: string;
};

export type RemoteRelayBridgeClientMessage = {
  type: 'proxy_bridge_client_message';
  client_id: string;
  payload_text: string;
};

export type RemoteRelayBridgeServerMessage = {
  type: 'proxy_bridge_server_message';
  client_id: string;
  payload_text: string;
};

export type RemoteRelayBridgeClose = {
  type: 'proxy_bridge_close';
  client_id: string;
  code?: number;
  reason?: string;
};

export type RemoteRelayHostSocketMessage =
  | RemoteRelayHttpProxyRequest
  | RemoteRelayHttpProxyResponse
  | RemoteRelayBridgeOpenRequest
  | RemoteRelayBridgeClientMessage
  | RemoteRelayBridgeServerMessage
  | RemoteRelayBridgeClose
  | { type: 'ping'; sent_at_ms?: number }
  | { type: 'pong'; sent_at_ms?: number };

export type RemoteRelayEnvelopeTarget =
  | { scope?: 'room' }
  | { scope: 'host' }
  | { scope: 'client'; connection_id: string };

export type RemoteRelayEnvelope = {
  type: string;
  room_id: string;
  sender_role: 'host' | 'client' | 'service';
  target?: RemoteRelayEnvelopeTarget;
  request_id?: string;
  payload?: unknown;
  sent_at_ms?: number;
};
