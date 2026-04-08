import type { InlineMaterialAssignments, RenderGraphicRef, ViewDirection } from '../../render_shaders/graphics_contract.js';
import { get_brightest_indexed_rgb, get_darkest_indexed_rgb, nearest_indexed_rgb } from '../colors.js';
import { resolve_material_rgb } from './material_registry.js';
import { project_lit_semantic_value, resolve_light_mag, type SemanticValue } from '../../mag/light.js';

export type AtlasSheetRef = {
  id: string;
  src: string;
};

export type AtlasWeightFrameRef = {
  sheet: string;
  x: number;
  y: number;
};

export type AtlasViewEntry =
  | { weights: [AtlasWeightFrameRef, AtlasWeightFrameRef, AtlasWeightFrameRef, AtlasWeightFrameRef] }
  | { sameAs: ViewDirection };

export type AtlasTileEntry = {
  views: Record<ViewDirection, AtlasViewEntry>;
  material_slots?: Partial<Record<1 | 2 | 3, string>>;
  source_layout?: 'column_weights';
};

export type AtlasFamilyManifest = {
  family: string;
  cellWidth: 12;
  cellHeight: 16;
  bands: {
    1: 'red';
    2: 'green';
    3: 'blue';
  };
  sheets: AtlasSheetRef[];
  tiles: Record<string, AtlasTileEntry>;
};

const ATLAS_ASSET_VERSION = `${Date.now()}`;

function atlas_src(file: string): string {
  return `/atlas/${file}?v=${ATLAS_ASSET_VERSION}`;
}

type StoneConnectivityVariantFrame = {
  col: 0 | 1 | 2 | 3;
  row_in_group: 0 | 1 | 2 | 3;
};

const STONE_BRICK_VARIANT_FRAMES: Record<string, StoneConnectivityVariantFrame> = {
  tile_stone_brick_isolated: { col: 0, row_in_group: 0 },
  tile_stone_brick_end_cap_n: { col: 0, row_in_group: 1 },
  tile_stone_brick_end_cap_e: { col: 0, row_in_group: 3 },
  tile_stone_brick_end_cap_s: { col: 0, row_in_group: 2 },
  tile_stone_brick_end_cap_w: { col: 1, row_in_group: 3 },
  tile_stone_brick_straight_horizontal: { col: 2, row_in_group: 3 },
  tile_stone_brick_straight_vertical: { col: 3, row_in_group: 3 },
  tile_stone_brick_corner_ne: { col: 1, row_in_group: 0 },
  tile_stone_brick_corner_se: { col: 1, row_in_group: 2 },
  tile_stone_brick_corner_sw: { col: 3, row_in_group: 2 },
  tile_stone_brick_corner_nw: { col: 3, row_in_group: 0 },
  tile_stone_brick_t_missing_n: { col: 2, row_in_group: 2 },
  tile_stone_brick_t_missing_e: { col: 3, row_in_group: 1 },
  tile_stone_brick_t_missing_s: { col: 2, row_in_group: 0 },
  tile_stone_brick_t_missing_w: { col: 1, row_in_group: 1 },
  tile_stone_brick_center: { col: 2, row_in_group: 1 },
};

function make_same_view_weights(sheet: string, col: number, row_in_group: number): [AtlasWeightFrameRef, AtlasWeightFrameRef, AtlasWeightFrameRef, AtlasWeightFrameRef] {
  return [
    { sheet, x: col * 12, y: row_in_group * 16 },
    { sheet, x: col * 12, y: (4 * 16) + (row_in_group * 16) },
    { sheet, x: col * 12, y: (8 * 16) + (row_in_group * 16) },
    { sheet, x: col * 12, y: (12 * 16) + (row_in_group * 16) },
  ];
}

function make_cardinal_shared_tile(sheet: string, col: number, row_in_group: number, material_slots?: Partial<Record<1 | 2 | 3, string>>): AtlasTileEntry {
  return {
    material_slots,
    views: {
      north: { weights: make_same_view_weights(sheet, col, row_in_group) },
      south: { sameAs: 'north' },
      east: { sameAs: 'north' },
      west: { sameAs: 'north' },
      up: { sameAs: 'north' },
      down: { sameAs: 'north' },
    },
  };
}

