export type DerivedOptions = {
    set_current_to_max?: boolean;
};

export type Effector = {
    type: "SHIFT" | "SCALE";
    value: number;
    source_type?: "item" | "tag" | "tile" | "character" | "perk";
    source_ref?: string;
};

function stat_bonus(stat: number): number {
    return Math.floor((stat - 50) / 2);
}

function get_number(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function apply_effectors(base: number, effectors: Effector[] | undefined): number {
    if (!effectors || effectors.length === 0) return Math.floor(base);
    let shifted = base;
    let scale = 1;
    for (const eff of effectors) {
        if (eff.type === "SHIFT") shifted += eff.value;
        if (eff.type === "SCALE") scale *= eff.value;
    }
    return Math.floor(shifted * scale);
}

function read_effectors(actor: Record<string, unknown>, key: string): Effector[] {
    const map = actor.derived_effectors as Record<string, unknown> | undefined;
    if (!map) return [];
    const list = map[key];
    if (!Array.isArray(list)) return [];
    return list as Effector[];
}

export function apply_level1_derived(actor: Record<string, unknown>, options: DerivedOptions = {}): void {
    const stats = (actor.stats as Record<string, unknown>) ?? {};
    const profs = (actor.profs as Record<string, unknown>) ?? {};

    const con_bonus = stat_bonus(get_number(stats.con, 50));
    const str_bonus = stat_bonus(get_number(stats.str, 50));
    const dex_bonus = stat_bonus(get_number(stats.dex, 50));
    const brawn_mag = get_number(profs.brawn, 0);
    const size_mag = get_number(actor.size_mag, 0);

    const carry_capacity_base = (2 + size_mag + str_bonus + brawn_mag) * 20;
    const carry_capacity = apply_effectors(carry_capacity_base, read_effectors(actor, "carry_capacity"));
    const inventory_weight = get_number(actor.inventory_weight, 0);
    const equipment_weight = get_number(actor.equipment_weight, 0);
    const excess_inventory = Math.max(0, inventory_weight - carry_capacity);
    const weight_penalty = Math.floor((equipment_weight + excess_inventory) / 5);

    const naked_evasion_base = 10 + dex_bonus;
    const naked_evasion = apply_effectors(naked_evasion_base, read_effectors(actor, "naked_evasion"));
    const evasion_base = naked_evasion - weight_penalty;
    const evasion = apply_effectors(evasion_base, read_effectors(actor, "evasion"));

    const health_max_base = 10 + con_bonus;
    const health_max = apply_effectors(health_max_base, read_effectors(actor, "health_max"));
    const vigor_max = apply_effectors(1, read_effectors(actor, "vigor_max"));

    const derived = (actor.derived as Record<string, unknown>) ?? {};
    derived.carry_capacity = carry_capacity;
    derived.weight_penalty = weight_penalty;
    derived.evasion = evasion;
    derived.naked_evasion = naked_evasion;
    actor.derived = derived;

    const resources = (actor.resources as Record<string, unknown>) ?? {};
    const health = (resources.health as Record<string, unknown>) ?? {};
    const vigor = (resources.vigor as Record<string, unknown>) ?? {};

    health.max = health_max;
    vigor.max = vigor_max;

    if (options.set_current_to_max) {
        health.current = health_max;
        vigor.current = vigor_max;
    } else {
        const current_health = get_number(health.current, health_max);
        const current_vigor = get_number(vigor.current, vigor_max);
        health.current = Math.min(current_health, health_max);
        vigor.current = Math.min(current_vigor, vigor_max);
    }

    resources.health = health;
    resources.vigor = vigor;
    actor.resources = resources;
}
