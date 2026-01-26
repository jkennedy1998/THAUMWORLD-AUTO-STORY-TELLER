export type AppliedDiff = {
    effect_id: string;
    target: string;
    field: string;
    delta: number;
    reason: string;
};

export type ApplyResult = {
    diffs: AppliedDiff[];
    warnings: string[];
};
