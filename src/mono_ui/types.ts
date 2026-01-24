// mono_ui core types (pure, no DOM / no Node)

export type Rgb = {
    r: number; // 0-255
    g: number; // 0-255
    b: number; // 0-255
};

// Your style model: a string name, not booleans (e.g. "regular", "thin_italic")
export type StyleName = string;

// One tile / cell in the canvas
export type Cell = {
    char: string; // expected length 1; space ' ' means clear
    style: StyleName;
    rgb: Rgb;
};

// Inclusive rect in bottom-left coordinates:
// covers all cells where x in [x0..x1] and y in [y0..y1]
export type Rect = {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
};

export type TileClick = {
    x: number;
    y: number;
};
export type TileEvent = {
    x: number;
    y: number;
    cell: Cell | undefined;
};

export type PointerKind = 'enter' | 'leave' | 'move' | 'down' | 'up' | 'click';

export type PointerEvent = {
    pointer_id: number; // 0 = mouse
    kind: PointerKind;
    x: number;
    y: number;
    prev_x?: number;
    prev_y?: number;
    buttons: number;
    cell?: Cell;
};

export type Module = {
    id: string;
    rect: Rect;
    Draw(canvas: Canvas): void;

    // legacy (keep temporarily)
    OnTileHover?(event: TileEvent): void;
    OnTileClick?(event: TileEvent): void;

    // new lifecycle
    OnPointerEnter?(e: PointerEvent): void;
    OnPointerLeave?(e: PointerEvent): void;
    OnPointerMove?(e: PointerEvent): void;
    OnPointerDown?(e: PointerEvent): void;
    OnPointerUp?(e: PointerEvent): void;
    OnClick?(e: PointerEvent): void;
};




export function rect_width(rect: Rect): number {
    return rect.x1 - rect.x0 + 1;
}

export function rect_height(rect: Rect): number {
    return rect.y1 - rect.y0 + 1;
}

export function rect_contains(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
}

// Forward declaration (implemented in canvas.ts)
export type Canvas = {
    width: number;
    height: number;

    // bottom-left coordinate system
    get(x: number, y: number): Cell | undefined;
    set(x: number, y: number, cell: Partial<Cell> & { char: string }): void;

    clear_rect(rect: Rect): void;
    fill_rect(rect: Rect, cell: Partial<Cell> & { char: string }): void;

    // inclusive endpoints (x0,y0) -> (x1,y1), supports diagonal via Bresenham
    draw_line(x0: number, y0: number, x1: number, y1: number, cell: Partial<Cell> & { char: string }): void;
};
