// mono_ui core types (pure, no DOM / no Node)

export type Rgb = {
    r: number; // 0-255
    g: number; // 0-255
    b: number; // 0-255
};

// Style model: a string name, not booleans (e.g. "regular", "thin_italic")
export type StyleName = string;

// One tile / cell in the canvas
export type Cell = {
    char: string; // expected length 1; space ' ' means clear

    // 0..7 mapped to Martian Mono weights 100..800
    // 0=thin ... 3=regular-ish ... 7=black-ish
    weight_index: number;

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

export type WheelEvent = {
    x: number;
    y: number;

    delta_x: number;
    delta_y: number;
    delta_mode: number; // 0 pixels, 1 lines, 2 pages

    shift: boolean;
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
};

export type PointerKind = 'enter' | 'leave' | 'move' | 'down' | 'up' | 'click';

export type PointerEvent = {
    pointer_id: number; // 0 = mouse
    kind: PointerKind;

    x: number;
    y: number;
    prev_x?: number;
    prev_y?: number;

    step_dx: number;
    step_dy: number;

    button: number;

    shift: boolean;
    ctrl: boolean;
    alt: boolean;
    meta: boolean;

    buttons: number;
    cell?: Cell;

    // click synthesis (optional)
    click_count?: 1 | 2;
};

export type DragKind = 'drag_start' | 'drag_move' | 'drag_end';

export type DragEvent = {
    pointer_id: number;        // 0 = mouse
    kind: DragKind;

    x: number;                 // current tile
    y: number;

    start_x: number;           // tile where mouse went down
    start_y: number;

    dx: number;                // current - start
    dy: number;

    step_dx: number;           // current - previous
    step_dy: number;

    buttons: number;
    cell?: Cell;
};

// this is the parent to anything that lives on the screen that can be interacted with. 
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
    OnContextMenu?(e: PointerEvent): void;
    OnDragStart?(e: DragEvent): void;
    OnDragMove?(e: DragEvent): void;
    OnDragEnd?(e: DragEvent): void;
    Focusable?: boolean;
    OnFocus?(): void;
    OnBlur?(): void;
    OnWheel?(e: WheelEvent): void;
    // keyboard lanes
    OnKeyDown?(e: KeyboardEvent): void;
    OnKeyUp?(e: KeyboardEvent): void;
    OnTextInput?(text: string): void;
    // optional global shortcut lane (UI calls first)
    OnGlobalKeyDown?(e: KeyboardEvent): void;

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
