export type ResolverError = {
    ref: string;
    reason: string;
    path?: string;
};

export type ResolverWarning = {
    ref: string;
    message: string;
};

export type ResolvedRef = {
    ref: string;
    id: string;
    type: "actor" | "npc" | "item" | "world_tile" | "region_tile" | "tile";
    owner_ref?: string;
    owner_type?: string;
    path?: string;
    representative?: boolean;
};

export type ResolverResult = {
    resolved: Record<string, ResolvedRef>;
    errors: ResolverError[];
    warnings: ResolverWarning[];
};

export type ResolverOptions = {
    slot: number;
    use_representative_data: boolean;
};
