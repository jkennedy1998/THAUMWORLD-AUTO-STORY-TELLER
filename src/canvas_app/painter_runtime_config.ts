import {
  THAUMWORLD_RENDER_THEME,
  get_theme_base_font_size_px,
  get_theme_font_family,
  get_theme_weight_index_to_css,
} from '../mono_ui/runtime/render_theme.js';
import type { MultiplayerTransportConfig } from '../shared/multiplayer_transport.js';
import { build_multiplayer_transport_config, normalize_join_host_input, read_browser_manual_join_host } from '../shared/multiplayer_transport.js';

function resolve_painter_boot_role(): string {
  return String((window as Window).electronAPI?.bootRole ?? '').trim().toLowerCase();
}

const painter_boot_role = resolve_painter_boot_role();
const painter_manual_join_host = read_browser_manual_join_host();
const painter_startup_host = painter_boot_role === 'host' ? 'localhost' : painter_manual_join_host ?? undefined;
const PAINTER_TRANSPORT = build_multiplayer_transport_config({
  host: painter_startup_host,
});
console.log('[PAINTER_RUNTIME_CONFIG]', JSON.stringify({
  event: 'startup_transport_resolved',
  boot_role: painter_boot_role || null,
  manual_join_host_raw: painter_manual_join_host ?? null,
  startup_host_input: painter_startup_host ?? null,
  normalized_manual_join_host: painter_manual_join_host ? normalize_join_host_input(painter_manual_join_host).normalized_host : null,
  api_base_url: PAINTER_TRANSPORT.api_base_url,
  bridge_ws_base_url: PAINTER_TRANSPORT.bridge_ws_base_url,
}));

function resolve_painter_data_slot(): number {
  const slot = Number((window as Window).electronAPI?.dataSlot ?? 1);
  if (!Number.isFinite(slot) || slot < 1) return 1;
  return Math.floor(slot);
}

function resolve_painter_client_instance_id(): string {
  const raw = String((window as Window).electronAPI?.clientInstanceId ?? '').trim();
  return raw || 'shared_fallback';
}

function resolve_painter_reconnect_token_storage_key(): string {
  const slot = resolve_painter_data_slot();
  const client_instance_id = resolve_painter_client_instance_id();
  return `thaumworld_ascii_painter_reconnect_token:slot_${slot}:${client_instance_id}`;
}

export const PAINTER_APP_CONFIG = {
  render_backend: THAUMWORLD_RENDER_THEME.backend,
  render_theme_id: THAUMWORLD_RENDER_THEME.id,
  font_family: get_theme_font_family(THAUMWORLD_RENDER_THEME),
  base_font_size_px: get_theme_base_font_size_px(THAUMWORLD_RENDER_THEME),
  base_line_height_mult: 1,
  base_letter_spacing_mult: 0,
  weight_index_to_css: get_theme_weight_index_to_css(THAUMWORLD_RENDER_THEME),
  grid_width: 200,
  grid_height: 50,
  api_base_url: PAINTER_TRANSPORT.api_base_url,
  bridge_ws_base_url: PAINTER_TRANSPORT.bridge_ws_base_url,
  selected_data_slot: resolve_painter_data_slot(),
  reconnect_token_storage_key: resolve_painter_reconnect_token_storage_key(),
} as const;

export function apply_painter_multiplayer_transport_config(transport: Pick<MultiplayerTransportConfig, 'api_base_url' | 'bridge_ws_base_url'> & { host_input?: string | null }): void {
  (PAINTER_APP_CONFIG as any).api_base_url = String(transport.api_base_url ?? '').trim() || PAINTER_APP_CONFIG.api_base_url;
  (PAINTER_APP_CONFIG as any).bridge_ws_base_url = String(transport.bridge_ws_base_url ?? '').trim() || PAINTER_APP_CONFIG.bridge_ws_base_url;
  console.log('[PAINTER_RUNTIME_CONFIG]', JSON.stringify({
    event: 'apply_transport',
    boot_role: painter_boot_role || null,
    host_input: String(transport.host_input ?? '').trim() || null,
    api_base_url: (PAINTER_APP_CONFIG as any).api_base_url,
    bridge_ws_base_url: (PAINTER_APP_CONFIG as any).bridge_ws_base_url,
  }));
  try {
    const host_input = String(transport.host_input ?? '').trim();
    if (painter_boot_role === 'host') {
      console.log('[PAINTER_RUNTIME_CONFIG]', JSON.stringify({
        event: 'skip_manual_host_persist_for_host_role',
        host_input: host_input || null,
      }));
      return;
    }
    if (host_input && !/^local$/i.test(host_input)) window.localStorage.setItem('thaumworld_manual_join_host', host_input);
  } catch {
    // ignore persistence failures
  }
}
