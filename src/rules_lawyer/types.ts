export type RuleEffect = {
    line: string;
    event_ref?: string;
};

export type RuleResult = {
    event_lines: string[];
    effect_lines: string[];
};