const TERRAIN_FAMILY: AtlasFamilyManifest = {
  family: 'terrain',
  cellWidth: 12,
  cellHeight: 16,
  bands: { 1: 'red', 2: 'green', 3: 'blue' },
  sheets: [
    { id: 'grass', src: atlas_src('grass.png') },
    { id: 'tile_chest_single', src: atlas_src('tile_chest_single.png') },
    { id: 'tile_stone_bricks', src: atlas_src('tile_stone_bricks.png') },
  ],
  tiles: {
    tile_small_grass: {
      source_layout: 'column_weights',
      material_slots: { 1: 'FOLIAGE_GREEN' },
      views: {
        north: { weights: [
          { sheet: 'grass', x: 0, y: 0 },
          { sheet: 'grass', x: 0, y: 16 },
          { sheet: 'grass', x: 0, y: 32 },
          { sheet: 'grass', x: 0, y: 48 },
        ] },
        south: { sameAs: 'north' },
        east: { sameAs: 'north' },
        west: { sameAs: 'north' },
        up: { sameAs: 'north' },
        down: { sameAs: 'north' },
      },
    },
    tile_chest_single_closed: {
      material_slots: { 1: 'WOOD_LIVE', 2: 'BRONZE', 3: 'IRON_PALE' },
      views: {
        north: { weights: [
          { sheet: 'tile_chest_single', x: 0, y: 0 },
          { sheet: 'tile_chest_single', x: 0, y: 16 },
          { sheet: 'tile_chest_single', x: 0, y: 32 },
          { sheet: 'tile_chest_single', x: 0, y: 48 },
        ] },
        east: { weights: [
          { sheet: 'tile_chest_single', x: 12, y: 0 },
          { sheet: 'tile_chest_single', x: 12, y: 16 },
          { sheet: 'tile_chest_single', x: 12, y: 32 },
          { sheet: 'tile_chest_single', x: 12, y: 48 },
        ] },
        west: { sameAs: 'east' },
        south: { weights: [
          { sheet: 'tile_chest_single', x: 24, y: 0 },
          { sheet: 'tile_chest_single', x: 24, y: 16 },
          { sheet: 'tile_chest_single', x: 24, y: 32 },
          { sheet: 'tile_chest_single', x: 24, y: 48 },
        ] },
        up: { sameAs: 'north' },
        down: { sameAs: 'south' },
      },
    },
    tile_chest_single_open: {
      material_slots: { 1: 'WOOD_LIVE', 2: 'BRONZE', 3: 'IRON_PALE' },
      views: {
        north: { weights: [
          { sheet: 'tile_chest_single', x: 36, y: 0 },
          { sheet: 'tile_chest_single', x: 36, y: 16 },
          { sheet: 'tile_chest_single', x: 36, y: 32 },
          { sheet: 'tile_chest_single', x: 36, y: 48 },
        ] },
        east: { weights: [
          { sheet: 'tile_chest_single', x: 48, y: 0 },
          { sheet: 'tile_chest_single', x: 48, y: 16 },
          { sheet: 'tile_chest_single', x: 48, y: 32 },
          { sheet: 'tile_chest_single', x: 48, y: 48 },
        ] },
        west: { sameAs: 'east' },
        south: { weights: [
          { sheet: 'tile_chest_single', x: 60, y: 0 },
          { sheet: 'tile_chest_single', x: 60, y: 16 },
          { sheet: 'tile_chest_single', x: 60, y: 32 },
          { sheet: 'tile_chest_single', x: 60, y: 48 },
        ] },
        up: { sameAs: 'north' },
        down: { sameAs: 'south' },
      },
    },
    ...Object.fromEntries(
      Object.entries(STONE_BRICK_VARIANT_FRAMES).map(([graphic_id, frame]) => [
        graphic_id,
        make_cardinal_shared_tile('tile_stone_bricks', frame.col, frame.row_in_group, { 1: 'STONE_PALE' }),
      ]),
    ),
  },
};

const FAMILY_BY_NAME = new Map<string, AtlasFamilyManifest>([
  [TERRAIN_FAMILY.family, TERRAIN_FAMILY],
]);

const FAMILY_FOR_GRAPHIC_PREFIX: Array<{ prefix: string; family: string }> = [
  { prefix: 'tile_', family: 'terrain' },
  { prefix: 'item_', family: 'terrain' },
  { prefix: 'character_', family: 'terrain' },
];

type LoadedSheet = {
  image: HTMLImageElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
};

const sheetPromiseCache = new Map<string, Promise<LoadedSheet | null>>();
const sheetCache = new Map<string, LoadedSheet | null>();
const tintedFrameCache = new Map<string, HTMLCanvasElement>();
const resolvedFramePromiseCache = new Map<string, Promise<ResolvedAtlasFrame | null>>();
const resolvedFrameCache = new Map<string, ResolvedAtlasFrame | null>();
const loggedAtlasSheetEvents = new Set<string>();

