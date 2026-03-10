import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'jsonc-parser';

import { get_data_slot_dir } from '../src/engine/paths.js';

type Finding = { filePath: string; jsonPath: string; key: string };

function arg_value(prefix: string): string | null {
  const a = process.argv.find((x) => x.startsWith(prefix));
  if (!a) return null;
  const v = a.slice(prefix.length);
  return v.length > 0 ? v : null;
}

function read_jsonc(filePath: string): any {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parse(raw);
}

function list_jsonc_files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonc'))
    .map((f) => path.join(dir, f));
}

const FORBIDDEN_INLINE_ITEM_KEYS = new Set(['name', 'weight', 'unit_weight', 'tags', 'display_char']);
const FORBIDDEN_TILE_KEYS = new Set(['tags', 'display_char', 'display_color', 'container_glyphs', 'walkable', 'blocks_sight', 'blocks_sound']);

function is_obj(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function check_inline_item_tree(node: any, basePath: string, findings: Finding[], filePath: string): void {
  const visit = (it: any, p: string) => {
    if (!is_obj(it)) return;
    for (const k of Object.keys(it)) {
      if (FORBIDDEN_INLINE_ITEM_KEYS.has(k)) {
        findings.push({ filePath, jsonPath: p, key: k });
      }
    }
    if (Array.isArray((it as any).contents)) {
      for (let i = 0; i < (it as any).contents.length; i++) {
        visit((it as any).contents[i], `${p}.contents[${i}]`);
      }
    }
  };

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) visit(node[i], `${basePath}[${i}]`);
    return;
  }
  visit(node, basePath);
}

function check_place_tiles(tiles_obj: any, basePath: string, findings: Finding[], filePath: string): void {
  if (!tiles_obj || !Array.isArray(tiles_obj.cells)) return;
  for (let y = 0; y < tiles_obj.cells.length; y++) {
    const row = tiles_obj.cells[y];
    if (!Array.isArray(row)) continue;
    for (let x = 0; x < row.length; x++) {
      const tile = row[x];
      if (!tile) continue;
      if (!is_obj(tile)) continue;
      const tilePath = `${basePath}.cells[${y}][${x}]`;
      for (const k of Object.keys(tile)) {
        if (FORBIDDEN_TILE_KEYS.has(k)) {
          findings.push({ filePath, jsonPath: tilePath, key: k });
        }
      }
      if (Array.isArray((tile as any).contents)) {
        check_inline_item_tree((tile as any).contents, `${tilePath}.contents`, findings, filePath);
      }
    }
  }
}

const slot_raw = arg_value('--slot=');
const slot = slot_raw ? Number(slot_raw) : 1;
if (!Number.isFinite(slot) || slot <= 0) {
  console.error(`[check_defs_deltas_clean] invalid --slot (${slot_raw ?? 'missing'})`);
  process.exit(1);
}

const slot_dir = get_data_slot_dir(slot);
const actors_dir = path.join(slot_dir, 'actors');
const places_dir = path.join(slot_dir, 'places');

const findings: Finding[] = [];

for (const filePath of list_jsonc_files(actors_dir)) {
  try {
    const actor = read_jsonc(filePath);
    const body_slots = (actor as any)?.body_slots;
    if (body_slots && typeof body_slots === 'object') {
      for (const [slotName, slot] of Object.entries(body_slots)) {
        const s: any = slot as any;
        check_inline_item_tree(s?.armor, `body_slots.${slotName}.armor`, findings, filePath);
        check_inline_item_tree(s?.tool, `body_slots.${slotName}.tool`, findings, filePath);
        if (Array.isArray(s?.garb)) check_inline_item_tree(s.garb, `body_slots.${slotName}.garb`, findings, filePath);
      }
    }
  } catch (err) {
    console.error(`[check_defs_deltas_clean] failed actor ${filePath}:`, err);
    process.exitCode = 2;
  }
}

for (const filePath of list_jsonc_files(places_dir)) {
  try {
    const place = read_jsonc(filePath);
    const g = (place as any)?.ground;
    if (g) {
      if (Array.isArray(g.main)) check_inline_item_tree(g.main, 'ground.main', findings, filePath);
      if (g.scattered && typeof g.scattered === 'object') {
        for (const [k, items] of Object.entries(g.scattered)) {
          if (Array.isArray(items)) check_inline_item_tree(items, `ground.scattered.${k}`, findings, filePath);
        }
      }
    }

    check_place_tiles((place as any).tiles_z0, 'tiles_z0', findings, filePath);
    check_place_tiles((place as any).tiles, 'tiles', findings, filePath);
  } catch (err) {
    console.error(`[check_defs_deltas_clean] failed place ${filePath}:`, err);
    process.exitCode = 2;
  }
}

if (findings.length > 0) {
  console.error(`[check_defs_deltas_clean] FAIL: found ${findings.length} legacy/derived fields persisted`);
  for (const f of findings.slice(0, 60)) {
    console.error(`- ${f.filePath} :: ${f.jsonPath} has forbidden key '${f.key}'`);
  }
  if (findings.length > 60) {
    console.error(`... plus ${findings.length - 60} more`);
  }
  process.exit(1);
}

console.log(`[check_defs_deltas_clean] OK: slot=${slot} (no forbidden inline/tile fields found)`);
