import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { ensure_dir_exists } from "../engine/log_store.js";
import { get_default_world_path, get_legacy_default_world_path, get_legacy_world_path, get_world_dir, get_world_path } from "../engine/paths.js";

export type WorldLookupResult =
    | { ok: true; world: Record<string, unknown>; path: string }
    | { ok: false; error: string; todo: string };

export type RegionLookupResult =
    | { ok: true; region: Record<string, unknown>; path: string }
    | { ok: false; error: string; todo: string };

type WorldStore = {
    schema_version: number;
    world_tiles: Record<string, WorldTile>;
};

type WorldTile = {
    id: string;
    coords: { x: number; y: number };
    temperature: { mag: number };
    regions: (RegionTile | null)[][]; // 10x10 grid
};

type RegionTile = {
    id: string;
    coords: { world_x: number; world_y: number; region_x: number; region_y: number };
    temperature: { mag: number };
    contents: unknown[];
    notes: string;
};

function read_jsonc(pathname: string): Record<string, unknown> {
    const raw = fs.readFileSync(pathname, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
}

function make_empty_region_grid(): (RegionTile | null)[][] {
    return Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => null));
}

function make_default_region_tile(world_x: number, world_y: number, region_x: number, region_y: number): RegionTile {
    return {
        id: `region_${world_x}_${world_y}_${region_x}_${region_y}`,
        coords: { world_x, world_y, region_x, region_y },
        temperature: { mag: 0 },
        contents: [
            {
                id: `tile_${world_x}_${world_y}_${region_x}_${region_y}_0_0`,
                coords: { x: 0, y: 0 },
                notes: "",
            },
        ],
        notes: "",
    };
}

function make_default_world_tile(x: number, y: number): WorldTile {
    const regions = make_empty_region_grid();
    regions[0]![0] = make_default_region_tile(x, y, 0, 0);
    return {
        id: `world_tile_${x}_${y}`,
        coords: { x, y },
        temperature: { mag: 0 },
        regions,
    };
}

export function ensure_world_exists(slot: number): WorldLookupResult {
    const world_path = get_world_path(slot);
    const world_dir = get_world_dir(slot);
    ensure_dir_exists(world_dir);

    if (fs.existsSync(world_path)) {
        const world = read_jsonc(world_path) as WorldStore;
        return { ok: true, world, path: world_path };
    }
    const legacy_world_path = get_legacy_world_path(slot);
    if (fs.existsSync(legacy_world_path)) {
        fs.copyFileSync(legacy_world_path, world_path);
        const world = read_jsonc(world_path) as WorldStore;
        return { ok: true, world, path: world_path };
    }

    const template_path = get_default_world_path();
    if (!fs.existsSync(template_path)) {
        const legacy_path = get_legacy_default_world_path();
        if (fs.existsSync(legacy_path)) {
            ensure_dir_exists(path.dirname(template_path));
            fs.copyFileSync(legacy_path, template_path);
        } else {
            const todo = `Default world template missing. Create ${template_path}`;
            return { ok: false, error: "default_world_missing", todo };
        }
    }

    const world = read_jsonc(template_path) as WorldStore;
    fs.writeFileSync(world_path, JSON.stringify(world, null, 2), "utf-8");
    return { ok: true, world, path: world_path };
}

export function ensure_world_tile(slot: number, x: number, y: number): WorldLookupResult {
    const world = ensure_world_exists(slot);
    if (!world.ok) return world;

    const store = world.world as WorldStore;
    const key = `${x},${y}`;
    if (!store.world_tiles) store.world_tiles = {};
    if (!store.world_tiles[key]) {
        store.world_tiles[key] = make_default_world_tile(x, y);
        fs.writeFileSync(world.path, JSON.stringify(store, null, 2), "utf-8");
    }

    return { ok: true, world: store.world_tiles[key] as unknown as Record<string, unknown>, path: world.path };
}

export function ensure_region_tile(
    slot: number,
    world_x: number,
    world_y: number,
    region_x: number,
    region_y: number,
): RegionLookupResult {
    const world = ensure_world_exists(slot);
    if (!world.ok) return world;

    const store = world.world as WorldStore;
    const key = `${world_x},${world_y}`;
    if (!store.world_tiles) store.world_tiles = {};
    if (!store.world_tiles[key]) {
        store.world_tiles[key] = make_default_world_tile(world_x, world_y);
    }

    const tile = store.world_tiles[key];
    const regions = tile.regions ?? make_empty_region_grid();
    tile.regions = regions;
    if (region_x < 0 || region_x > 9 || region_y < 0 || region_y > 9) {
        return { ok: false, error: "region_out_of_bounds", todo: "Region coords must be 0-9 within a world tile" };
    }
    if (!regions[region_y]![region_x]) {
        regions[region_y]![region_x] = make_default_region_tile(world_x, world_y, region_x, region_y);
        fs.writeFileSync(world.path, JSON.stringify(store, null, 2), "utf-8");
    }

    return { ok: true, region: regions[region_y]![region_x] as unknown as Record<string, unknown>, path: world.path };
}

export function get_world_tile(slot: number, x: number, y: number): WorldLookupResult {
    const world = ensure_world_exists(slot);
    if (!world.ok) return world;

    const key = `${x},${y}`;
    const store = world.world as WorldStore;
    const tile = store.world_tiles?.[key];

    if (!tile) {
        const todo = `World tile not found at ${key}. Create world tile in ${world.path}`;
        return { ok: false, error: "world_tile_missing", todo };
    }

    return { ok: true, world: tile as unknown as Record<string, unknown>, path: world.path };
}

export function get_region_tile(slot: number, world_x: number, world_y: number, region_x: number, region_y: number): RegionLookupResult {
    const world = ensure_world_exists(slot);
    if (!world.ok) return world;

    const key = `${world_x},${world_y}`;
    const store = world.world as WorldStore;
    const tile = store.world_tiles?.[key];

    if (!tile) {
        const todo = `World tile not found at ${key}. Create world tile in ${world.path}`;
        return { ok: false, error: "world_tile_missing", todo };
    }

    if (region_x < 0 || region_x > 9 || region_y < 0 || region_y > 9) {
        return { ok: false, error: "region_out_of_bounds", todo: "Region coords must be 0-9 within a world tile" };
    }

    const regions = tile.regions ?? make_empty_region_grid();
    const region = regions[region_y]?.[region_x] ?? null;

    if (!region) {
        const todo = `Region tile not found at (${region_x},${region_y}) in world tile ${key}. Create region tile.`;
        return { ok: false, error: "region_tile_missing", todo };
    }

    return { ok: true, region: region as unknown as Record<string, unknown>, path: world.path };
}
