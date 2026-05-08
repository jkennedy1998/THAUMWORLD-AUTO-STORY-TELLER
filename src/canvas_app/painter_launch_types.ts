export type PainterLaunchIntent =
  | { kind: 'new_document'; slot: number; persist_recent?: boolean }
  | { kind: 'resume_file'; slot: number; path: string; persist_recent?: boolean }
  | { kind: 'load_file'; slot: number; path: string; persist_recent?: boolean }
  | { kind: 'join_authoritative'; slot: number; document_id: string; display_name: string; join_target_id: string; api_base_url?: string | null; bridge_ws_base_url?: string | null; transport_kind?: 'direct_http_ws' | 'relay_ws_tunnel' | null; relay_room_id?: string | null; relay_attach_token?: string | null; host_boot_id?: string | null; persist_recent?: boolean };
