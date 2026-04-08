import { clamp_mag } from "./core.js";

export type SemanticValue = 'darkest' | '2nd_darkest' | '2nd_lightest' | 'lightest';
export type LightMag = -1 | 0 | 1 | 2;

export type LightingTransferTable = {
  darkest: SemanticValue;
  '2nd_darkest': SemanticValue;
  '2nd_lightest': SemanticValue;
  lightest: SemanticValue;
};

export const DEFAULT_LIGHT_MAG: LightMag = 1;
export const SUPPORTED_LIGHT_MAGS: readonly LightMag[] = [-1, 0, 1, 2] as const;

// First-pass lighting transfer tables transcribed from the renderer handoff sheet.
// These are exact preset buckets for now; broader MAG interpolation can come later.
export const LIGHT_MAG_TRANSFER_TABLES: Record<LightMag, LightingTransferTable> = {
  [-1]: {
    darkest: 'darkest',
    '2nd_darkest': 'darkest',
    '2nd_lightest': '2nd_darkest',
    lightest: '2nd_darkest',
  },
  [0]: {
    darkest: 'darkest',
    '2nd_darkest': '2nd_darkest',
    '2nd_lightest': '2nd_darkest',
    lightest: '2nd_lightest',
  },
  [1]: {
    darkest: 'darkest',
    '2nd_darkest': '2nd_darkest',
    '2nd_lightest': '2nd_lightest',
    lightest: 'lightest',
  },
  [2]: {
    darkest: '2nd_darkest',
    '2nd_darkest': '2nd_lightest',
    '2nd_lightest': 'lightest',
    lightest: 'lightest',
  },
};

export function light_mag_from_legacy_label(value: unknown, fallback: LightMag = DEFAULT_LIGHT_MAG): LightMag {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'dark':
      return -1;
    case 'dim':
      return 0;
    case 'bright+':
      return 2;
    case 'bright':
      return 1;
    default:
      return fallback;
  }
}

export function normalize_light_mag(value: unknown, fallback: LightMag = DEFAULT_LIGHT_MAG): LightMag {
  const clamped = clamp_mag(value, SUPPORTED_LIGHT_MAGS[0], SUPPORTED_LIGHT_MAGS[SUPPORTED_LIGHT_MAGS.length - 1], fallback);
  if (clamped === -1 || clamped === 0 || clamped === 1 || clamped === 2) return clamped;
  return fallback;
}

export function resolve_light_mag(value: unknown, legacy_value?: unknown, fallback: LightMag = DEFAULT_LIGHT_MAG): LightMag {
  if (value !== undefined && value !== null && value !== '') return normalize_light_mag(value, fallback);
  return light_mag_from_legacy_label(legacy_value, fallback);
}

export function get_lighting_transfer_table(light_mag: unknown, legacy_value?: unknown): LightingTransferTable {
  const resolved_mag = resolve_light_mag(light_mag, legacy_value);
  return LIGHT_MAG_TRANSFER_TABLES[resolved_mag];
}

export function project_lit_semantic_value(value: SemanticValue, light_mag: unknown, legacy_value?: unknown): SemanticValue {
  const table = get_lighting_transfer_table(light_mag, legacy_value);
  return table[value];
}

export function describe_light_mag(light_mag: unknown, legacy_value?: unknown): string {
  switch (resolve_light_mag(light_mag, legacy_value)) {
    case -1:
      return 'dark';
    case 0:
      return 'dim';
    case 2:
      return 'bright+';
    case 1:
    default:
      return 'bright';
  }
}
