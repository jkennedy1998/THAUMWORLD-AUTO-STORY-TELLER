from __future__ import annotations

import csv
import os
import struct
import zlib


CELL_SIZE = 16
WEIGHT_COLUMNS = ["w1", "w2", "w3", "w4", "w5", "w6"]
HEADER_H = 24
LEFT_W = 112
GRID_LINE = (40, 46, 56, 255)
BG_A = (214, 219, 226, 255)
BG_B = (238, 241, 245, 255)
HEADER_BG = (248, 250, 252, 255)
LABEL_BG = (245, 247, 250, 255)
INK = (28, 32, 38, 255)
SUBTLE = (110, 120, 132, 255)
HINT = (141, 90, 35, 255)


FONT_3X5 = {
    " ": ["000", "000", "000", "000", "000"],
    "!": ["010", "010", "010", "000", "010"],
    '"': ["101", "101", "000", "000", "000"],
    "#": ["101", "111", "101", "111", "101"],
    "$": ["111", "110", "111", "011", "111"],
    "%": ["101", "001", "010", "100", "101"],
    "&": ["110", "101", "110", "101", "110"],
    "'": ["010", "010", "000", "000", "000"],
    "(": ["001", "010", "010", "010", "001"],
    ")": ["100", "010", "010", "010", "100"],
    "*": ["101", "010", "111", "010", "101"],
    "+": ["000", "010", "111", "010", "000"],
    ",": ["000", "000", "000", "010", "100"],
    "-": ["000", "000", "111", "000", "000"],
    ".": ["000", "000", "000", "000", "010"],
    "/": ["001", "001", "010", "100", "100"],
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "001", "001", "001"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"],
    ":": ["000", "010", "000", "010", "000"],
    ";": ["000", "010", "000", "010", "100"],
    "<": ["001", "010", "100", "010", "001"],
    "=": ["000", "111", "000", "111", "000"],
    ">": ["100", "010", "001", "010", "100"],
    "?": ["111", "001", "011", "000", "010"],
    "@": ["111", "101", "111", "100", "111"],
    "[": ["011", "010", "010", "010", "011"],
    "\\": ["100", "100", "010", "001", "001"],
    "]": ["110", "010", "010", "010", "110"],
    "^": ["010", "101", "000", "000", "000"],
    "_": ["000", "000", "000", "000", "111"],
    "`": ["100", "010", "000", "000", "000"],
    "{": ["011", "010", "110", "010", "011"],
    "|": ["010", "010", "010", "010", "010"],
    "}": ["110", "010", "011", "010", "110"],
    "~": ["000", "101", "010", "000", "000"],
}


for ch, pattern in {
    "A": ["010", "101", "111", "101", "101"],
    "B": ["110", "101", "110", "101", "110"],
    "C": ["111", "100", "100", "100", "111"],
    "D": ["110", "101", "101", "101", "110"],
    "E": ["111", "100", "110", "100", "111"],
    "F": ["111", "100", "110", "100", "100"],
    "G": ["111", "100", "101", "101", "111"],
    "H": ["101", "101", "111", "101", "101"],
    "I": ["111", "010", "010", "010", "111"],
    "J": ["001", "001", "001", "101", "111"],
    "K": ["101", "101", "110", "101", "101"],
    "L": ["100", "100", "100", "100", "111"],
    "M": ["101", "111", "111", "101", "101"],
    "N": ["101", "111", "111", "111", "101"],
    "O": ["111", "101", "101", "101", "111"],
    "P": ["111", "101", "111", "100", "100"],
    "Q": ["111", "101", "101", "111", "001"],
    "R": ["111", "101", "110", "101", "101"],
    "S": ["111", "100", "111", "001", "111"],
    "T": ["111", "010", "010", "010", "010"],
    "U": ["101", "101", "101", "101", "111"],
    "V": ["101", "101", "101", "101", "010"],
    "W": ["101", "101", "111", "111", "101"],
    "X": ["101", "101", "010", "101", "101"],
    "Y": ["101", "101", "010", "010", "010"],
    "Z": ["111", "001", "010", "100", "111"],
}.items():
    FONT_3X5[ch] = pattern
    FONT_3X5[ch.lower()] = pattern


TEXT_ROWS = [
    ("space", " "),
    ("missing_glyph", "?"),
] + [(f"upper_{chr(i)}", chr(i)) for i in range(ord("A"), ord("Z") + 1)] \
    + [(f"lower_{chr(i)}", chr(i)) for i in range(ord("a"), ord("z") + 1)] \
    + [(f"digit_{i}", str(i)) for i in range(10)] \
    + [
        ("punct_period", "."),
        ("punct_comma", ","),
        ("punct_colon", ":"),
        ("punct_semicolon", ";"),
        ("punct_exclam", "!"),
        ("punct_question", "?"),
        ("punct_apostrophe", "'"),
        ("punct_quote", '"'),
        ("punct_hyphen", "-"),
        ("punct_underscore", "_"),
        ("punct_plus", "+"),
        ("punct_equals", "="),
        ("punct_slash", "/"),
        ("punct_backslash", "\\"),
        ("punct_paren_l", "("),
        ("punct_paren_r", ")"),
        ("punct_bracket_l", "["),
        ("punct_bracket_r", "]"),
        ("punct_brace_l", "{"),
        ("punct_brace_r", "}"),
        ("punct_angle_l", "<"),
        ("punct_angle_r", ">"),
        ("pipe_vertical", "|"),
    ]

