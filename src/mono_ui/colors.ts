import type { Rgb } from "./types.js";

export type ColorName =
    | "off_black"
    | "off_white"
    | "pumpkin"
    | "pale_green"
    | "deep_red"
    | "deep_green"
    | "deep_blue"
    | "vivid_purple"
    | "medium_purple"
    | "light_purple"
    | "pale_purple"
    | "gray_purple"
    | "vivid_magenta"
    | "light_magenta"
    | "vivid_red"
    | "vivid_maroon"
    | "vivid_brown"
    | "light_brown"
    | "light_orange"
    | "light_red"
    | "vivid_yellow"
    | "pale_yellow"
    | "gray_green"
    | "medium_green"
    | "vivid_green"
    | "vivid_cyan"
    | "light_blue"
    | "medium_blue"
    | "vivid_blue"
    | "dark_gray"
    | "medium_gray"
    | "light_gray"
    | "pale_gray"
    | "gray_yellow"
    | "pale_orange"
    | "gray_orange"
    | "gray_red";

export type IndexedColor = {
    index: number;
    name: string;
    hex: string;
    rgb: Rgb;
    id?: string;
};

function hex_to_rgb(hex: string): Rgb {
    const clean = hex.trim().replace(/^#/, "");
    if (clean.length !== 6) {
        throw new Error(`Invalid hex color: ${hex}`);
    }

    const r = Number.parseInt(clean.slice(0, 2), 16);
    const g = Number.parseInt(clean.slice(2, 4), 16);
    const b = Number.parseInt(clean.slice(4, 6), 16);

    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
        throw new Error(`Invalid hex color: ${hex}`);
    }

    return { r, g, b };
}

export const INDEXED_COLORS: IndexedColor[] = [
    { index: 0, name: "off_black", hex: "#120a1a", rgb: hex_to_rgb("#120a1a") },
    { index: 1, name: "off_white", hex: "#feffe5", rgb: hex_to_rgb("#feffe5") },
    { index: 2, name: "pumpkin", hex: "#e36325", rgb: hex_to_rgb("#e36325") },
    { index: 3, name: "pale_green", hex: "#e2e990", rgb: hex_to_rgb("#e2e990") },
    { index: 4, name: "deep_red", hex: "#3d2329", rgb: hex_to_rgb("#3d2329") },
    { index: 5, name: "deep_green", hex: "#2d3a26", rgb: hex_to_rgb("#2d3a26") },
    { index: 6, name: "deep_blue", hex: "#2a2a41", rgb: hex_to_rgb("#2a2a41") },
    { index: 7, name: "vivid_purple", hex: "#422490", rgb: hex_to_rgb("#422490") },
    { index: 8, name: "medium_purple", hex: "#7f37bc", rgb: hex_to_rgb("#7f37bc") },
    { index: 9, name: "light_purple", hex: "#a544ff", rgb: hex_to_rgb("#a544ff") },
    { index: 10, name: "pale_purple", hex: "#debfe0", rgb: hex_to_rgb("#debfe0") },
    { index: 11, name: "gray_purple", hex: "#ab8ab5", rgb: hex_to_rgb("#ab8ab5") },
    { index: 12, name: "vivid_magenta", hex: "#ff26a8", rgb: hex_to_rgb("#ff26a8") },
    { index: 13, name: "light_magenta", hex: "#ff69a9", rgb: hex_to_rgb("#ff69a9") },
    { index: 14, name: "vivid_red", hex: "#dc3426", rgb: hex_to_rgb("#dc3426") },
    { index: 15, name: "vivid_maroon", hex: "#b21535", rgb: hex_to_rgb("#b21535") },
    { index: 16, name: "vivid_brown", hex: "#a8561a", rgb: hex_to_rgb("#a8561a") },
    { index: 17, name: "light_brown", hex: "#c4702b", rgb: hex_to_rgb("#c4702b") },
    { index: 18, name: "light_orange", hex: "#ea9827", rgb: hex_to_rgb("#ea9827") },
    { index: 19, name: "light_red", hex: "#f26657", rgb: hex_to_rgb("#f26657") },
    { index: 20, name: "vivid_yellow", hex: "#ffc62f", rgb: hex_to_rgb("#ffc62f") },
    { index: 21, name: "pale_yellow", hex: "#fff3b3", rgb: hex_to_rgb("#fff3b3") },
    { index: 22, name: "gray_green", hex: "#8c9d4f", rgb: hex_to_rgb("#8c9d4f") },
    { index: 23, name: "medium_green", hex: "#a9c448", rgb: hex_to_rgb("#a9c448") },
    { index: 24, name: "vivid_green", hex: "#4f9d35", rgb: hex_to_rgb("#4f9d35") },
    { index: 25, name: "vivid_cyan", hex: "#8bf5c6", rgb: hex_to_rgb("#8bf5c6") },
    { index: 26, name: "light_blue", hex: "#4dc6e4", rgb: hex_to_rgb("#4dc6e4") },
    { index: 27, name: "medium_blue", hex: "#4477ff", rgb: hex_to_rgb("#4477ff") },
    { index: 28, name: "vivid_blue", hex: "#2749d0", rgb: hex_to_rgb("#2749d0") },
    { index: 29, name: "dark_gray", hex: "#404863", rgb: hex_to_rgb("#404863") },
    { index: 30, name: "medium_gray", hex: "#787d8b", rgb: hex_to_rgb("#787d8b") },
    { index: 31, name: "light_gray", hex: "#9da5ae", rgb: hex_to_rgb("#9da5ae") },
    { index: 32, name: "pale_gray", hex: "#e0e8d0", rgb: hex_to_rgb("#e0e8d0") },
    { index: 33, name: "gray_yellow", hex: "#ac9d7c", rgb: hex_to_rgb("#ac9d7c") },
    { index: 34, name: "pale_orange", hex: "#fad5af", rgb: hex_to_rgb("#fad5af") },
    { index: 35, name: "gray_orange", hex: "#c5b5a8", rgb: hex_to_rgb("#c5b5a8") },
    { index: 36, name: "gray_red", hex: "#d27979", rgb: hex_to_rgb("#d27979") },
];

