import type { InlineItem } from "../types/inline_item.js";

function get_place_base_z(place_any: any): number {
    const z = Number(place_any?.coordinates?.elevation);
    return (typeof z === 'number' && Number.isFinite(z)) ? Math.floor(z) : 0;
}

function parse_scattered_key(key: string): { x: number; y: number; z: number | null } | null {
    const parts = String(key ?? '').split('_');
    if (parts.length < 2) return null;
    const x = parseInt(parts[0] ?? '', 10);
    const y = parseInt(parts[1] ?? '', 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const z = parts.length >= 3 ? parseInt(parts[2] ?? '', 10) : NaN;
    return { x, y, z: Number.isFinite(z) ? z : null };
}

export function make_scattered_key(x: number, y: number, z: number): string {
    return `${Math.floor(x)}_${Math.floor(y)}_${Math.floor(z)}`;
}

export function normalize_ground_scattered(place_any: any): boolean {
    try {
        if (!place_any || typeof place_any !== 'object') return false;
        if (!place_any.ground) place_any.ground = { main: [], scattered: {} };
        if (!place_any.ground.scattered || typeof place_any.ground.scattered !== 'object') place_any.ground.scattered = {};

        const base_z = get_place_base_z(place_any);
        const scattered = place_any.ground.scattered as Record<string, InlineItem[]>;
        const next: Record<string, InlineItem[]> = {};
        let changed = false;

        for (const [k, items] of Object.entries(scattered)) {
            const p = parse_scattered_key(k);
            if (!p) {
                next[k] = items as any;
                continue;
            }
            const x = p.x;
            const y = p.y;

            for (const item of (items as any[])) {
                if (!item) continue;
                const key_z = p.z;
                const iz_raw = (item as any).elevation;
                const iz = (key_z !== null)
                    ? key_z
                    : (typeof iz_raw === 'number' && Number.isFinite(iz_raw) ? Math.floor(iz_raw) : base_z);

                if ((item as any).elevation !== iz) {
                    (item as any).elevation = iz;
                    changed = true;
                }

                const nk = make_scattered_key(x, y, iz);
                if (nk !== k) changed = true;
                if (!Array.isArray(next[nk])) next[nk] = [];
                next[nk]!.push(item);
            }
        }

        place_any.ground.scattered = next;
        return changed;
    } catch {
        return false;
    }
}