UI_ROWS = [
    ("border_h", "H"),
    ("border_v", "V"),
    ("corner_tl", "TL"),
    ("corner_tr", "TR"),
    ("corner_bl", "BL"),
    ("corner_br", "BR"),
    ("tee_up", "TU"),
    ("tee_down", "TD"),
    ("tee_left", "TLF"),
    ("tee_right", "TRT"),
    ("cross", "X"),
    ("arrow_up", "UP"),
    ("arrow_down", "DN"),
    ("arrow_left", "LT"),
    ("arrow_right", "RT"),
    ("selector", "SEL"),
    ("cursor", "CUR"),
    ("close_icon", "X"),
    ("move_icon", "MV"),
    ("resize_icon", "RS"),
    ("save_icon", "SV"),
    ("slot_empty", "SE"),
    ("slot_highlight", "SH"),
    ("slot_invalid", "IV"),
    ("panel_fill", "PF"),
    ("highlight_fill", "HF"),
    ("target_fill", "TG"),
]

TILE_ROWS = [
    ("tile_void", "VOID"),
    ("tile_floor", "FLR"),
    ("tile_dirt", "DIRT"),
    ("tile_grass", "GRS"),
    ("tile_stone", "STN"),
    ("tile_water", "WTR"),
    ("tile_sand", "SND"),
    ("tile_path", "PATH"),
    ("tile_wall", "WALL"),
    ("tile_door_closed", "DCL"),
    ("tile_door_open", "DOP"),
    ("tile_chest_closed", "CCL"),
    ("tile_chest_open", "COP"),
    ("tile_bush", "BSH"),
    ("tile_tree", "TREE"),
    ("tile_fence", "FNC"),
    ("tile_window", "WND"),
    ("tile_shadow", "SHD"),
    ("tile_selection", "SEL"),
    ("tile_hover", "HOV"),
    ("tile_target", "TGT"),
    ("tile_damage", "DMG"),
]

CREATURE_ROWS = [
    ("actor_base", "BASE"),
    ("actor_head", "HEAD"),
    ("actor_torso", "TORS"),
    ("actor_legs", "LEGS"),
    ("actor_hair_short", "HS"),
    ("actor_hair_long", "HL"),
    ("actor_eyes", "EYES"),
    ("actor_beard", "BRD"),
    ("actor_shirt", "SHRT"),
    ("actor_pants", "PANT"),
    ("actor_boots", "BOOT"),
    ("actor_gloves", "GLV"),
    ("actor_cloak", "CLK"),
    ("armor_helmet", "HELM"),
    ("armor_chest", "CHST"),
    ("armor_legs", "ALGS"),
    ("armor_boots", "ABOT"),
    ("weapon_sword", "SWD"),
    ("weapon_dagger", "DAG"),
    ("weapon_staff", "STF"),
    ("npc_base", "NPC"),
    ("creature_wolf", "WLF"),
    ("creature_bird", "BRD"),
    ("creature_beast", "BST"),
    ("corpse_base", "RIP"),
]


SHEETS = [
    ("text", TEXT_ROWS),
    ("ui", UI_ROWS),
    ("tiles", TILE_ROWS),
    ("creatures", CREATURE_ROWS),
]


def make_image(width: int, height: int, color: tuple[int, int, int, int]) -> bytearray:
    return bytearray(color * width * height)


def set_px(img: bytearray, width: int, x: int, y: int, color: tuple[int, int, int, int]) -> None:
    if x < 0 or y < 0:
        return
    idx = (y * width + x) * 4
    if idx < 0 or idx + 4 > len(img):
        return
    img[idx:idx + 4] = bytes(color)


def fill_rect(img: bytearray, width: int, x: int, y: int, w: int, h: int, color: tuple[int, int, int, int]) -> None:
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            set_px(img, width, xx, yy, color)


def draw_rect(img: bytearray, width: int, x: int, y: int, w: int, h: int, color: tuple[int, int, int, int]) -> None:
    fill_rect(img, width, x, y, w, 1, color)
    fill_rect(img, width, x, y + h - 1, w, 1, color)
    fill_rect(img, width, x, y, 1, h, color)
    fill_rect(img, width, x + w - 1, y, 1, h, color)


def draw_pattern(img: bytearray, width: int, x: int, y: int, pattern: list[str], color: tuple[int, int, int, int], scale: int = 1) -> None:
    for py, row in enumerate(pattern):
        for px, bit in enumerate(row):
            if bit != "1":
                continue
            fill_rect(img, width, x + px * scale, y + py * scale, scale, scale, color)


