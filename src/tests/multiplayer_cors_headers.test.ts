import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  INTERFACE_CORS_ALLOW_HEADERS,
  INTERFACE_CORS_ALLOW_METHODS,
  INTERFACE_CORS_ALLOW_ORIGIN,
  handle_interface_cors_preflight,
} from '../interface_program/http_cors.js';
import {
  REMOTE_RELAY_CORS_ALLOW_HEADERS,
  REMOTE_RELAY_CORS_ALLOW_METHODS,
  REMOTE_RELAY_CORS_ALLOW_ORIGIN,
  handle_remote_relay_cors_preflight,
} from '../remote_relay_service/http_cors.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function assertCorsHeaders(response: Response, expected: { origin: string; methods: string; headers: string }): void {
  assert(response.headers.get('access-control-allow-origin') === expected.origin, `expected allow-origin=${expected.origin}, got ${response.headers.get('access-control-allow-origin')}`);
  assert(response.headers.get('access-control-allow-methods') === expected.methods, `expected allow-methods=${expected.methods}, got ${response.headers.get('access-control-allow-methods')}`);
  assert(response.headers.get('access-control-allow-headers') === expected.headers, `expected allow-headers=${expected.headers}, got ${response.headers.get('access-control-allow-headers')}`);
}

async function testInterfaceCors(): Promise<void> {
  const server = http.createServer((req, res) => {
    if (handle_interface_cors_preflight(req, res)) return;
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/host/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, request_id: String(req.headers['x-join-request-id'] ?? '') || null }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/connect') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  });

  const baseUrl = await listen(server);
  try {
    for (const path of ['/api/host/status', '/api/connect']) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': path === '/api/connect' ? 'POST' : 'GET',
          'Access-Control-Request-Headers': 'content-type, x-join-request-id',
        },
      });
      assert(response.status === 204, `expected interface OPTIONS ${path} to return 204, got ${response.status}`);
      assertCorsHeaders(response, {
        origin: INTERFACE_CORS_ALLOW_ORIGIN,
        methods: INTERFACE_CORS_ALLOW_METHODS,
        headers: INTERFACE_CORS_ALLOW_HEADERS,
      });
    }

    const getResponse = await fetch(`${baseUrl}/api/host/status`, {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:5173',
        'x-join-request-id': 'join_req_test_1',
      },
    });
    assert(getResponse.status === 200, `expected GET /api/host/status to return 200, got ${getResponse.status}`);
    assertCorsHeaders(getResponse, {
      origin: INTERFACE_CORS_ALLOW_ORIGIN,
      methods: INTERFACE_CORS_ALLOW_METHODS,
      headers: INTERFACE_CORS_ALLOW_HEADERS,
    });
    const payload = await getResponse.json() as { ok?: boolean; request_id?: string | null };
    assert(payload.ok === true, 'expected GET /api/host/status payload ok=true');
    assert(payload.request_id === 'join_req_test_1', `expected join request header to survive normal GET, got ${payload.request_id}`);
  } finally {
    await close(server);
  }
}

async function testRemoteRelayCors(): Promise<void> {
  const server = http.createServer((req, res) => {
    if (handle_remote_relay_cors_preflight(req, res)) return;
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'POST' && (url.pathname === '/api/remote_relay/join/resolve' || url.pathname === '/api/remote_relay/host/register')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  });

  const baseUrl = await listen(server);
  try {
    for (const path of ['/api/remote_relay/join/resolve', '/api/remote_relay/host/register']) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type, x-remote-request-id, x-join-request-id',
        },
      });
      assert(response.status === 200, `expected relay OPTIONS ${path} to return 200, got ${response.status}`);
      assertCorsHeaders(response, {
        origin: REMOTE_RELAY_CORS_ALLOW_ORIGIN,
        methods: REMOTE_RELAY_CORS_ALLOW_METHODS,
        headers: REMOTE_RELAY_CORS_ALLOW_HEADERS,
      });
      const payload = await response.json() as { ok?: boolean };
      assert(payload.ok === true, `expected relay OPTIONS ${path} payload ok=true`);
    }
  } finally {
    await close(server);
  }
}

async function main(): Promise<void> {
  await testInterfaceCors();
  await testRemoteRelayCors();
  console.log('multiplayer_cors_headers.test.ts: ok');
}

void main().catch((error) => {
  console.error('multiplayer_cors_headers.test.ts: failed');
  console.error(error);
  process.exit(1);
});
