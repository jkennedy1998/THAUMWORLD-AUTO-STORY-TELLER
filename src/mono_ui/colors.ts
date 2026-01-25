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
    name: ColorName;
    hex: string;
    rgb: Rgb;
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

const INDEXED_COLORS: IndexedColor[] = [
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
    INDEXED_COLORS.map((c) => [c.name, c]),
);

const COLOR_BY_INDEX = new Map<number, IndexedColor>(
    INDEXED_COLORS.map((c) => [c.index, c]),
);

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

export function list_indexed_colors(): readonly IndexedColor[] {
    return INDEXED_COLORS;
}