type DecodedSpritePixel =
  | { kind: 'override'; override: 'black' | 'white' }
  | { kind: 'band'; band: 1 | 2 | 3; value: SemanticValue; source_role: 'main' }
  | { kind: 'interpolated_band'; band: 1 | 2 | 3; lower: SemanticValue; upper: SemanticValue; mix: number };

type SourcePaletteEntry = {
  rgb: { r: number; g: number; b: number };
  decoded: DecodedSpritePixel;
};

const ATLAS_SOURCE_VALUE_PALETTE: readonly SourcePaletteEntry[] = [
  { rgb: { r: 0, g: 0, b: 0 }, decoded: { kind: 'override', override: 'black' } },
  { rgb: { r: 255, g: 255, b: 255 }, decoded: { kind: 'override', override: 'white' } },
  { rgb: { r: 74, g: 40, b: 40 }, decoded: { kind: 'band', band: 1, value: 'darkest', source_role: 'main' } },
  { rgb: { r: 40, g: 74, b: 40 }, decoded: { kind: 'band', band: 2, value: 'darkest', source_role: 'main' } },
  { rgb: { r: 40, g: 40, b: 74 }, decoded: { kind: 'band', band: 3, value: 'darkest', source_role: 'main' } },
  { rgb: { r: 104, g: 56, b: 56 }, decoded: { kind: 'interpolated_band', band: 1, lower: 'darkest', upper: '2nd_darkest', mix: 0.5 } },
  { rgb: { r: 56, g: 104, b: 56 }, decoded: { kind: 'interpolated_band', band: 2, lower: 'darkest', upper: '2nd_darkest', mix: 0.5 } },
  { rgb: { r: 56, g: 56, b: 104 }, decoded: { kind: 'interpolated_band', band: 3, lower: 'darkest', upper: '2nd_darkest', mix: 0.5 } },
  { rgb: { r: 133, g: 71, b: 71 }, decoded: { kind: 'band', band: 1, value: '2nd_darkest', source_role: 'main' } },
  { rgb: { r: 71, g: 133, b: 71 }, decoded: { kind: 'band', band: 2, value: '2nd_darkest', source_role: 'main' } },
  { rgb: { r: 71, g: 71, b: 133 }, decoded: { kind: 'band', band: 3, value: '2nd_darkest', source_role: 'main' } },
  { rgb: { r: 178, g: 96, b: 96 }, decoded: { kind: 'interpolated_band', band: 1, lower: '2nd_darkest', upper: '2nd_lightest', mix: 0.5 } },
  { rgb: { r: 96, g: 178, b: 96 }, decoded: { kind: 'interpolated_band', band: 2, lower: '2nd_darkest', upper: '2nd_lightest', mix: 0.5 } },
  { rgb: { r: 96, g: 96, b: 178 }, decoded: { kind: 'interpolated_band', band: 3, lower: '2nd_darkest', upper: '2nd_lightest', mix: 0.5 } },
  { rgb: { r: 223, g: 121, b: 121 }, decoded: { kind: 'band', band: 1, value: '2nd_lightest', source_role: 'main' } },
  { rgb: { r: 121, g: 223, b: 121 }, decoded: { kind: 'band', band: 2, value: '2nd_lightest', source_role: 'main' } },
  { rgb: { r: 121, g: 121, b: 223 }, decoded: { kind: 'band', band: 3, value: '2nd_lightest', source_role: 'main' } },
  { rgb: { r: 235, g: 170, b: 170 }, decoded: { kind: 'interpolated_band', band: 1, lower: '2nd_lightest', upper: 'lightest', mix: 0.5 } },
  { rgb: { r: 170, g: 235, b: 170 }, decoded: { kind: 'interpolated_band', band: 2, lower: '2nd_lightest', upper: 'lightest', mix: 0.5 } },
  { rgb: { r: 170, g: 170, b: 235 }, decoded: { kind: 'interpolated_band', band: 3, lower: '2nd_lightest', upper: 'lightest', mix: 0.5 } },
  { rgb: { r: 246, g: 218, b: 218 }, decoded: { kind: 'band', band: 1, value: 'lightest', source_role: 'main' } },
  { rgb: { r: 218, g: 246, b: 218 }, decoded: { kind: 'band', band: 2, value: 'lightest', source_role: 'main' } },
  { rgb: { r: 218, g: 218, b: 246 }, decoded: { kind: 'band', band: 3, value: 'lightest', source_role: 'main' } },
];

