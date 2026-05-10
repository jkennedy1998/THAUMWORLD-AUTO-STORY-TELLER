import assert from 'node:assert/strict';

import {
  build_default_indexed_palette_state,
  delete_indexed_palette_entry,
  duplicate_indexed_palette_entry,
  get_indexed_palette_state,
  reorder_indexed_palette_entries,
  reset_indexed_palette_state,
  update_indexed_palette_entry_rgb,
} from './indexed_palette_store.js';
import { find_indexed_color_by_rgb, list_active_indexed_colors } from '../colors.js';

function run(): void {
  const defaults = reset_indexed_palette_state();
  assert.equal(defaults.entries.length > 0, true);

  const first = defaults.entries[0]!;
  const updated = update_indexed_palette_entry_rgb(first.id, { r: 1, g: 2, b: 3 });
  assert.deepEqual(updated.entries[0]!.rgb, { r: 1, g: 2, b: 3 });
  assert.equal(find_indexed_color_by_rgb({ r: 1, g: 2, b: 3 })?.id, first.id);

  const duplicated = duplicate_indexed_palette_entry(first.id);
  assert.equal(duplicated.entries.length, defaults.entries.length + 1);
  assert.deepEqual(duplicated.entries[1]!.rgb, { r: 1, g: 2, b: 3 });

  const reordered = reorder_indexed_palette_entries([duplicated.entries[1]!.id, duplicated.entries[0]!.id, ...duplicated.entries.slice(2).map((entry) => entry.id)]);
  assert.equal(reordered.entries[0]!.id, duplicated.entries[1]!.id);

  const deleted = delete_indexed_palette_entry(reordered.entries[0]!.id);
  assert.equal(deleted.entries.length, duplicated.entries.length - 1);

  const active = list_active_indexed_colors();
  assert.equal(active.length, get_indexed_palette_state().entries.length);

  const rebuilt = build_default_indexed_palette_state();
  assert.equal(rebuilt.entries.length > 0, true);

  console.log('indexed_palette_store ok');
}

run();
