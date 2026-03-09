const fs = require('fs');
const path = require('path');
const { parse } = require('jsonc-parser');

const PLACES_DIR = path.join('local_data', 'data_slot_1', 'places');

const OCC = { name: 'OCCUPIES', mag: 1, meta: [], scope: ['TILE'] };
function base_block() {
  return { kind: 'tile_stone_brick', tags: [OCC] };
}

function ensure_z0(place) {
  const w = place?.tile_grid?.width;
  const h = place?.tile_grid?.height;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return { created: false, filled: 0 };

  const z0 = place.tiles_z0;
  const needs = !z0 || z0.width !== w || z0.height !== h || !Array.isArray(z0.cells) || z0.cells.length !== h;
  if (needs) {
    const cells = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) row.push(base_block());
      cells.push(row);
    }
    place.tiles_z0 = { width: w, height: h, cells };
    return { created: true, filled: w * h };
  }

  let filled = 0;
  for (let y = 0; y < h; y++) {
    const row = z0.cells[y];
    if (!Array.isArray(row) || row.length !== w) {
      const next = [];
      for (let x = 0; x < w; x++) next.push(base_block());
      z0.cells[y] = next;
      filled += w;
      continue;
    }
    for (let x = 0; x < w; x++) {
      const cell = row[x];
      if (!cell) {
        row[x] = base_block();
        filled++;
        continue;
      }
      if (typeof cell === 'object') {
        const k = String(cell.kind || '');
        if (k === 'stone_brick' || k === 'floor') {
          row[x] = base_block();
          filled++;
          continue;
        }
        if ('collidable' in cell) delete cell.collidable;
      }
    }
  }
  return { created: false, filled };
}

function fix_z1_tiles(place) {
  if (!place.tiles || !Array.isArray(place.tiles.cells)) return { floorToNull: 0, stoneRenamed: 0, collidableRemoved: 0 };
  let floorToNull = 0;
  let stoneRenamed = 0;
  let collidableRemoved = 0;
  for (const row of place.tiles.cells) {
    if (!Array.isArray(row)) continue;
    for (let i = 0; i < row.length; i++) {
      const cell = row[i];
      if (cell && typeof cell === 'object') {
        const k = String(cell.kind || '');
        if (k === 'floor') {
          row[i] = null; // air on z=1
          floorToNull++;
          continue;
        }
        if (k === 'stone_brick') {
          cell.kind = 'tile_stone_brick';
          stoneRenamed++;
        }
        if ('collidable' in cell) {
          delete cell.collidable;
          collidableRemoved++;
        }
      }
    }
  }
  return { floorToNull, stoneRenamed, collidableRemoved };
}

function main() {
  if (!fs.existsSync(PLACES_DIR)) {
    console.error('Places dir not found:', PLACES_DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(PLACES_DIR).filter(f => f.endsWith('.jsonc'));
  const report = [];
  let changed = 0;

  for (const f of files) {
    const fp = path.join(PLACES_DIR, f);
    const raw = fs.readFileSync(fp, 'utf8');
    const place = parse(raw);
    if (!place || !place.tile_grid) continue;

    const before = JSON.stringify(place);
    const z1 = fix_z1_tiles(place);
    const z0 = ensure_z0(place);
    const after = JSON.stringify(place);

    if (before !== after) {
      fs.writeFileSync(fp, JSON.stringify(place, null, 2));
      changed++;
      report.push({ file: f, z1, z0 });
    }
  }

  console.log('Fixed place tile layers', { changed_files: changed, details: report });
}

main();
