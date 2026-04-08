export type RenderBackendKind = 'font' | 'atlas';

export type CellContract = {
  width_px: number;
  height_px: number;
};

export type FontRenderTheme = {
  family: string;
  primary_family: string;
  base_font_size_px: number;
  weight_index_to_css: readonly number[];
  source_files: readonly string[];
};

export type AtlasRenderTheme = {
  image_src: string | null;
  manifest_src: string | null;
  glyph_cell_width_px: number;
  glyph_cell_height_px: number;
  tint_mode: 'multiply' | 'replace';
  fallback_backend: Extract<RenderBackendKind, 'font'>;
};

export type RenderTheme = {
  id: string;
  backend: RenderBackendKind;
  cell: CellContract;
  font: FontRenderTheme;
  atlas: AtlasRenderTheme;
};

export const THAUMWORLD_RENDER_THEME: RenderTheme = {
  id: 'thaumworld-atlas-v1',
  backend: 'atlas',
  cell: {
    width_px: 12,
    height_px: 16,
  },
  font: {
    family: 'Thaum Mono, Noto Sans Mono, Noto Sans, monospace, sans-serif',
    primary_family: 'Thaum Mono',
    base_font_size_px: 16,
    weight_index_to_css: [80, 160, 320, 640] as const,
    source_files: [
      '../../fontbook/ThaumMono-W80.ttf',
      '../../fontbook/ThaumMono-W160.ttf',
      '../../fontbook/ThaumMono-W320.ttf',
      '../../fontbook/ThaumMono-W640.ttf',
    ] as const,
  },
  atlas: {
    image_src: 'internal:terrain',
    manifest_src: 'internal:terrain',
    glyph_cell_width_px: 12,
    glyph_cell_height_px: 16,
    tint_mode: 'multiply',
    fallback_backend: 'font',
  },
};

export function get_theme_font_family(theme: RenderTheme): string {
  return theme.font.family;
}

export function get_theme_font_primary_family(theme: RenderTheme): string {
  return theme.font.primary_family;
}

export function get_theme_base_font_size_px(theme: RenderTheme): number {
  return theme.font.base_font_size_px;
}

export function get_theme_weight_index_to_css(theme: RenderTheme): readonly number[] {
  return theme.font.weight_index_to_css;
}

export function resolve_render_backend(theme: RenderTheme, requested_backend: RenderBackendKind): {
  requested_backend: RenderBackendKind;
  effective_backend: RenderBackendKind;
  fallback_reason: string | null;
} {
  if (requested_backend === 'atlas') {
    const has_atlas_assets = typeof theme.atlas.image_src === 'string' && theme.atlas.image_src.length > 0;
    if (!has_atlas_assets) {
      return {
        requested_backend,
        effective_backend: theme.atlas.fallback_backend,
        fallback_reason: 'atlas assets are not configured yet',
      };
    }
  }
  return {
    requested_backend,
    effective_backend: requested_backend,
    fallback_reason: null,
  };
}
