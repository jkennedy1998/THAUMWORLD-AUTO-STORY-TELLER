export type PainterLaunchIntent =
  | { kind: 'new_document'; slot: number; persist_recent?: boolean }
  | { kind: 'resume_file'; slot: number; path: string; persist_recent?: boolean }
  | { kind: 'load_file'; slot: number; path: string; persist_recent?: boolean };
