import type { TagInstance } from "./registry.js";

function stable_stringify(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number" || t === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map(stable_stringify).join(",")}]`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable_stringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/**
 * Compute a deterministic identity key for a tag instance.
 *
 * - Includes: name, dim_mag, meta, info, source, expiry, scope
 * - Excludes: mag (stacks are tracked separately per key)
 *
 * This enables multi-instance tags with the same name but different metadata.
 */
export function tag_key(tag: TagInstance): string {
  const name = String(tag?.name ?? "");
  const dim_mag = tag?.dim_mag && typeof tag.dim_mag === "object"
    ? Object.fromEntries(
        Object.entries(tag.dim_mag)
          .map(([key, value]) => ({ key: String(key ?? "").trim(), value: typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0 }))
          .filter((entry) => entry.key.length > 0)
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((entry) => [entry.key, entry.value]),
      )
    : null;
  const meta = Array.isArray(tag?.meta) ? [...tag.meta].map((m) => String(m ?? "")).sort() : [];
  const scope = Array.isArray(tag?.scope) ? [...tag.scope].map((s) => String(s ?? "")).sort() : [];
  const info = tag?.info ?? null;
  const source = typeof tag?.source === "string" ? tag.source : null;
  const expiry = typeof tag?.expiry === "number" && Number.isFinite(tag.expiry) ? tag.expiry : null;
  return stable_stringify({ name, dim_mag, meta, info, source, expiry, scope });
}