def draw_text(img: bytearray, width: int, x: int, y: int, text: str, color: tuple[int, int, int, int], scale: int = 1, spacing: int = 1) -> None:
    cursor = x
    for ch in text:
        pattern = FONT_3X5.get(ch, FONT_3X5.get("?"))
        if pattern is None:
            continue
        draw_pattern(img, width, cursor, y, pattern, color, scale)
        cursor += (3 * scale) + spacing


def write_png(path: str, width: int, height: int, rgba: bytearray) -> None:
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        start = y * stride
        raw.extend(rgba[start:start + stride])

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = bytearray(b"\x89PNG\r\n\x1a\n")
    png.extend(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
    png.extend(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
    png.extend(chunk(b"IEND", b""))

    with open(path, "wb") as f:
        f.write(png)


def row_meta(sheet: str, row_id: str, token: str) -> tuple[str, str, str, str, str, str, str, str]:
    codepoint = token if sheet == "text" else ""
    role = "fg" if sheet in {"text", "ui", "tiles"} else "layer"
    min_weight = "1"
    max_weight = "6"
    notes = "draw at least w1 and w2" if row_id != "space" else "leave transparent"
    return (sheet, row_id, token, codepoint, role, min_weight, max_weight, notes)


def draw_template(sheet_name: str, rows: list[tuple[str, str]], out_dir: str) -> None:
    width = LEFT_W + (len(WEIGHT_COLUMNS) * CELL_SIZE)
    height = HEADER_H + (len(rows) * CELL_SIZE)
    img = make_image(width, height, HEADER_BG)

    fill_rect(img, width, 0, HEADER_H, LEFT_W, height - HEADER_H, LABEL_BG)

    for i, weight in enumerate(WEIGHT_COLUMNS):
        x0 = LEFT_W + i * CELL_SIZE
        fill_rect(img, width, x0, 0, CELL_SIZE, HEADER_H, HEADER_BG)
        draw_text(img, width, x0 + 3, 8, weight, INK, scale=1, spacing=1)

    draw_text(img, width, 8, 8, sheet_name.upper(), INK, scale=2, spacing=1)
    draw_text(img, width, 8, HEADER_H - 11, "16X GRID", SUBTLE, scale=1, spacing=1)

    for row_index, (row_id, token) in enumerate(rows):
        y0 = HEADER_H + row_index * CELL_SIZE
        fill_rect(img, width, 0, y0, LEFT_W, CELL_SIZE, LABEL_BG)
        draw_text(img, width, 6, y0 + 2, row_id[:18], INK, scale=1, spacing=1)
        draw_text(img, width, 6, y0 + 9, token[:10], HINT, scale=1, spacing=1)

        for col_index, weight in enumerate(WEIGHT_COLUMNS):
            x0 = LEFT_W + col_index * CELL_SIZE
            for yy in range(CELL_SIZE):
                for xx in range(CELL_SIZE):
                    color = BG_A if ((xx // 4) + (yy // 4)) % 2 == 0 else BG_B
                    set_px(img, width, x0 + xx, y0 + yy, color)
            draw_rect(img, width, x0, y0, CELL_SIZE, CELL_SIZE, GRID_LINE)
            draw_text(img, width, x0 + 2, y0 + 2, token[:4], INK, scale=1, spacing=0)
            draw_text(img, width, x0 + 2, y0 + 10, weight, SUBTLE, scale=1, spacing=0)

    draw_rect(img, width, 0, 0, width, height, GRID_LINE)
    fill_rect(img, width, LEFT_W - 1, 0, 1, height, GRID_LINE)
    fill_rect(img, width, 0, HEADER_H - 1, width, 1, GRID_LINE)

    png_path = os.path.join(out_dir, f"{sheet_name}_template.png")
    write_png(png_path, width, height, img)

    csv_path = os.path.join(out_dir, f"{sheet_name}_template_rows.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["sheet", "row_id", "token", "codepoint", "layer_role", "min_weight", "max_weight", "notes"])
        for row_id, token in rows:
            writer.writerow(row_meta(sheet_name, row_id, token))


def main() -> None:
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(repo_root, "Graphics")
    os.makedirs(out_dir, exist_ok=True)

    for sheet_name, rows in SHEETS:
        draw_template(sheet_name, rows, out_dir)

    readme_path = os.path.join(out_dir, "README.md")
    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(
            "# Graphics\n\n"
            "Generated 16x16 sprite template sheets.\n\n"
            "- Files ending in `_template.png` are art templates.\n"
            "- Files ending in `_template_rows.csv` list row ids and starter metadata.\n"
            "- Columns are weight variants `w1` through `w6`.\n"
            "- Each sprite cell is 16x16 pixels.\n"
            "- Use transparent background in your final art layers.\n"
            "- `w1` and `w2` are the expected minimum; higher weights are optional.\n"
        )


if __name__ == "__main__":
    main()
