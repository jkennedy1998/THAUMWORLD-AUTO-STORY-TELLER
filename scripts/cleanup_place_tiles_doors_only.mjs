import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'jsonc-parser'

const ROOT = process.cwd()
const PLACES_DIR = path.join(ROOT, 'local_data', 'data_slot_1', 'places')
const KEEP_ID = 'eden_crossroads_tavern'

function clampInt(n, lo, hi) {
  const v = Math.trunc(Number(n))
  return Math.max(lo, Math.min(hi, v))
}

function calculateDoorPosition(width, height, direction, defaultEntry) {
  const dir = String(direction || '').toLowerCase()
  if (dir.includes('north') || dir.includes('up') || dir.includes('forward')) {
    return { x: Math.floor(width / 2), y: height - 1 }
  }
  if (dir.includes('south') || dir.includes('down') || dir.includes('backward')) {
    return { x: Math.floor(width / 2), y: 0 }
  }
  if (dir.includes('east') || dir.includes('right')) {
    return { x: width - 1, y: Math.floor(height / 2) }
  }
  if (dir.includes('west') || dir.includes('left')) {
    return { x: 0, y: Math.floor(height / 2) }
  }

  const x = clampInt(defaultEntry?.x ?? 0, 0, Math.max(0, width - 1))
  const y = clampInt(defaultEntry?.y ?? 0, 0, Math.max(0, height - 1))
  return { x, y }
}

function makeEmptyTiles(width, height) {
  const cells = []
  for (let y = 0; y < height; y++) {
    const row = []
    for (let x = 0; x < width; x++) row.push(null)
    cells.push(row)
  }
  return { width, height, cells }
}

function normalizeDoorTile(placeId, conn) {
  return {
    kind: 'door',
    door: {
      target_place_id: String(conn?.target_place_id ?? ''),
      direction: String(conn?.direction ?? ''),
    },
  }
}

function cleanupPlace(place) {
  const id = String(place?.id ?? '')
  if (!id || id === KEEP_ID) return { changed: false }

  const w = clampInt(place?.tile_grid?.width ?? 0, 1, 9999)
  const h = clampInt(place?.tile_grid?.height ?? 0, 1, 9999)
  const conns = Array.isArray(place?.connections) ? place.connections : []

  // Remove test-room support layer.
  if (place.tiles_z0 !== undefined) delete place.tiles_z0

  // Rebuild tiles as doors-only.
  const tiles = makeEmptyTiles(w, h)

  for (const conn of conns) {
    const pos = calculateDoorPosition(w, h, conn?.direction, place?.tile_grid?.default_entry)
    const x = clampInt(pos.x, 0, w - 1)
    const y = clampInt(pos.y, 0, h - 1)
    tiles.cells[y][x] = normalizeDoorTile(id, conn)
  }

  place.tiles = tiles
  return { changed: true }
}

function main() {
  if (!fs.existsSync(PLACES_DIR)) {
    console.error(`places dir not found: ${PLACES_DIR}`)
    process.exit(1)
  }

  const files = fs.readdirSync(PLACES_DIR).filter((f) => f.endsWith('.jsonc'))
  const changedFiles = []

  for (const file of files) {
    const full = path.join(PLACES_DIR, file)
    const raw = fs.readFileSync(full, 'utf-8')
    const place = parse(raw)
    const beforeId = String(place?.id ?? '')
    const res = cleanupPlace(place)
    if (!res.changed) continue

    fs.writeFileSync(full, JSON.stringify(place, null, 2) + '\n', 'utf-8')
    changedFiles.push({ file, id: beforeId })
  }

  if (changedFiles.length === 0) {
    console.log('No place files changed.')
    return
  }

  console.log(`Cleaned ${changedFiles.length} place file(s):`)
  for (const x of changedFiles) console.log(`- ${x.id} (${x.file})`)
}

main()
