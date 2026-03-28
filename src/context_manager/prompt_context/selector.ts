import { hash_string, normalize_text } from "./utils.js";

function score_candidate(line: string, keywords: string[]): number {
    const lower = normalize_text(line);
    let score = 0;
    for (const keyword of keywords) {
        if (lower.includes(keyword)) score += 3;
    }
    return score;
}

export function select_deterministic(lines: string[], seed_key: string, keywords: string[], max_items: number): string[] {
    return lines
        .map((line, index) => {
            const relevance = score_candidate(line, keywords);
            const variance = hash_string(`${seed_key}:${index}:${line}`) % 997;
            return { line, relevance, variance };
        })
        .sort((a, b) => {
            if (b.relevance !== a.relevance) return b.relevance - a.relevance;
            return a.variance - b.variance;
        })
        .slice(0, max_items)
        .map((entry) => entry.line);
}
