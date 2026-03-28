export function safe_text(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
}

export function normalize_text(v: string): string {
    return v.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
}

export function extract_keywords(text: string): string[] {
    return Array.from(new Set(
        normalize_text(text)
            .split(/\s+/)
            .map((word) => word.trim())
            .filter((word) => word.length >= 4)
    )).slice(0, 12);
}

export function hash_string(input: string): number {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
