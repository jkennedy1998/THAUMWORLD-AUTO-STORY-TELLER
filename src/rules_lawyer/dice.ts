export type DiceRoll = {
    expr: string;
    faces: number[];
    base: number;
};

type DiceParts = { count: number; sides: number };

let last_roll: DiceRoll | null = null;

function parse_expr(expr: string): DiceParts | null {
    const trimmed = expr.trim().toLowerCase();
    if (trimmed.startsWith("d")) {
        const sides = Number(trimmed.slice(1));
        if (!Number.isFinite(sides) || sides <= 0) return null;
        return { count: 1, sides };
    }

    const match = trimmed.match(/^(\d+)d(\d+)$/);
    if (!match) return null;
    const count = Number(match[1]);
    const sides = Number(match[2]);
    if (!Number.isFinite(count) || !Number.isFinite(sides) || count <= 0 || sides <= 0) return null;
    return { count, sides };
}

function roll_die(sides: number): number {
    return Math.floor(Math.random() * sides) + 1;
}

export function roll_expr(expr: string): DiceRoll | null {
    const parts = parse_expr(expr);
    if (!parts) return null;
    const faces: number[] = [];
    for (let i = 0; i < parts.count; i += 1) {
        faces.push(roll_die(parts.sides));
    }
    const base = faces.reduce((sum, n) => sum + n, 0);
    last_roll = { expr, faces, base };
    return last_roll;
}

export function get_last_roll(): DiceRoll | null {
    return last_roll;
}
