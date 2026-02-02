// Lightweight, non-AI intent hinting.
// This module is intentionally browser-safe (no Node imports).

import type { ActionVerb } from "./constants.js";

export type IntentHint = {
    verb: ActionVerb | null;
    matched_keyword?: string;
    matched_mode?: "token" | "phrase";
    ambiguous?: boolean;
    candidates?: Array<{ verb: ActionVerb; score: number; matched: string }>;
};

export function tokenize_intent(text: string): string[] {
    const lowered = (text ?? "").toLowerCase();
    // Split on non-alphanumeric; keep short tokens like "go" because they're valid verbs.
    return lowered
        .split(/[^a-z0-9]+/g)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
}

function make_ngrams(tokens: string[], max_n: number): string[] {
    const grams: string[] = [];
    for (let n = 2; n <= max_n; n++) {
        for (let i = 0; i + n <= tokens.length; i++) {
            grams.push(tokens.slice(i, i + n).join(" "));
        }
    }
    return grams;
}

const VERB_KEYWORDS: Array<{ verb: ActionVerb; keywords: string[]; phrases?: string[] }> = [
    // COMMUNICATE
    { verb: "COMMUNICATE", keywords: ["say", "ask", "tell", "speak", "talk", "hello", "hi", "hey", "greet", "whisper", "shout", "yell", "signal"], phrases: ["talk to", "speak to", "ask about"] },
    // INSPECT
    { verb: "INSPECT", keywords: ["inspect", "look", "examine", "search", "scan", "survey", "check", "observe"], phrases: ["look around", "look at", "examine the"] },
    // MOVE
    { verb: "MOVE", keywords: ["move", "go", "walk", "run", "travel", "head", "approach", "enter", "leave", "north", "south", "east", "west"], phrases: ["go to", "walk to", "head to"] },
    // ATTACK
    { verb: "ATTACK", keywords: ["attack", "hit", "strike", "stab", "shoot", "kill", "punch", "slash", "swing"], phrases: ["attack the", "hit the"] },
    // USE
    { verb: "USE", keywords: ["use", "light", "ignite", "drink", "eat", "equip", "unequip", "wield", "wear", "consume"], phrases: ["pick up", "put on"] },
    // DEFENSIVE / SUPPORT
    { verb: "HELP", keywords: ["help", "assist", "aid"] },
    { verb: "DEFEND", keywords: ["defend", "block", "parry"] },
    { verb: "DODGE", keywords: ["dodge", "evade", "duck"] },
    { verb: "GRAPPLE", keywords: ["grapple", "grab", "wrestle"] },
    // CRAFTING / REST
    { verb: "CRAFT", keywords: ["craft", "make", "build", "forge", "brew"] },
    { verb: "SLEEP", keywords: ["sleep", "rest", "nap"] },
    { verb: "REPAIR", keywords: ["repair", "fix", "mend"] },
    // WORK / WATCH
    { verb: "WORK", keywords: ["work", "labor"] },
    { verb: "GUARD", keywords: ["guard", "watch"] },
    { verb: "HOLD", keywords: ["hold", "ready", "prepare"] },
];

export function infer_action_verb_hint(text: string): IntentHint {
    const tokens = tokenize_intent(text);
    if (tokens.length === 0) return { verb: null };

    const token_set = new Set(tokens);
    const phrases = make_ngrams(tokens, 3);
    const phrase_set = new Set(phrases);

    const scored: Array<{ verb: ActionVerb; score: number; matched: string; mode: "token" | "phrase" }> = [];

    for (const entry of VERB_KEYWORDS) {
        // Phrase hits are stronger
        if (Array.isArray(entry.phrases)) {
            for (const p of entry.phrases) {
                if (phrase_set.has(p)) {
                    scored.push({ verb: entry.verb, score: 3, matched: p, mode: "phrase" });
                }
            }
        }

        // Token hits
        for (const kw of entry.keywords) {
            if (token_set.has(kw)) {
                scored.push({ verb: entry.verb, score: 2, matched: kw, mode: "token" });
            }
        }
    }

    if (scored.length === 0) return { verb: null };

    // Pick best score; detect ambiguity
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0]!;
    const best_score = best.score;
    const top = scored.filter((s) => s.score === best_score);
    const unique_verbs = Array.from(new Set(top.map((t) => t.verb)));

    if (unique_verbs.length > 1) {
        return {
            verb: null,
            ambiguous: true,
            candidates: unique_verbs.map((v) => {
                const m = top.find((t) => t.verb === v)!;
                return { verb: v, score: m.score, matched: m.matched };
            }),
        };
    }

    return {
        verb: best.verb,
        matched_keyword: best.matched,
        matched_mode: best.mode,
    };
}

export function is_question_like(text: string): boolean {
    const t = (text ?? "").trim().toLowerCase();
    if (!t) return false;
    if (t.endsWith("?")) return true;
    // Common interrogatives
    return /^(what|why|how|who|where|when|can|could|would|should|do|does|did)\b/.test(t);
}
