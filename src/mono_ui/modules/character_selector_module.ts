/**
 * ASCII Character Selector Module
 *
 * A floating, movable module showing a sectioned catalog of supported glyphs
 * for the painter. Layout is config-driven so section ordering and glyph
 * ordering can be reshuffled without rewriting rendering logic.
 */

import type { Canvas, Module, Rect, PointerEvent, WheelEvent, Rgb } from '../types.js';
import { get_color_by_name } from '../colors.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';

export type CharacterSelectorOptions = {
  id: string;
  rect: Rect;
  selected_char?: string;
  get_selected_char?: () => string;
  get_left_selected_char?: () => string;
  get_right_selected_char?: () => string;
  get_left_rgb?: () => Rgb;
  get_right_rgb?: () => Rgb;
  get_left_weight_index?: () => number;
  get_right_weight_index?: () => number;
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

type SelectorRow =
  | { kind: 'text'; text: string; rgb: Rgb; weight_index: number }
  | { kind: 'glyphs'; label: string; chars: string[]; style: 'compact' | 'recent' };

type GlyphHitbox = {
  x0: number;
  x1: number;
  y: number;
  char: string;
};

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

function build_selector_rows(rect: Rect, recent_chars: string[]): SelectorRow[] {
  const rows: SelectorRow[] = [];
  if (recent_chars.length > 0) {
    push_recent_rows(rows, recent_chars, rect);
  }
  rows.push({ kind: 'text', text: '', rgb: get_color_by_name('off_black').rgb, weight_index: 1 });

  for (const section of CHARACTER_SECTIONS) {
    rows.push({ kind: 'text', text: `[${section.label}]`, rgb: get_color_by_name('vivid_blue').rgb, weight_index: 5 });
    if (section.layout === 'borders') {
      rows.push({ kind: 'text', text: 'SETS', rgb: get_color_by_name('pale_yellow').rgb, weight_index: 4 });
      for (const group of BORDER_SHOWCASE_GROUPS) push_showcase_rows(rows, group.label, group.chars, rect);
      rows.push({ kind: 'text', text: 'ALL', rgb: get_color_by_name('medium_gray').rgb, weight_index: 3 });
      push_grid_rows(rows, section.chars, rect);
    } else if (section.layout === 'blocks') {
      rows.push({ kind: 'text', text: 'SETS', rgb: get_color_by_name('pale_yellow').rgb, weight_index: 4 });
      for (const group of BLOCK_SHOWCASE_GROUPS) push_showcase_rows(rows, group.label, group.chars, rect);
      rows.push({ kind: 'text', text: 'ALL', rgb: get_color_by_name('medium_gray').rgb, weight_index: 3 });
      push_grid_rows(rows, section.chars, rect);
    } else {
      push_grid_rows(rows, section.chars, rect);
    }
    for (let i = 0; i < SECTION_SPACING_ROWS; i += 1) {
      rows.push({ kind: 'text', text: '', rgb: get_color_by_name('off_black').rgb, weight_index: 1 });
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
    return { rgb: get_color_by_name('off_white').rgb, weight_index: 4 };
  }
  return { rgb: get_color_by_name('medium_gray').rgb, weight_index: neutral_weight_index };
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
  const recent_chars: string[] = [selected_char];
  let last_hitboxes: GlyphHitbox[] = [];
  let last_selected_side: 'left' | 'right' = 'left';

  function get_rows(rect: Rect): SelectorRow[] {
    return build_selector_rows(rect, recent_chars);
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
    last_selected_side = button === 2 ? 'right' : 'left';
    push_recent_char(recent_chars, char);
    opts.on_char_select(char, button);
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: 'CHARS',
    gizmos: gizmo_config,
    background: { rgb: get_color_by_name('off_black').rgb },
    resize: {
      min_width: MIN_WIDTH,
      min_height: MIN_HEIGHT,
      max_width: MAX_WIDTH,
      max_height: MAX_HEIGHT,
    },
    draw_content(c: Canvas, rect: Rect): void {
      selected_char = opts.get_selected_char?.() ?? selected_char;
      const left_selected_char = opts.get_left_selected_char?.() ?? selected_char;
      const right_selected_char = opts.get_right_selected_char?.() ?? selected_char;
      const left_rgb = opts.get_left_rgb?.() ?? get_color_by_name('vivid_blue').rgb;
      const right_rgb = opts.get_right_rgb?.() ?? get_color_by_name('vivid_red').rgb;
      const left_weight_index = opts.get_left_weight_index?.() ?? 4;
      const right_weight_index = opts.get_right_weight_index?.() ?? 4;
      const neutral_weight_index = last_selected_side === 'right' ? right_weight_index : left_weight_index;
      const use_left_flash = Math.floor(Date.now() / 400) % 2 === 0;
      const rows = clamp_scroll(rect);
      const { top, visible_rows } = get_content_bounds(rect);
      const bg_color = get_color_by_name('off_black').rgb;
      const label_rgb = get_color_by_name('medium_gray').rgb;
      const marker_left_rgb = get_color_by_name('vivid_blue').rgb;
      const marker_right_rgb = get_color_by_name('vivid_red').rgb;
      const marker_both_rgb = get_color_by_name('vivid_yellow').rgb;

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
            const bracket_rgb = char === selected_char ? get_color_by_name('vivid_yellow').rgb : label_rgb;
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
            last_hitboxes.push({ x0: x, x1: x + 3, y, char });
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
          last_hitboxes.push({ x0: x, x1: x + 1, y, char });
        }
      }

      if (rows.length > visible_rows) {
        const max_scroll = Math.max(1, rows.length - visible_rows);
        const scroll_percent = scroll_offset / max_scroll;
        const indicator_y = top - Math.floor(scroll_percent * Math.max(0, visible_rows - 1));
        c.set(rect.x1 - 1, indicator_y, {
          char: '│',
          rgb: get_color_by_name('pale_yellow').rgb,
          style: 'regular',
          weight_index: 2,
        });
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const hit = last_hitboxes.find((entry) => entry.y === e.y && e.x >= entry.x0 && e.x <= entry.x1);
      if (!hit) return;
      select_char(hit.char, e.button);
    },
    on_wheel_content(e: WheelEvent, rect: Rect): void {
      scroll_offset += e.delta_y > 0 ? WHEEL_ROWS : e.delta_y < 0 ? -WHEEL_ROWS : 0;
      clamp_scroll(rect);
    },
  });
}