const DECODED_SPRITE_PIXEL_BY_RGB = new Map<string, DecodedSpritePixel>(
  ATLAS_SOURCE_VALUE_PALETTE.map((entry) => [`${entry.rgb.r},${entry.rgb.g},${entry.rgb.b}`, entry.decoded]),
);

function resolve_family_name_for_graphic(graphic_id: string): string | null {
  for (const entry of FAMILY_FOR_GRAPHIC_PREFIX) {
    if (graphic_id.startsWith(entry.prefix)) return entry.family;
  }
  return null;
}

function get_family_for_graphic(graphic_id: string): AtlasFamilyManifest | null {
  const family_name = resolve_family_name_for_graphic(graphic_id);
  if (!family_name) return null;
  return FAMILY_BY_NAME.get(family_name) ?? null;
}

function resolve_view_entry(tile: AtlasTileEntry, view_direction: ViewDirection): { weights: [AtlasWeightFrameRef, AtlasWeightFrameRef, AtlasWeightFrameRef, AtlasWeightFrameRef] } | null {
  let current: ViewDirection = view_direction;
  const seen = new Set<ViewDirection>();
  while (!seen.has(current)) {
    seen.add(current);
    const entry = tile.views[current];
    if (!entry) return null;
    if ('weights' in entry) return entry;
    current = entry.sameAs;
  }
  return null;
}

function rotate_relative_view(view_direction: ViewDirection, facing: ViewDirection | undefined): ViewDirection {
  if (!facing || facing === 'north' || facing === 'up' || facing === 'down') return view_direction;
  if (view_direction === 'up' || view_direction === 'down') return view_direction;
  const dirs: ViewDirection[] = ['north', 'east', 'south', 'west'];
  const facingIndex = dirs.indexOf(facing);
  const viewIndex = dirs.indexOf(view_direction);
  if (facingIndex < 0 || viewIndex < 0) return view_direction;
  const relative = (viewIndex - facingIndex + 4) % 4;
  return dirs[relative] ?? view_direction;
}

function ensure_sheet_loaded(src: string): Promise<LoadedSheet | null> {
  const cached = sheetCache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = sheetPromiseCache.get(src);
  if (pending) return pending;

  const promise = new Promise<LoadedSheet | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      if (!loggedAtlasSheetEvents.has(`ok:${src}`)) {
        loggedAtlasSheetEvents.add(`ok:${src}`);
        console.log('[atlas debug] sheet loaded', { src, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
      }
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        sheetCache.set(src, null);
        resolve(null);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      const loaded = { image, canvas, ctx };
      sheetCache.set(src, loaded);
      resolve(loaded);
    };
    image.onerror = () => {
      if (!loggedAtlasSheetEvents.has(`error:${src}`)) {
        loggedAtlasSheetEvents.add(`error:${src}`);
        console.warn('[atlas debug] sheet failed to load', { src });
      }
      sheetCache.set(src, null);
      resolve(null);
    };
    image.src = src;
  });

  sheetPromiseCache.set(src, promise);
  return promise;
}

function decode_sprite_pixel(r: number, g: number, b: number): DecodedSpritePixel | null {
  return DECODED_SPRITE_PIXEL_BY_RGB.get(`${r},${g},${b}`) ?? null;
}

function blend_channel(a: number, b: number, mix: number): number {
  return Math.max(0, Math.min(255, Math.round((a * (1 - mix)) + (b * mix))));
}

function resolve_decoded_band_rgb(decoded: Extract<DecodedSpritePixel, { kind: 'band' | 'interpolated_band' }>, materials: InlineMaterialAssignments, light_mag: number) {
  const material_id = materials[decoded.band] ?? materials[1];
  if (decoded.kind === 'band') {
    const lit_value = project_lit_semantic_value(decoded.value, light_mag);
    const resolved = resolve_material_rgb(material_id, lit_value);
    return resolved ? nearest_indexed_rgb(resolved) : null;
  }
  const lower_value = project_lit_semantic_value(decoded.lower, light_mag);
  const upper_value = project_lit_semantic_value(decoded.upper, light_mag);
  const lower_rgb = resolve_material_rgb(material_id, lower_value);
  const upper_rgb = resolve_material_rgb(material_id, upper_value);
  if (!lower_rgb || !upper_rgb) return null;
  return nearest_indexed_rgb({
    r: blend_channel(lower_rgb.r, upper_rgb.r, decoded.mix),
    g: blend_channel(lower_rgb.g, upper_rgb.g, decoded.mix),
    b: blend_channel(lower_rgb.b, upper_rgb.b, decoded.mix),
  });
}

