export const STAT_VALUE_BLOCK = [56, 54, 52, 48, 46, 44];

export const PROF_NAMES = [
    "pain",
    "brawn",
    "accuracy",
    "speed",
    "quiet",
    "hearth",
    "beasts",
    "instinct",
    "resonation",
    "arcana",
    "golemancy",
    "history",
    "organica",
    "mechanics",
    "dietic",
    "stability",
    "deception",
    "power",
    "performance",
    "communication",
];

export type StatAssignment = Record<string, number>;

export function apply_prof_picks(base: Record<string, number>, picks: string[]): Record<string, number> {
    const next = { ...base };
    for (const pick of picks) {
        const key = pick.toLowerCase();
        const current = Number(next[key] ?? 0);
        next[key] = Math.min(2, current + 1);
    }
    return next;
}

export function make_empty_profs(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const prof of PROF_NAMES) out[prof] = 0;
    return out;
}

export function is_valid_prof(name: string): boolean {
    return PROF_NAMES.includes(name.toLowerCase());
}

export function shuffle<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

export function random_stat_assignment(): StatAssignment {
    const values = shuffle(STAT_VALUE_BLOCK);
    const stats = ["con", "str", "dex", "wis", "int", "cha"];
    const out: StatAssignment = {};
    for (let i = 0; i < stats.length; i++) {
        out[stats[i]] = values[i] ?? 50;
    }
    return out;
}

export function random_prof_picks(pick_count: number): string[] {
    const picks: string[] = [];
    const counts: Record<string, number> = {};
    while (picks.length < pick_count) {
        const prof = PROF_NAMES[Math.floor(Math.random() * PROF_NAMES.length)] ?? "";
        if (!prof) continue;
        const current = counts[prof] ?? 0;
        if (current >= 2) continue;
        counts[prof] = current + 1;
        picks.push(prof);
    }
    return picks;
}
