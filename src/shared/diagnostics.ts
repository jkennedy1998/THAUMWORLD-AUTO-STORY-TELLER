export type DiagnosticProgram = 'game' | 'ascii_painter';
export type DiagnosticCategory =
  | 'input'
  | 'physics'
  | 'renderer'
  | 'performance_metrics'
  | 'camera'
  | 'tai'
  | 'items'
  | 'npc'
  | 'network'
  | 'painter';

export type DiagnosticVerbosity = 'off' | 'important' | 'verbose' | 'trace';

type DiagnosticConfig = {
  program: DiagnosticProgram;
  categories: Partial<Record<DiagnosticCategory, DiagnosticVerbosity>>;
};

type RuntimeDiagnosticsApi = {
  get: () => DiagnosticConfig;
  set: (category: DiagnosticCategory, verbosity: DiagnosticVerbosity) => DiagnosticConfig;
  setMany: (categories: Partial<Record<DiagnosticCategory, DiagnosticVerbosity>>) => DiagnosticConfig;
  reset: () => DiagnosticConfig;
};

const CATEGORY_LIST: DiagnosticCategory[] = [
  'input',
  'physics',
  'renderer',
  'performance_metrics',
  'camera',
  'tai',
  'items',
  'npc',
  'network',
  'painter',
];

const VERBOSITY_ORDER: Record<DiagnosticVerbosity, number> = {
  off: 0,
  important: 1,
  verbose: 2,
  trace: 3,
};

const isNode = typeof process !== 'undefined' && !!process?.env;
const runtimeOverrides: Partial<Record<DiagnosticCategory, DiagnosticVerbosity>> = {};

function normalizeProgram(value: string | null | undefined): DiagnosticProgram {
  return String(value ?? '').trim().toLowerCase() === 'ascii_painter' ? 'ascii_painter' : 'game';
}

function normalizeVerbosity(value: unknown): DiagnosticVerbosity | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'off' || normalized === 'important' || normalized === 'verbose' || normalized === 'trace') {
    return normalized;
  }
  return null;
}

function getBootProgram(): DiagnosticProgram {
  const envValue = isNode ? process.env.THAUM_APP_MODE : (globalThis as any).__THAUM_APP_MODE;
  return normalizeProgram(envValue);
}

function getBootProfile(): 'quiet' | 'logs' {
  const envValue = isNode ? process.env.THAUM_DIAG_PROFILE : (globalThis as any).__THAUM_DIAG_PROFILE;
  return String(envValue ?? '').trim().toLowerCase() === 'logs' ? 'logs' : 'quiet';
}

function getProgramProfileDefaults(program: DiagnosticProgram, profile: 'quiet' | 'logs'): Partial<Record<DiagnosticCategory, DiagnosticVerbosity>> {
  if (profile === 'quiet') {
    return Object.fromEntries(CATEGORY_LIST.map((category) => [category, 'off'])) as Partial<Record<DiagnosticCategory, DiagnosticVerbosity>>;
  }
  if (program === 'ascii_painter') {
    return {
      input: 'important',
      renderer: 'important',
      performance_metrics: 'important',
      camera: 'important',
      tai: 'verbose',
      painter: 'verbose',
    };
  }
  return {
    input: 'important',
    physics: 'important',
    renderer: 'important',
    performance_metrics: 'important',
    camera: 'important',
    tai: 'verbose',
    items: 'important',
    npc: 'important',
    network: 'important',
  };
}

function parseCategoryOverrides(raw: string | null | undefined): Partial<Record<DiagnosticCategory, DiagnosticVerbosity>> {
  const out: Partial<Record<DiagnosticCategory, DiagnosticVerbosity>> = {};
  for (const segment of String(raw ?? '').split(',')) {
    const [categoryRaw, verbosityRaw] = segment.split('=');
    const category = String(categoryRaw ?? '').trim() as DiagnosticCategory;
    const verbosity = normalizeVerbosity(verbosityRaw);
    if (!CATEGORY_LIST.includes(category) || !verbosity) continue;
    out[category] = verbosity;
  }
  return out;
}

function getBootOverrides(): Partial<Record<DiagnosticCategory, DiagnosticVerbosity>> {
  const envValue = isNode ? process.env.THAUM_DIAG_CATEGORIES : (globalThis as any).__THAUM_DIAG_CATEGORIES;
  return parseCategoryOverrides(envValue);
}

function getEffectiveConfig(): DiagnosticConfig {
  const program = getBootProgram();
  const defaults = getProgramProfileDefaults(program, getBootProfile());
  return {
    program,
    categories: {
      ...defaults,
      ...getBootOverrides(),
      ...runtimeOverrides,
    },
  };
}

export function get_diagnostic_config(): DiagnosticConfig {
  return getEffectiveConfig();
}

export function diagnostic_enabled(category: DiagnosticCategory, verbosity: DiagnosticVerbosity = 'important'): boolean {
  const configured = getEffectiveConfig().categories[category] ?? 'off';
  return VERBOSITY_ORDER[configured] >= VERBOSITY_ORDER[verbosity];
}

type DiagLogOptions = {
  sink?: 'log' | 'warn' | 'error';
};

export function diag_log(category: DiagnosticCategory, verbosity: DiagnosticVerbosity, tag: string, message: string, payload?: Record<string, unknown>, options?: DiagLogOptions): void {
  if (!diagnostic_enabled(category, verbosity)) return;
  const { program } = getEffectiveConfig();
  const prefix = `[DIAG][${program}][${category}][${verbosity}][${tag}] ${message}`;
  const line = payload ? `${prefix} ${JSON.stringify(payload)}` : prefix;
  const sink = options?.sink ?? 'log';
  if (sink === 'warn') {
    console.warn(line);
    return;
  }
  if (sink === 'error') {
    console.error(line);
    return;
  }
  console.log(line);
}

export function set_diagnostic_verbosity(category: DiagnosticCategory, verbosity: DiagnosticVerbosity): DiagnosticConfig {
  runtimeOverrides[category] = verbosity;
  return getEffectiveConfig();
}

export function set_diagnostic_overrides(categories: Partial<Record<DiagnosticCategory, DiagnosticVerbosity>>): DiagnosticConfig {
  for (const [category, verbosity] of Object.entries(categories) as Array<[DiagnosticCategory, DiagnosticVerbosity | undefined]>) {
    const normalized = normalizeVerbosity(verbosity);
    if (!CATEGORY_LIST.includes(category) || !normalized) continue;
    runtimeOverrides[category] = normalized;
  }
  return getEffectiveConfig();
}

export function reset_diagnostic_overrides(): DiagnosticConfig {
  for (const key of Object.keys(runtimeOverrides) as DiagnosticCategory[]) {
    delete runtimeOverrides[key];
  }
  return getEffectiveConfig();
}

export function install_runtime_diagnostics_api(): void {
  if (typeof window === 'undefined') return;
  const api: RuntimeDiagnosticsApi = {
    get: () => getEffectiveConfig(),
    set: (category, verbosity) => set_diagnostic_verbosity(category, verbosity),
    setMany: (categories) => set_diagnostic_overrides(categories),
    reset: () => reset_diagnostic_overrides(),
  };
  (window as any).DIAGNOSTICS = api;
}
