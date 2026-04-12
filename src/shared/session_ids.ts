export function generateSessionId(options?: { suffixLength?: number }): string {
  const timestamp = Date.now();
  const suffixLength = Math.max(1, Math.floor(Number(options?.suffixLength ?? 8)) || 8);
  const rawSuffix = Math.random().toString(36).substring(2).toLowerCase();
  const suffix = rawSuffix.padEnd(suffixLength, "0").slice(0, suffixLength);
  return `session_${timestamp}_${suffix}`;
}
