/**
 * ASCII Character Selector Module
 *
 * A floating, movable module showing a sectioned catalog of supported glyphs
 * for the painter. Layout is config-driven so section ordering and glyph
 * ordering can be reshuffled without rewriting rendering logic.
 */

import type { Canvas, Module, Rect, PointerEvent, WheelEvent, Rgb } from '../types.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { get_ui_semantic_rgb } from '../runtime/ui_customization_store.js';
import type { GradiatorState, GradiatorSlot } from '../../ascii_painter/gradiator.js';
import { getSafeGradiatorSlot } from '../../ascii_painter/gradiator.js';
import type { AppearanceSlotAssignments, InlineMaterialAssignments, RenderGraphicRef } from '../../render_shaders/graphics_contract.js';
import { get_atlas_graphic_catalog, type AtlasGraphicCatalogEntry } from '../runtime/atlas_runtime.js';
import { make_floating_panel_module } from './floating_panel_module.js';

export type CharacterSelectorOptions = {
  id: string;
  rect: Rect;
  selected_char?: string;
  get_selected_char?: () => string;
  get_selected_visual_key?: () => string;
  get_left_selected_char?: () => string;
  get_right_selected_char?: () => string;
  get_left_selected_visual_key?: () => string;
  get_right_selected_visual_key?: () => string;
  get_left_rgb?: () => Rgb;
  get_right_rgb?: () => Rgb;
  get_left_weight_index?: () => number;
  get_right_weight_index?: () => number;
  get_gradiator_state?: () => GradiatorState;
  on_gradiator_slot_select?: (slot: GradiatorSlot) => void;
  on_gradiator_char_select?: (slot: GradiatorSlot, x: number) => void;
  on_gradiator_add_char?: (slot: GradiatorSlot) => void;
  on_gradiator_remove_char?: (slot: GradiatorSlot) => void;
  on_visual_select?: (visual: VisualPickerEntry, button: number) => void;
  on_char_select: (char: string, button: number) => void;
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

type CharacterSectionLayout = 'grid' | 'borders' | 'blocks';

type CharacterSection = {
  id: string;
  label: string;
  chars: string[];
  layout: CharacterSectionLayout;
};

type ShowcaseGroup = {
  label: string;
  chars: string[];
};

export type VisualPickerEntry = {
  key: string;
  label: string;
  char: string;
  rgb: Rgb;
  weight_index: number;
  graphic?: RenderGraphicRef;
  appearance_slots?: AppearanceSlotAssignments;
  materials?: InlineMaterialAssignments;
};

type SelectorRow =
  | { kind: 'text'; text: string; rgb: Rgb; weight_index: number }
  | { kind: 'glyphs'; label: string; chars: string[]; style: 'compact' | 'recent' }
  | { kind: 'visuals'; label: string; entries: VisualPickerEntry[] }
  | { kind: 'gradiator'; slot: GradiatorSlot };

type SelectorHitbox =
  | { kind: 'glyph'; x0: number; x1: number; y: number; char: string }
  | { kind: 'visual'; x0: number; x1: number; y: number; entry: VisualPickerEntry }
  | { kind: 'gradiator_slot'; x0: number; x1: number; y: number; slot: GradiatorSlot }
  | { kind: 'gradiator_char'; x0: number; x1: number; y: number; slot: GradiatorSlot; char_x: number }
  | { kind: 'gradiator_add'; x0: number; x1: number; y: number; slot: GradiatorSlot }
  | { kind: 'gradiator_remove'; x0: number; x1: number; y: number; slot: GradiatorSlot };

const GLYPH_CELL_WIDTH = 3;
const RECENT_CELL_WIDTH = 5;
const LABEL_WIDTH = 10;
const RECENT_LIMIT = 12;
const SECTION_SPACING_ROWS = 1;
const WHEEL_ROWS = 3;

function chars_from_string(value: string): string[] {
  return Array.from(value);
}

function unique_chars(chars: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const char of chars) {
    if (seen.has(char)) continue;
    seen.add(char);
    result.push(char);
  }
  return result;
}

function make_section(id: string, label: string, chars: string, layout: CharacterSectionLayout = 'grid'): CharacterSection {
  return { id, label, chars: unique_chars(chars_from_string(chars)), layout };
}

