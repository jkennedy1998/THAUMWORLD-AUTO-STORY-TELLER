import { randomBytes } from 'node:crypto';
import type { RemoteRelayAppKind, RemoteRelayRoomSummary, RemoteRelayVisibility } from '../shared/remote_relay_protocol.js';

type RelayAttachTokenRecord = {
  token: string;
  created_at_ms: number;
  last_used_at_ms: number;
  http_request_count: number;
  ws_attached_at_ms?: number;
};

type RelayRoomRecord = {
  room_id: string;
  join_code: string;
  visibility: RemoteRelayVisibility;
  app_kind: RemoteRelayAppKind;
  slot: number;
  world_label?: string | null;
  host_display_name?: string | null;
  painter_document_id?: string | null;
  host_token: string;
  created_at_ms: number;
  updated_at_ms: number;
  lease_expires_at_ms: number;
  host_online: boolean;
  attach_tokens: Map<string, RelayAttachTokenRecord>;
};

const ATTACH_TOKEN_TTL_MS = 2 * 60 * 1000;
const ATTACH_TOKEN_HTTP_MAX_USES = 64;
const ROOM_LEASE_TTL_MS = 2 * 60 * 1000;

function make_id(prefix: string, bytes = 12): string {
  return `${prefix}_${randomBytes(bytes).toString('hex')}`;
}

function make_join_code(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

export class RemoteRelayStore {
  private readonly roomsById = new Map<string, RelayRoomRecord>();
  private readonly roomsByJoinCode = new Map<string, RelayRoomRecord>();
  private readonly roomsByHostToken = new Map<string, RelayRoomRecord>();

  private toSummary(room: RelayRoomRecord): RemoteRelayRoomSummary {
    return {
      room_id: room.room_id,
      join_code: room.join_code,
      visibility: room.visibility,
      app_kind: room.app_kind,
      host_display_name: room.host_display_name ?? null,
      world_label: room.world_label ?? null,
    };
  }

  private pruneAttachTokens(room: RelayRoomRecord): void {
    const now = Date.now();
    for (const [token, record] of room.attach_tokens.entries()) {
      if ((record.created_at_ms + ATTACH_TOKEN_TTL_MS) < now) {
        room.attach_tokens.delete(token);
      }
    }
  }

  private removeRoom(room: RelayRoomRecord): void {
    this.roomsById.delete(room.room_id);
    this.roomsByJoinCode.delete(room.join_code.toLowerCase());
    this.roomsByHostToken.delete(room.host_token);
  }

  private pruneExpiredRooms(): void {
    const now = Date.now();
    for (const room of this.roomsById.values()) {
      if (room.lease_expires_at_ms < now) {
        this.removeRoom(room);
      }
    }
  }

  registerHost(args: {
    slot: number;
    app_kind: RemoteRelayAppKind;
    visibility: RemoteRelayVisibility;
    world_label?: string | null;
    host_display_name?: string | null;
    painter_document_id?: string | null;
  }): { room: RemoteRelayRoomSummary; host_token: string; lease_expires_at_ms: number } {
    const room: RelayRoomRecord = {
      room_id: make_id('room'),
      join_code: make_join_code(),
      visibility: args.visibility,
      app_kind: args.app_kind,
      slot: Math.max(1, Math.floor(Number(args.slot) || 1)),
      world_label: args.world_label ?? null,
      host_display_name: args.host_display_name ?? null,
      painter_document_id: args.painter_document_id ?? null,
      host_token: make_id('host'),
      created_at_ms: Date.now(),
      updated_at_ms: Date.now(),
      lease_expires_at_ms: Date.now() + ROOM_LEASE_TTL_MS,
      host_online: false,
      attach_tokens: new Map(),
    };
    this.roomsById.set(room.room_id, room);
    this.roomsByJoinCode.set(room.join_code.toLowerCase(), room);
    this.roomsByHostToken.set(room.host_token, room);
    return { room: this.toSummary(room), host_token: room.host_token, lease_expires_at_ms: room.lease_expires_at_ms };
  }

  refreshHost(host_token: string): { room: RemoteRelayRoomSummary; lease_expires_at_ms: number } | null {
    this.pruneExpiredRooms();
    const room = this.roomsByHostToken.get(String(host_token ?? '').trim());
    if (!room) return null;
    room.updated_at_ms = Date.now();
    room.lease_expires_at_ms = room.updated_at_ms + ROOM_LEASE_TTL_MS;
    return { room: this.toSummary(room), lease_expires_at_ms: room.lease_expires_at_ms };
  }

  closeHost(host_token: string): { room_id: string } | null {
    this.pruneExpiredRooms();
    const room = this.roomsByHostToken.get(String(host_token ?? '').trim());
    if (!room) return null;
    this.removeRoom(room);
    return { room_id: room.room_id };
  }

  resolveJoinCode(join_code: string): { room: RemoteRelayRoomSummary; attach_token: string; host_online: boolean } | null {
    this.pruneExpiredRooms();
    const room = this.roomsByJoinCode.get(String(join_code ?? '').trim().toLowerCase());
    if (!room) return null;
    this.pruneAttachTokens(room);
    const token = make_id('attach');
    room.attach_tokens.set(token, {
      token,
      created_at_ms: Date.now(),
      last_used_at_ms: Date.now(),
      http_request_count: 0,
    });
    room.updated_at_ms = Date.now();
    return { room: this.toSummary(room), attach_token: token, host_online: room.host_online };
  }

  getRoomByHostToken(host_token: string): RelayRoomRecord | null {
    this.pruneExpiredRooms();
    return this.roomsByHostToken.get(String(host_token ?? '').trim()) ?? null;
  }

  getRoomById(room_id: string): RelayRoomRecord | null {
    this.pruneExpiredRooms();
    return this.roomsById.get(String(room_id ?? '').trim()) ?? null;
  }

  useAttachTokenForHttp(room_id: string, attach_token: string): RelayRoomRecord | null {
    const room = this.getRoomById(room_id);
    if (!room) return null;
    this.pruneAttachTokens(room);
    const record = room.attach_tokens.get(String(attach_token ?? '').trim());
    if (!record) return null;
    if (record.http_request_count >= ATTACH_TOKEN_HTTP_MAX_USES) {
      room.attach_tokens.delete(record.token);
      return null;
    }
    record.http_request_count += 1;
    record.last_used_at_ms = Date.now();
    return room;
  }

  useAttachTokenForBridgeWs(room_id: string, attach_token: string): RelayRoomRecord | null {
    const room = this.getRoomById(room_id);
    if (!room) return null;
    this.pruneAttachTokens(room);
    const record = room.attach_tokens.get(String(attach_token ?? '').trim());
    if (!record || record.ws_attached_at_ms) return null;
    record.ws_attached_at_ms = Date.now();
    record.last_used_at_ms = record.ws_attached_at_ms;
    return room;
  }

  markHostOnline(room_id: string, online: boolean): void {
    const room = this.getRoomById(room_id);
    if (!room) return;
    room.host_online = online;
    room.updated_at_ms = Date.now();
  }
}

export type { RelayRoomRecord };