const COLOR_BY_NAME = new Map<ColorName, IndexedColor>(
    INDEXED_COLORS.map((c) => [c.name as ColorName, c]),
);

const COLOR_BY_INDEX = new Map<number, IndexedColor>(
    INDEXED_COLORS.map((c) => [c.index, c]),
);

let ACTIVE_INDEXED_COLORS: IndexedColor[] = INDEXED_COLORS.map((c) => ({ ...c, rgb: { ...c.rgb } }));

const COLOR_ALIASES = new Map<string, ColorName>([
    ["vivid_orange", "pumpkin"],
    ["pale_blue", "pale_gray"],
]);

export function get_color_by_name(name: ColorName): IndexedColor {
    const found = COLOR_BY_NAME.get(name);
    if (!found) throw new Error(`Unknown color name: ${name}`);
    return found;
}

export function get_color_by_alias(name: string): IndexedColor {
    const normalized = name.trim().toLowerCase();
    const resolved = COLOR_ALIASES.get(normalized) ?? (normalized as ColorName);
    return get_color_by_name(resolved);
}

export function get_color_by_index(index: number): IndexedColor {
    const found = COLOR_BY_INDEX.get(index);
    if (!found) throw new Error(`Unknown color index: ${index}`);
    return found;
}

function clone_indexed_color(color: IndexedColor): IndexedColor {
    return { ...color, rgb: { ...color.rgb } };
}

function sanitize_rgb(rgb: Rgb): Rgb {
    return {
        r: Number.isFinite(rgb?.r) ? Math.max(0, Math.min(255, Math.round(rgb.r))) : 0,
        g: Number.isFinite(rgb?.g) ? Math.max(0, Math.min(255, Math.round(rgb.g))) : 0,
        b: Number.isFinite(rgb?.b) ? Math.max(0, Math.min(255, Math.round(rgb.b))) : 0,
    };
}

