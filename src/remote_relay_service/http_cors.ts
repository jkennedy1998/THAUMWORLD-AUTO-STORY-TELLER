import type * as http from 'node:http';

export const REMOTE_RELAY_CORS_ALLOW_ORIGIN = '*';
export const REMOTE_RELAY_CORS_ALLOW_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
export const REMOTE_RELAY_CORS_ALLOW_HEADERS = 'Content-Type, x-remote-request-id, x-join-request-id';

export const REMOTE_RELAY_CORS_RESPONSE_HEADERS = {
  'Access-Control-Allow-Origin': REMOTE_RELAY_CORS_ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': REMOTE_RELAY_CORS_ALLOW_METHODS,
  'Access-Control-Allow-Headers': REMOTE_RELAY_CORS_ALLOW_HEADERS,
} as const;

export function apply_remote_relay_cors_headers(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', REMOTE_RELAY_CORS_ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', REMOTE_RELAY_CORS_ALLOW_METHODS);
  res.setHeader('Access-Control-Allow-Headers', REMOTE_RELAY_CORS_ALLOW_HEADERS);
}

export function handle_remote_relay_cors_preflight(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  apply_remote_relay_cors_headers(res);
  if (req.method !== 'OPTIONS') return false;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
  return true;
}
