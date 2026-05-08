import type * as http from 'node:http';

export const INTERFACE_CORS_ALLOW_ORIGIN = '*';
export const INTERFACE_CORS_ALLOW_METHODS = 'GET,POST,OPTIONS';
export const INTERFACE_CORS_ALLOW_HEADERS = 'Content-Type, x-join-request-id';

export function apply_interface_cors_headers(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', INTERFACE_CORS_ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', INTERFACE_CORS_ALLOW_METHODS);
  res.setHeader('Access-Control-Allow-Headers', INTERFACE_CORS_ALLOW_HEADERS);
}

export function handle_interface_cors_preflight(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  apply_interface_cors_headers(res);
  if (req.method !== 'OPTIONS') return false;
  res.writeHead(204);
  res.end();
  return true;
}
