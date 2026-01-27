export type SenseName = "light" | "pressure" | "aroma" | "thaumic";

export type SenseContext = {
    distance_mag?: number;
    thin_walls?: number;
    thick_walls?: number;
    signal_mag?: number;
};

export type SenseClarity = "clear" | "obscured" | "none";

export function thaumic_wall_penalty(thin_walls?: number, thick_walls?: number): number {
    const thin = Number(thin_walls ?? 0);
    const thick = Number(thick_walls ?? 0);
    return thin + thick * 2;
}

export function compute_sense_range_mag(sense: SenseName, sense_mag: number, context: SenseContext = {}): number {
    const signal_mag = Number(context.signal_mag ?? 0);
    if (sense === "light") return sense_mag + signal_mag + 2;
    if (sense === "pressure") return sense_mag + signal_mag + 1;
    if (sense === "aroma") return sense_mag + signal_mag + 1;
    const effective_mag = sense_mag + signal_mag - thaumic_wall_penalty(context.thin_walls, context.thick_walls);
    return effective_mag;
}

export function compute_sense_clarity(range_mag: number, distance_mag: number | undefined): SenseClarity {
    if (distance_mag === undefined || !Number.isFinite(distance_mag)) return "clear";
    if (distance_mag <= range_mag) return "clear";
    if (distance_mag === range_mag + 1) return "obscured";
    return "none";
}
