import {
  THAUMWORLD_RENDER_THEME,
  get_theme_base_font_size_px,
  get_theme_font_family,
  get_theme_weight_index_to_css,
} from '../mono_ui/runtime/render_theme.js';

function resolve_painter_data_slot(): number {
  const slot = Number((window as Window).electronAPI?.dataSlot ?? 1);
  if (!Number.isFinite(slot) || slot < 1) return 1;
  return Math.floor(slot);
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
  api_base_url: 'http://localhost:8787/api',
  websocket_port: 8789,
  selected_data_slot: resolve_painter_data_slot(),
  reconnect_token_storage_key: 'thaumworld_ascii_painter_reconnect_token',
} as const;
