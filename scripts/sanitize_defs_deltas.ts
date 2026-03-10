import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'jsonc-parser';

import { get_data_slot_dir } from '../src/engine/paths.js';
import { sanitize_actor_for_save, sanitize_place_for_save } from '../src/shared/defs_deltas_sanitize.js';

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

function write_json(filePath: string, data: any): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function list_jsonc_files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonc'))
    .map((f) => path.join(dir, f));
}

const slot_raw = arg_value('--slot=');
const slot = slot_raw ? Number(slot_raw) : 1;
if (!Number.isFinite(slot) || slot <= 0) {
  console.error(`[sanitize_defs_deltas] invalid --slot (${slot_raw ?? 'missing'})`);
  process.exit(1);
}

const slot_dir = get_data_slot_dir(slot);
const actors_dir = path.join(slot_dir, 'actors');
const places_dir = path.join(slot_dir, 'places');

let actors = 0;
let places = 0;

for (const filePath of list_jsonc_files(actors_dir)) {
  try {
    const actor = read_jsonc(filePath);
    sanitize_actor_for_save(actor);
    write_json(filePath, actor);
    actors++;
  } catch (err) {
    console.error(`[sanitize_defs_deltas] failed actor ${filePath}:`, err);
  }
}

for (const filePath of list_jsonc_files(places_dir)) {
  try {
    const place = read_jsonc(filePath);
    sanitize_place_for_save(place);
    write_json(filePath, place);
    places++;
  } catch (err) {
    console.error(`[sanitize_defs_deltas] failed place ${filePath}:`, err);
  }
}

console.log(`[sanitize_defs_deltas] done slot=${slot} actors=${actors} places=${places}`);
