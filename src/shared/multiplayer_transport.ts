export const DEFAULT_INTERFACE_PORT = 8787;
export const DEFAULT_BRIDGE_HTTP_PORT = 8788;
export const DEFAULT_BRIDGE_WS_PORT = 8789;

export type MultiplayerTransportConfig = {
  host_input: string;
  host_origin: string;
  api_base_url: string;
  bridge_http_url: string;
  bridge_ws_base_url: string;
};

export type NormalizedJoinHost = {
  normalized_host: string;
  hostname: string;
  explicit_port: number | null;
};

type BuildMultiplayerTransportConfigArgs = {
  host?: string | null;
  api_base_url?: string | null;
  bridge_http_url?: string | null;
  bridge_ws_base_url?: string | null;
  interface_port?: number | null;
  bridge_http_port?: number | null;
  bridge_ws_port?: number | null;
};

function normalize_url_input(raw: string, protocol: 'http:' | 'ws:'): URL {
  const trimmed = String(raw ?? '').trim() || (protocol === 'ws:' ? 'ws://localhost' : 'http://localhost');
  const with_protocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `${protocol === 'ws:' ? 'ws' : 'http'}://${trimmed}`;
  return new URL(with_protocol);
}

function parse_host_url(raw: string): URL {
  return normalize_url_input(raw, 'http:');
}

function normalize_origin(raw: string, protocol: 'http:' | 'ws:'): string {
  const url = normalize_url_input(raw, protocol);
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.origin;
}

function set_port(origin: string, port: number, protocol: 'http:' | 'ws:'): string {
  const url = new URL(origin);
  if (protocol === 'ws:') {
    url.protocol = origin.startsWith('https://') ? 'wss:' : 'ws:';
  } else {
    url.protocol = 'http:';
  }
  url.port = String(port);
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.origin;
}

function normalize_api_base_url(raw: string): string {
  const origin = normalize_origin(raw, 'http:');
  return `${origin}/api`;
}

function safe_port(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function safe_explicit_port(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const port = Math.floor(value);
  if (port < 1 || port > 65535) return null;
  return port;
}

export function normalize_join_host_input(raw: string): NormalizedJoinHost {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    throw new Error('host address required');
  }
  let parsed: URL;
  try {
    parsed = parse_host_url(trimmed);
  } catch {
    throw new Error('invalid host address');
  }
  if (!parsed.hostname) {
    throw new Error('invalid host address');
  }
  if ((parsed.pathname && parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
    throw new Error('host address cannot include path or query');
  }
  const explicit_port = safe_explicit_port(parsed.port);
  const normalized_host = explicit_port ? `${parsed.hostname}:${explicit_port}` : parsed.hostname;
  return {
    normalized_host,
    hostname: parsed.hostname,
    explicit_port,
  };
}

export function build_multiplayer_transport_config(args: BuildMultiplayerTransportConfigArgs = {}): MultiplayerTransportConfig {
  const host_input = String(args.host ?? args.api_base_url ?? args.bridge_http_url ?? args.bridge_ws_base_url ?? '').trim() || 'localhost';
  const normalized_host = normalize_join_host_input(host_input);
  const host_origin = normalize_origin(normalized_host.normalized_host, 'http:');
  const inferred_interface_port = normalized_host.explicit_port ?? DEFAULT_INTERFACE_PORT;
  const interface_port = safe_port(args.interface_port, inferred_interface_port);
  const inferred_bridge_http_port = normalized_host.explicit_port !== null
    ? Math.max(1, Math.min(65535, normalized_host.explicit_port + (DEFAULT_BRIDGE_HTTP_PORT - DEFAULT_INTERFACE_PORT)))
    : DEFAULT_BRIDGE_HTTP_PORT;
  const inferred_bridge_ws_port = normalized_host.explicit_port !== null
    ? Math.max(1, Math.min(65535, normalized_host.explicit_port + (DEFAULT_BRIDGE_WS_PORT - DEFAULT_INTERFACE_PORT)))
    : DEFAULT_BRIDGE_WS_PORT;
  const bridge_http_port = safe_port(args.bridge_http_port, inferred_bridge_http_port);
  const bridge_ws_port = safe_port(args.bridge_ws_port, inferred_bridge_ws_port);
  const api_base_url = String(args.api_base_url ?? '').trim()
    ? normalize_api_base_url(String(args.api_base_url))
    : `${set_port(host_origin, interface_port, 'http:')}/api`;
  const bridge_http_url = String(args.bridge_http_url ?? '').trim()
    ? normalize_origin(String(args.bridge_http_url), 'http:')
    : set_port(host_origin, bridge_http_port, 'http:');
  const bridge_ws_base_url = String(args.bridge_ws_base_url ?? '').trim()
    ? normalize_origin(String(args.bridge_ws_base_url), 'ws:')
    : set_port(host_origin, bridge_ws_port, 'ws:');
  return {
    host_input: normalized_host.normalized_host,
    host_origin,
    api_base_url,
    bridge_http_url,
    bridge_ws_base_url,
  };
}

export const DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT = build_multiplayer_transport_config();

export function build_api_url(api_base_url: string, path: string): string {
  const base = String(api_base_url ?? '').trim().replace(/\/+$/, '');
  const suffix = String(path ?? '').startsWith('/') ? String(path) : `/${String(path ?? '').trim()}`;
  return `${base}${suffix}`;
}

export function read_browser_manual_join_host(storage_key: string = 'thaumworld_manual_join_host'): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const value = String(window.localStorage.getItem(storage_key) ?? '').trim();
    return value || null;
  } catch {
    return null;
  }
}

export function read_browser_manual_join_label(storage_key: string = 'thaumworld_manual_join_label'): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const value = String(window.localStorage.getItem(storage_key) ?? '').trim();
    return value || null;
  } catch {
    return null;
  }
}