const CHARACTER_SECTIONS: CharacterSection[] = [
  make_section('ascii', 'ASCII', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'),
  make_section('symbols', 'SYMBOLS', "!#%&$*@^?/\\|+×÷±¬§¶†‡©®™¢£¥€'\"`()[]{}⟦⟧⟨⟩⟪⟫⦇⦈⸨⸩⁅⁆‘’“”"),
  make_section('dots', 'DOTS', '.,:;·•●○…⦸⨀∘∙∴∵∶∷◌◍◎◐◑◒◓◔◕◖◗◘◙◚◛◜◝◞◟◠◡◉⁖⁘⁙⁚⁛⁜⁝⁞․‥‧⁂'),
  make_section('dashes', 'DASHES', '_-–—=~∼≃≋Ξ≠'),
  make_section('arrows', 'ARROWS', '‹›«»⟵⟶↔↕↜↝↞↠↢↣↤↦⇐⇑⇒⇓⇔⇚⇛⇦⇨←↑→↓'),
  make_section('borders', 'BORDERS', '━┃┏┓┗┛┣┫┳┻╋═║╔╗╚╝╠╣╦╩╬─│┌┐└┘├┤┬┴┼╞╟╡╢╤╥╧╨╪╫┍┎┑┒┕┖┙┚┝┞┟┠┡┢┥┦┧┨┩┪┭┮┯┰┱┲┵┶┷┸┹┺┽┾┿╀╁╂╃╄╅╆╇╈╉╊', 'borders'),
  make_section('blocks', 'BLOCKS', '█▓▒░▁▂▃▄▅▆▇▉▊▋▌▍▎▏▀▐▔▕▘▝▖▗🙼🙽🙾🙿▚▞▙▛▜▟■□▢▣▪▫▤▥▦▧▨▩▬▭▮▯▰▱◰◱◲◳◧◨◩◪◫◻◼◽◾╱╲╳⎺⎻⎼⎽∎', 'blocks'),
  make_section('latinext', 'LATINEXT', 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝŸÞŒŠŽŁßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýÿþœšžł'),
];

const BORDER_SHOWCASE_GROUPS: ShowcaseGroup[] = [
  { label: 'LIGHT', chars: chars_from_string('─│┌┐└┘├┤┬┴┼') },
  { label: 'HEAVY', chars: chars_from_string('━┃┏┓┗┛┣┫┳┻╋') },
  { label: 'DOUBLE', chars: chars_from_string('═║╔╗╚╝╠╣╦╩╬') },
  { label: 'MIXED', chars: chars_from_string('╞╟╡╢╤╥╧╨╪╫') },
  { label: 'EDGES', chars: chars_from_string('┍┎┑┒┕┖┙┚┭┮┯┰┱┲┵┶┷┸┹┺') },
  { label: 'JOINS', chars: chars_from_string('┝┞┟┠┡┢┥┦┧┨┩┪┽┾┿╀╁╂╃╄╅╆╇╈╉╊') },
];

const BLOCK_SHOWCASE_GROUPS: ShowcaseGroup[] = [
  { label: 'DENSE', chars: chars_from_string('░▒▓█') },
  { label: 'VERT', chars: chars_from_string('▁▂▃▄▅▆▇█') },
  { label: 'HORIZ', chars: chars_from_string('▏▎▍▌▋▊▉█') },
  { label: 'HALFS', chars: chars_from_string('▀▄▐▌▔▕') },
  { label: 'QUADS', chars: chars_from_string('▘▝▖▗🙼🙽🙾🙿') },
  { label: 'CUTS', chars: chars_from_string('▚▞╱╲╳') },
  { label: 'CORNRS', chars: chars_from_string('▙▛▜▟') },
  { label: 'SHAPES', chars: chars_from_string('■□▢▣▪▫▤▥▦▧▨▩▬▭▮▯▰▱◰◱◲◳◧◨◩◪◫◻◼◽◾⎺⎻⎼⎽∎') },
];

function humanize_graphic_id(graphic_id: string): string {
  const raw = graphic_id.replace(/^(tile|item|character|text)_/, '');
  return raw
    .split('_')
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function atlas_catalog_entry_to_visual(entry: AtlasGraphicCatalogEntry): VisualPickerEntry {
  const materials = entry.material_slots ? { ...entry.material_slots } : undefined;
  return {
    key: `graphic:${entry.graphic_id}`,
    label: humanize_graphic_id(entry.graphic_id),
    char: ' ',
    rgb: get_ui_semantic_rgb('medium'),
    weight_index: 2,
    graphic: { graphic_id: entry.graphic_id, view_direction: 'south', weight_index: 2 },
    materials,
  };
}

const GRAPHIC_CATALOG_BY_FAMILY = (() => {
  const grouped = new Map<string, VisualPickerEntry[]>();
  for (const entry of get_atlas_graphic_catalog()) {
    const list = grouped.get(entry.family) ?? [];
    list.push(atlas_catalog_entry_to_visual(entry));
    grouped.set(entry.family, list);
  }
  return Array.from(grouped.entries()).map(([family, entries]) => ({ family, entries }));
})();

function get_content_bounds(rect: Rect): { top: number; bottom: number; visible_rows: number } {
  const top = rect.y1 - 2;
  const bottom = rect.y0 + 1;
  return {
    top,
    bottom,
    visible_rows: Math.max(1, top - bottom + 1),
  };
}

function get_glyph_columns(rect: Rect, include_label: boolean): number {
  const inner_width = Math.max(1, rect.x1 - rect.x0 - 2);
  const reserved = include_label ? LABEL_WIDTH : 0;
  const glyph_width = Math.max(1, inner_width - reserved - 1);
  return Math.max(1, Math.floor(glyph_width / GLYPH_CELL_WIDTH));
}

function chunk_chars(chars: string[], columns: number): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < chars.length; i += columns) {
    rows.push(chars.slice(i, i + columns));
  }
  return rows;
}

function push_showcase_rows(rows: SelectorRow[], label: string, chars: string[], rect: Rect): void {
  const columns = get_glyph_columns(rect, true);
  const chunks = chunk_chars(chars, columns);
  for (let i = 0; i < chunks.length; i += 1) {
    rows.push({ kind: 'glyphs', label: i === 0 ? label : '', chars: chunks[i]!, style: 'compact' });
  }
}

function push_grid_rows(rows: SelectorRow[], chars: string[], rect: Rect): void {
  const columns = get_glyph_columns(rect, false);
  const chunks = chunk_chars(chars, columns);
  for (const chunk of chunks) {
    rows.push({ kind: 'glyphs', label: '', chars: chunk, style: 'compact' });
  }
}

function push_recent_rows(rows: SelectorRow[], recent_chars: string[], rect: Rect): void {
  const inner_width = Math.max(1, rect.x1 - rect.x0 - 2);
  const glyph_width = Math.max(1, inner_width - LABEL_WIDTH - 1);
  const columns = Math.max(1, Math.floor(glyph_width / RECENT_CELL_WIDTH));
  const chunks = chunk_chars(recent_chars.slice(0, RECENT_LIMIT), columns);
  for (let i = 0; i < chunks.length; i += 1) {
    rows.push({ kind: 'glyphs', label: i === 0 ? 'RECENT' : '', chars: chunks[i]!, style: 'recent' });
  }
}

function push_visual_rows(rows: SelectorRow[], label: string, entries: VisualPickerEntry[], rect: Rect): void {
  const columns = get_glyph_columns(rect, label.length > 0);
  for (let i = 0; i < entries.length; i += columns) {
    rows.push({
      kind: 'visuals',
      label: i === 0 ? label : '',
      entries: entries.slice(i, i + columns),
    });
  }
}

function build_selector_rows(rect: Rect, recent_chars: string[], gradiator_state?: GradiatorState | null): SelectorRow[] {
  const rows: SelectorRow[] = [];
  const bg = get_ui_semantic_rgb('background');
  const medium = get_ui_semantic_rgb('medium');
  const bright = get_ui_semantic_rgb('bright');
  const vivid = get_ui_semantic_rgb('vivid');
  if (gradiator_state) {
    rows.push({ kind: 'text', text: '[GRADIATOR]', rgb: bright, weight_index: 5 });
    rows.push({ kind: 'text', text: 'ramps for paste/convert', rgb: medium, weight_index: 2 });
    rows.push({ kind: 'gradiator', slot: 0 });
    rows.push({ kind: 'gradiator', slot: 1 });
    rows.push({ kind: 'gradiator', slot: 2 });
    rows.push({ kind: 'text', text: '', rgb: bg, weight_index: 1 });
  }
  rows.push({ kind: 'text', text: '[ATLAS TILES]', rgb: bright, weight_index: 5 });
  for (const family of GRAPHIC_CATALOG_BY_FAMILY) {
    push_visual_rows(rows, family.family.toUpperCase(), family.entries, rect);
  }
  rows.push({ kind: 'text', text: '', rgb: bg, weight_index: 1 });

  if (recent_chars.length > 0) {
    push_recent_rows(rows, recent_chars, rect);
  }
  rows.push({ kind: 'text', text: '', rgb: bg, weight_index: 1 });

  for (const section of CHARACTER_SECTIONS) {
    rows.push({ kind: 'text', text: `[${section.label}]`, rgb: bright, weight_index: 5 });
    if (section.layout === 'borders') {
      rows.push({ kind: 'text', text: 'SETS', rgb: vivid, weight_index: 4 });
      for (const group of BORDER_SHOWCASE_GROUPS) push_showcase_rows(rows, group.label, group.chars, rect);
      rows.push({ kind: 'text', text: 'ALL', rgb: medium, weight_index: 3 });
      push_grid_rows(rows, section.chars, rect);
    } else if (section.layout === 'blocks') {
      rows.push({ kind: 'text', text: 'SETS', rgb: vivid, weight_index: 4 });
      for (const group of BLOCK_SHOWCASE_GROUPS) push_showcase_rows(rows, group.label, group.chars, rect);
      rows.push({ kind: 'text', text: 'ALL', rgb: medium, weight_index: 3 });
      push_grid_rows(rows, section.chars, rect);
    } else {
      push_grid_rows(rows, section.chars, rect);
    }
    for (let i = 0; i < SECTION_SPACING_ROWS; i += 1) {
      rows.push({ kind: 'text', text: '', rgb: bg, weight_index: 1 });
    }
  }
  return rows;
}

function get_marker_char(char: string, left_char: string, right_char: string): string {
  if (char === left_char && char === right_char) return 'B';
  if (char === left_char) return 'L';
  if (char === right_char) return 'R';
  return ' ';
}

function get_marker_for_visual_key(key: string, left_key: string, right_key: string): string {
  if (key === left_key && key === right_key) return 'B';
  if (key === left_key) return 'L';
  if (key === right_key) return 'R';
  return ' ';
}

function get_glyph_style(
  char: string,
  selected_char: string,
  left_char: string,
  right_char: string,
  left_rgb: Rgb,
  right_rgb: Rgb,
  left_weight_index: number,
  right_weight_index: number,
  neutral_weight_index: number,
  use_left_flash: boolean,
): { rgb: Rgb; weight_index: number } {
  if (char === left_char && char === right_char) {
    return use_left_flash
      ? { rgb: left_rgb, weight_index: left_weight_index }
      : { rgb: right_rgb, weight_index: right_weight_index };
  }
  if (char === left_char) {
    return { rgb: left_rgb, weight_index: left_weight_index };
  }
  if (char === right_char) {
    return { rgb: right_rgb, weight_index: right_weight_index };
  }
  if (char === selected_char) {
    return { rgb: get_ui_semantic_rgb('bright'), weight_index: 4 };
  }
  return { rgb: get_ui_semantic_rgb('medium'), weight_index: neutral_weight_index };
}

function push_recent_char(recent_chars: string[], char: string): void {
  const next = [char, ...recent_chars.filter((entry) => entry !== char)];
  recent_chars.splice(0, recent_chars.length, ...next.slice(0, RECENT_LIMIT));
}

export function make_character_selector_module(opts: CharacterSelectorOptions): Module {
  const MIN_WIDTH = 18;
  const MAX_WIDTH = 60;
  const MIN_HEIGHT = 10;
  const MAX_HEIGHT = 40;

  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };

  let scroll_offset = 0;
  let selected_char = opts.selected_char ?? opts.get_selected_char?.() ?? '█';
  let selected_visual_key = opts.get_selected_visual_key?.() ?? `char:${selected_char}`;
  const recent_chars: string[] = selected_char === ' ' ? [] : [selected_char];
  let last_hitboxes: SelectorHitbox[] = [];
  let last_selected_side: 'left' | 'right' = 'left';

  function get_rows(rect: Rect): SelectorRow[] {
    return build_selector_rows(rect, recent_chars, opts.get_gradiator_state?.() ?? null);
  }

  function clamp_scroll(rect: Rect): SelectorRow[] {
    const rows = get_rows(rect);
    const { visible_rows } = get_content_bounds(rect);
    const max_scroll = Math.max(0, rows.length - visible_rows);
    scroll_offset = Math.max(0, Math.min(max_scroll, scroll_offset));
    return rows;
  }

  function select_char(char: string, button: number): void {
    selected_char = char;
    selected_visual_key = `char:${char}`;
    last_selected_side = button === 2 ? 'right' : 'left';
    push_recent_char(recent_chars, char);
    opts.on_char_select(char, button);
  }

  function select_visual(entry: VisualPickerEntry, button: number): void {
    if (!entry.graphic) selected_char = entry.char;
    selected_visual_key = entry.key;
    last_selected_side = button === 2 ? 'right' : 'left';
    if (!entry.graphic) push_recent_char(recent_chars, entry.char);
    if (opts.on_visual_select) opts.on_visual_select(entry, button);
    else opts.on_char_select(entry.char, button);
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: 'VISUALS',
    gizmos: gizmo_config,
    resize: {
      min_width: MIN_WIDTH,
      min_height: MIN_HEIGHT,
      max_width: MAX_WIDTH,
      max_height: MAX_HEIGHT,
    },
    draw_content(c: Canvas, rect: Rect): void {
      selected_char = opts.get_selected_char?.() ?? selected_char;
      selected_visual_key = opts.get_selected_visual_key?.() ?? selected_visual_key;
      const left_selected_char = opts.get_left_selected_char?.() ?? selected_char;
      const right_selected_char = opts.get_right_selected_char?.() ?? selected_char;
      const left_selected_visual_key = opts.get_left_selected_visual_key?.() ?? `char:${left_selected_char}`;
      const right_selected_visual_key = opts.get_right_selected_visual_key?.() ?? `char:${right_selected_char}`;
      const left_rgb = opts.get_left_rgb?.() ?? get_ui_semantic_rgb('left_hand');
      const right_rgb = opts.get_right_rgb?.() ?? get_ui_semantic_rgb('right_hand');
      const left_weight_index = opts.get_left_weight_index?.() ?? 4;
      const right_weight_index = opts.get_right_weight_index?.() ?? 4;
      const neutral_weight_index = last_selected_side === 'right' ? right_weight_index : left_weight_index;
      const use_left_flash = Math.floor(Date.now() / 400) % 2 === 0;
      const rows = clamp_scroll(rect);
      const { top, visible_rows } = get_content_bounds(rect);
      const bg_color = get_ui_semantic_rgb('background');
      const label_rgb = get_ui_semantic_rgb('medium');
      const marker_left_rgb = get_ui_semantic_rgb('left_hand');
      const marker_right_rgb = get_ui_semantic_rgb('right_hand');
      const marker_both_rgb = get_ui_semantic_rgb('vivid');

      last_hitboxes = [];
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });

      for (let visible_index = 0; visible_index < visible_rows; visible_index += 1) {
        const row = rows[scroll_offset + visible_index];
        const y = top - visible_index;
        if (!row) continue;

        if (row.kind === 'text') {
          for (let i = 0; i < row.text.length && rect.x0 + 2 + i < rect.x1; i += 1) {
            c.set(rect.x0 + 2 + i, y, {
              char: row.text[i]!,
              rgb: row.rgb,
              style: 'regular',
              weight_index: row.weight_index,
            });
          }
          continue;
        }

        if (row.kind === 'visuals') {
          const label_x = rect.x0 + 2;
          if (row.label.length > 0) {
            const label = row.label.padEnd(Math.max(0, LABEL_WIDTH - 1), ' ').slice(0, Math.max(0, LABEL_WIDTH - 1));
            for (let i = 0; i < label.length && label_x + i < rect.x1; i += 1) {
              c.set(label_x + i, y, {
                char: label[i]!,
                rgb: label_rgb,
                style: 'regular',
                weight_index: 3,
              });
            }
          }

          const glyph_start_x = rect.x0 + 2 + (row.label.length > 0 ? LABEL_WIDTH : 0);
          for (let i = 0; i < row.entries.length; i += 1) {
            const entry = row.entries[i]!;
            const marker = get_marker_for_visual_key(entry.key, left_selected_visual_key, right_selected_visual_key);
            const marker_rgb = marker === 'B'
              ? marker_both_rgb
              : marker === 'L'
                ? marker_left_rgb
                : marker === 'R'
                  ? marker_right_rgb
                  : label_rgb;
            const is_selected = entry.key === selected_visual_key;
            const x = glyph_start_x + (i * GLYPH_CELL_WIDTH);
            if (x + 1 >= rect.x1) break;
            c.set(x, y, {
              char: marker,
              rgb: marker_rgb,
              style: 'regular',
              weight_index: marker === ' ' ? 1 : 3,
            });
            c.set(x + 1, y, {
              char: entry.char,
              rgb: is_selected ? get_ui_semantic_rgb('bright') : entry.rgb,
              style: 'regular',
              weight_index: is_selected ? Math.max(3, entry.weight_index) : entry.weight_index,
              graphic: entry.graphic ? { ...entry.graphic } : undefined,
              appearance_slots: entry.appearance_slots,
              materials: entry.materials,
            });
            last_hitboxes.push({ kind: 'visual', x0: x, x1: x + 1, y, entry });
          }
          continue;
        }

        if (row.kind === 'gradiator') {
          const gradiator_state = opts.get_gradiator_state?.();
          if (!gradiator_state) continue;
          const slot = row.slot;
          const gradiator = getSafeGradiatorSlot(gradiator_state, slot);
          const is_active = slot === gradiator_state.activeSlot;
          const active_rgb = get_ui_semantic_rgb('vivid');
          const inactive_rgb = get_ui_semantic_rgb('medium');
          const slot_x0 = rect.x0 + 2;
          const slot_label = `G${slot + 1}`;
          for (let i = 0; i < slot_label.length && slot_x0 + i < rect.x1; i += 1) {
            c.set(slot_x0 + i, y, {
              char: slot_label[i]!,
              rgb: is_active ? active_rgb : inactive_rgb,
              style: 'regular',
              weight_index: is_active ? 3 : 2,
            });
          }
          last_hitboxes.push({ kind: 'gradiator_slot', x0: slot_x0, x1: slot_x0 + Math.max(1, slot_label.length - 1), y, slot });
          const open_x = rect.x0 + 5;
          c.set(open_x, y, { char: '[', rgb: get_ui_semantic_rgb('bright'), style: 'regular', weight_index: 2 });
          for (let x = 0; x < gradiator.length && x < 12; x += 1) {
            const char = gradiator[x]!;
            const is_selected = is_active && gradiator_state.isEditing && gradiator_state.editSlot === slot && x === gradiator_state.editCursorX;
            const glyph_x = open_x + 1 + x;
            c.set(glyph_x, y, {
              char,
              rgb: is_selected ? active_rgb : get_ui_semantic_rgb('bright'),
              style: is_selected ? 'reverse' : 'regular',
              weight_index: is_selected ? 3 : 2,
            });
            last_hitboxes.push({ kind: 'gradiator_char', x0: glyph_x, x1: glyph_x, y, slot, char_x: x });
          }
          const close_x = open_x + 1 + Math.min(gradiator.length, 12);
          c.set(close_x, y, { char: ']', rgb: get_ui_semantic_rgb('bright'), style: 'regular', weight_index: 2 });
          const add_x = close_x + 1;
          c.set(add_x, y, { char: '+', rgb: get_ui_semantic_rgb('vivid'), style: 'regular', weight_index: 3 });
          last_hitboxes.push({ kind: 'gradiator_add', x0: add_x, x1: add_x, y, slot });
          if (gradiator.length > 2) {
            const remove_x = add_x + 1;
            c.set(remove_x, y, { char: '-', rgb: get_ui_semantic_rgb('right_hand'), style: 'regular', weight_index: 3 });
            last_hitboxes.push({ kind: 'gradiator_remove', x0: remove_x, x1: remove_x, y, slot });
          }
          continue;
        }

        const label_x = rect.x0 + 2;
        if (row.label.length > 0) {
          const label = row.label.padEnd(Math.max(0, LABEL_WIDTH - 1), ' ').slice(0, Math.max(0, LABEL_WIDTH - 1));
          for (let i = 0; i < label.length && label_x + i < rect.x1; i += 1) {
            c.set(label_x + i, y, {
              char: label[i]!,
              rgb: label_rgb,
              style: 'regular',
              weight_index: 3,
            });
          }
        }

        const glyph_start_x = rect.x0 + 2 + (row.label.length > 0 ? LABEL_WIDTH : 0);
        for (let i = 0; i < row.chars.length; i += 1) {
          const char = row.chars[i]!;
          const marker = get_marker_char(char, left_selected_char, right_selected_char);
          const marker_rgb = marker === 'B'
            ? marker_both_rgb
            : marker === 'L'
              ? marker_left_rgb
              : marker === 'R'
                ? marker_right_rgb
                : label_rgb;
          const glyph_style = get_glyph_style(
            char,
            selected_char,
            left_selected_char,
            right_selected_char,
            left_rgb,
            right_rgb,
            left_weight_index,
            right_weight_index,
            neutral_weight_index,
            use_left_flash,
          );
          if (row.style === 'recent') {
            const x = glyph_start_x + (i * RECENT_CELL_WIDTH);
            if (x + 3 >= rect.x1) break;
            const bracket_rgb = char === selected_char ? get_ui_semantic_rgb('vivid') : label_rgb;
            c.set(x, y, {
              char: marker,
              rgb: marker_rgb,
              style: 'regular',
              weight_index: marker === ' ' ? 1 : 3,
            });
            c.set(x + 1, y, {
              char: '[',
              rgb: bracket_rgb,
              style: 'regular',
              weight_index: char === selected_char ? 3 : 2,
            });
            c.set(x + 2, y, {
              char,
              rgb: glyph_style.rgb,
              style: 'regular',
              weight_index: glyph_style.weight_index,
            });
            c.set(x + 3, y, {
              char: ']',
              rgb: bracket_rgb,
              style: 'regular',
              weight_index: char === selected_char ? 3 : 2,
            });
            last_hitboxes.push({ kind: 'glyph', x0: x, x1: x + 3, y, char });
            continue;
          }

          const x = glyph_start_x + (i * GLYPH_CELL_WIDTH);
          if (x + 1 >= rect.x1) break;
          c.set(x, y, {
            char: marker,
            rgb: marker_rgb,
            style: 'regular',
            weight_index: marker === ' ' ? 1 : 3,
          });
          c.set(x + 1, y, {
            char,
            rgb: glyph_style.rgb,
            style: 'regular',
            weight_index: glyph_style.weight_index,
          });
          last_hitboxes.push({ kind: 'glyph', x0: x, x1: x + 1, y, char });
        }
      }

      if (rows.length > visible_rows) {
        const max_scroll = Math.max(1, rows.length - visible_rows);
        const scroll_percent = scroll_offset / max_scroll;
        const indicator_y = top - Math.floor(scroll_percent * Math.max(0, visible_rows - 1));
        c.set(rect.x1 - 1, indicator_y, {
          char: '│',
          rgb: get_ui_semantic_rgb('bright'),
          style: 'regular',
          weight_index: 2,
        });
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const hit = last_hitboxes.find((entry) => entry.y === e.y && e.x >= entry.x0 && e.x <= entry.x1);
      if (!hit) return;
      if (hit.kind === 'glyph') {
        select_char(hit.char, e.button);
        return;
      }
      if (hit.kind === 'visual') {
        select_visual(hit.entry, e.button);
        return;
      }
      if (hit.kind === 'gradiator_slot') {
        opts.on_gradiator_slot_select?.(hit.slot);
        return;
      }
      if (hit.kind === 'gradiator_char') {
        opts.on_gradiator_char_select?.(hit.slot, hit.char_x);
        return;
      }
      if (hit.kind === 'gradiator_add') {
        opts.on_gradiator_add_char?.(hit.slot);
        return;
      }
      if (hit.kind === 'gradiator_remove') {
        opts.on_gradiator_remove_char?.(hit.slot);
        return;
      }
    },
    on_wheel_content(e: WheelEvent, rect: Rect): void {
      scroll_offset += e.delta_y > 0 ? WHEEL_ROWS : e.delta_y < 0 ? -WHEEL_ROWS : 0;
      clamp_scroll(rect);
    },
  });
}
