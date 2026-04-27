export type EngineContentRefKind = 'file' | 'project' | 'user_scope' | 'workspace' | 'resource';

export type EngineContentRef = {
  kind: EngineContentRefKind;
  value: string;
};

export function normalize_content_ref(ref: EngineContentRef): EngineContentRef {
  const kind = String(ref?.kind ?? '').trim() as EngineContentRefKind;
  const value = String(ref?.value ?? '').trim();
  if (!kind) throw new Error('content_ref_kind_required');
  if (!value) throw new Error('content_ref_value_required');
  return { kind, value };
}

export function encode_content_ref_key(ref: EngineContentRef): string {
  const normalized = normalize_content_ref(ref);
  return `${normalized.kind}:${normalized.value}`;
}

export function content_refs_equal(a: EngineContentRef | null | undefined, b: EngineContentRef | null | undefined): boolean {
  if (!a || !b) return false;
  const left = normalize_content_ref(a);
  const right = normalize_content_ref(b);
  return left.kind === right.kind && left.value === right.value;
}
