import type { InspectionResult } from "./data_service.js";

type InspectPromptParams = {
  original_text: string;
  events: string[];
  effects: string[];
  context?: Record<string, unknown>;
};

function get_discovered_feature_lines(result: InspectionResult): string {
  const features = Array.isArray(result?.content?.features) ? result.content.features : [];
  return features
    .filter((f: any) => !!f && f.discovered === true)
    .slice(0, 6)
    .map((f: any) => `- ${String(f.description ?? f.name ?? "").trim()}`)
    .filter((s: string) => s.length > 2)
    .join("\n");
}

function get_sensory_lines(result: InspectionResult): string {
  const sensory = result?.content?.sensory_details;
  const sensory_lines: string[] = [];
  if (sensory && typeof sensory === "object") {
    for (const k of Object.keys(sensory)) {
      const arr = (sensory as any)[k];
      if (Array.isArray(arr) && arr.length > 0) {
        sensory_lines.push(`${k}: ${arr.slice(0, 6).join(", ")}`);
      }
    }
  }
  return sensory_lines.join(" | ");
}

export function build_inspect_narrative_prompt(params: InspectPromptParams): string {
  const ctx = params.context ?? {};
  const ir = (ctx as any).inspect_result as InspectionResult | undefined;

  if (ir && typeof ir === "object") {
    const clarity = String(ir.clarity ?? "unknown");
    const sense = String(ir.sense_used ?? "unknown");
    const short_desc = String(ir?.content?.short_description ?? "").trim();
    const full_desc = String(ir?.content?.full_description ?? "").trim();
    const feature_lines = get_discovered_feature_lines(ir);
    const sensory = get_sensory_lines(ir);

    return `The player inspects a target. Use ONLY the provided inspection result.

INSPECTION RESULT:
Clarity: ${clarity}
Sense: ${sense}
Short: ${short_desc || "(none)"}
Full: ${full_desc || "(none)"}
Sensory: ${sensory || "(none)"}
Notable features (discovered only):
${feature_lines || "- (none)"}

Write 1-2 concise sentences in second person.
Do NOT invent new features, items, identities, or facts.
If clarity is vague/obscured, keep it restrained and do not add extra detail beyond Short/Sensory/Notable features.`;
  }

  const raw_target = params.events[0]?.match(/target=([^,)]+)/)?.[1] || "the area";
  const has_findings = params.effects.length > 0;

  return `The player is inspecting ${raw_target}.
${has_findings ? "They discover something noteworthy." : "They find nothing of particular interest."}

Write a brief narrative (1-2 sentences) in second person.
Do not invent specific findings unless explicitly provided in the input.`;
}