function rgb_to_hex(rgb: Rgb): string {
    const safe = sanitize_rgb(rgb);
    return `#${safe.r.toString(16).padStart(2, '0')}${safe.g.toString(16).padStart(2, '0')}${safe.b.toString(16).padStart(2, '0')}`;
}

export function list_indexed_colors(): readonly IndexedColor[] {
    return INDEXED_COLORS;
}

export function list_active_indexed_colors(): readonly IndexedColor[] {
    return ACTIVE_INDEXED_COLORS;
}

export function set_active_indexed_colors(colors: readonly IndexedColor[]): readonly IndexedColor[] {
    const source = Array.isArray(colors) && colors.length > 0 ? colors : INDEXED_COLORS;
    ACTIVE_INDEXED_COLORS = source.map((color, index) => ({
        id: color.id ?? `indexed_${index}`,
        index,
        name: String(color.name ?? `COLOR ${index + 1}`).trim() || `COLOR ${index + 1}`,
        hex: rgb_to_hex(color.rgb),
        rgb: sanitize_rgb(color.rgb),
    }));
    return list_active_indexed_colors();
}

export function reset_active_indexed_colors(): readonly IndexedColor[] {
    return set_active_indexed_colors(INDEXED_COLORS);
}

export function get_darkest_indexed_rgb(): Rgb {
    return { ...(ACTIVE_INDEXED_COLORS[0] ?? INDEXED_COLORS[0])!.rgb };
}

export function get_brightest_indexed_rgb(): Rgb {
    return { ...(ACTIVE_INDEXED_COLORS[1] ?? ACTIVE_INDEXED_COLORS[0] ?? INDEXED_COLORS[1] ?? INDEXED_COLORS[0])!.rgb };
}

export function find_indexed_color_by_rgb(rgb: Rgb): IndexedColor | null {
    const safe = sanitize_rgb(rgb);
    for (const color of ACTIVE_INDEXED_COLORS) {
        if (color.rgb.r === safe.r && color.rgb.g === safe.g && color.rgb.b === safe.b) {
            return clone_indexed_color(color);
        }
    }
    return null;
}

export function nearest_indexed_color(rgb: Rgb): IndexedColor {
    const safe = sanitize_rgb(rgb);
    const colors = ACTIVE_INDEXED_COLORS.length > 0 ? ACTIVE_INDEXED_COLORS : INDEXED_COLORS;
    let best = colors[0] ?? { index: 0, name: 'COLOR 1', hex: '#ffffff', rgb: { r: 255, g: 255, b: 255 }, id: 'indexed_0' };
    let best_d = Number.POSITIVE_INFINITY;

    for (const c of colors) {
        const dr = c.rgb.r - safe.r;
        const dg = c.rgb.g - safe.g;
        const db = c.rgb.b - safe.b;
        const d = (dr * dr) + (dg * dg) + (db * db);
        if (d < best_d) {
            best_d = d;
            best = c;
        }
    }

    return clone_indexed_color(best);
}

export function nearest_indexed_rgb(rgb: Rgb): Rgb {
    return { ...nearest_indexed_color(rgb).rgb };
}

export function lerp_rgb(a: Rgb, b: Rgb, mix: number): Rgb {
    const t = Number.isFinite(mix) ? Math.max(0, Math.min(1, mix)) : 0;
    return {
        r: Math.round(a.r + ((b.r - a.r) * t)),
        g: Math.round(a.g + ((b.g - a.g) * t)),
        b: Math.round(a.b + ((b.b - a.b) * t)),
    };
}

export function mid_rgb(a: Rgb, b: Rgb): Rgb {
    return lerp_rgb(a, b, 0.5);
}

export function nearest_indexed_lerp_rgb(a: Rgb, b: Rgb, mix: number): Rgb {
    return nearest_indexed_rgb(lerp_rgb(a, b, mix));
}