function render_tinted_frame(sheet: LoadedSheet, frame: AtlasWeightFrameRef, graphic: RenderGraphicRef, materials: InlineMaterialAssignments, family: AtlasFamilyManifest, light_mag?: number): HTMLCanvasElement {
  const resolved_light_mag = resolve_light_mag(light_mag);
  const cache_key = JSON.stringify([frame.sheet, frame.x, frame.y, graphic.graphic_id, graphic.weight_index, graphic.view_direction, materials, resolved_light_mag]);
  const cached = tintedFrameCache.get(cache_key);
  if (cached) return cached;

  const frame_canvas = document.createElement('canvas');
  frame_canvas.width = family.cellWidth;
  frame_canvas.height = family.cellHeight;
  const frame_ctx = frame_canvas.getContext('2d', { willReadFrequently: true });
  if (!frame_ctx) return frame_canvas;

  frame_ctx.clearRect(0, 0, frame_canvas.width, frame_canvas.height);
  frame_ctx.drawImage(
    sheet.canvas,
    frame.x,
    frame.y,
    family.cellWidth,
    family.cellHeight,
    0,
    0,
    family.cellWidth,
    family.cellHeight,
  );
  const image = frame_ctx.getImageData(0, 0, frame_canvas.width, frame_canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? 0;
    if (alpha <= 0) continue;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const decoded = decode_sprite_pixel(r, g, b);
    if (!decoded) continue;
    if (decoded.kind === 'override') {
      const override_rgb = decoded.override === 'white' ? get_brightest_indexed_rgb() : get_darkest_indexed_rgb();
      data[i] = override_rgb.r;
      data[i + 1] = override_rgb.g;
      data[i + 2] = override_rgb.b;
      continue;
    }
    const resolved = resolve_decoded_band_rgb(decoded, materials, resolved_light_mag);
    if (!resolved) continue;
    data[i] = resolved.r;
    data[i + 1] = resolved.g;
    data[i + 2] = resolved.b;
  }
  frame_ctx.putImageData(image, 0, 0);
  tintedFrameCache.set(cache_key, frame_canvas);
  return frame_canvas;
}

export type ResolvedAtlasFrame = {
  family: AtlasFamilyManifest;
  frame: AtlasWeightFrameRef;
  image: HTMLCanvasElement;
};

function make_resolved_frame_key(graphic: RenderGraphicRef, materials: InlineMaterialAssignments, light_mag?: number): string {
  return JSON.stringify([graphic.graphic_id, graphic.weight_index, graphic.view_direction, graphic.facing ?? null, materials, resolve_light_mag(light_mag)]);
}

export async function load_resolved_atlas_frame(graphic: RenderGraphicRef, materials: InlineMaterialAssignments, light_mag?: number): Promise<ResolvedAtlasFrame | null> {
  const cache_key = make_resolved_frame_key(graphic, materials, light_mag);
  const cached = resolvedFrameCache.get(cache_key);
  if (cached !== undefined) return cached;
  const pending = resolvedFramePromiseCache.get(cache_key);
  if (pending) return pending;

  const promise = (async (): Promise<ResolvedAtlasFrame | null> => {
  const family = get_family_for_graphic(graphic.graphic_id);
  if (!family) return null;
  const tile = family.tiles[graphic.graphic_id];
  if (!tile) return null;
  const view_entry = resolve_view_entry(tile, rotate_relative_view(graphic.view_direction, graphic.facing));
  if (!view_entry) return null;
  const frame = view_entry.weights[graphic.weight_index];
  if (!frame) return null;
  const sheet_ref = family.sheets.find((entry) => entry.id === frame.sheet) ?? null;
  if (!sheet_ref) return null;
  const loaded = await ensure_sheet_loaded(sheet_ref.src);
  if (!loaded) return null;
  const image = render_tinted_frame(loaded, frame, graphic, { ...tile.material_slots, ...materials }, family, light_mag);
    return { family, frame, image };
  })();

  resolvedFramePromiseCache.set(cache_key, promise);
  const resolved = await promise;
  resolvedFrameCache.set(cache_key, resolved);
  resolvedFramePromiseCache.delete(cache_key);
  return resolved;
}

export function get_cached_resolved_atlas_frame(graphic: RenderGraphicRef, materials: InlineMaterialAssignments, light_mag?: number): ResolvedAtlasFrame | null | undefined {
  return resolvedFrameCache.get(make_resolved_frame_key(graphic, materials, light_mag));
}

export function get_known_atlas_family_ids(): string[] {
  return Array.from(FAMILY_BY_NAME.keys());
}
