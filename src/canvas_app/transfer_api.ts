export type GridTarget = { x: number; y: number } | null;

export type ApiOk<T extends object = {}> = { ok: true } & T;
export type ApiErr = { ok: false; error: string; http_status?: number; detail?: any };
export type ApiResult<T extends object = {}> = ApiOk<T> | ApiErr;

async function post_json<T extends object = {}>(url: string, body: any): Promise<ApiResult<T>> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    });
    const out = await res.json().catch(() => null as any);
    if (res.ok && out?.ok) return { ok: true, ...(out as any) };
    return { ok: false, error: out?.error || `HTTP ${res.status}`, http_status: res.status, detail: out?.detail };
}

export function parse_place_item_container_id(src: string): { place_id: string; container_item_id: string } | null {
    // place.item.<place_id>.<container_item_id>
    const parts = String(src || '').split('.');
    if (parts[0] !== 'place' || parts[1] !== 'item') return null;
    const place_id = parts[2];
    const container_item_id = parts[3];
    if (!place_id || !container_item_id) return null;
    return { place_id, container_item_id };
}

export type WithdrawFromGroundContainerItemArgs = {
    base_url: string;
    actor_id: string;
    src_container_id: string;
    item_id: string;
    to_container: string;
    target_grid_x?: number;
    target_grid_y?: number;
    action_cost?: number;
};

export async function api_withdraw_from_ground_container_item(
    args: WithdrawFromGroundContainerItemArgs,
): Promise<ApiResult<{ place_id: string }>> {
    const parsed = parse_place_item_container_id(args.src_container_id);
    if (!parsed) return { ok: false, error: 'invalid_from_container' };

    const res = await fetch(`${args.base_url}/api/place/items/withdraw_from_container_item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            actor_id: args.actor_id,
            place_id: parsed.place_id,
            container_item_id: parsed.container_item_id,
            item_id: args.item_id,
            to_container: args.to_container,
            target_grid_x: args.target_grid_x,
            target_grid_y: args.target_grid_y,
            action_cost: args.action_cost,
        }),
    });
    const out = await res.json().catch(() => null as any);
    if (res.ok && out?.ok) return { ok: true, place_id: parsed.place_id };
    return { ok: false, error: out?.error || `HTTP ${res.status}`, http_status: res.status, detail: out?.detail };
}

export type PickupToArgs = {
    base_url: string;
    actor_id: string;
    place_id: string;
    item_id: string;
    to_container: string;
    action_cost?: number;
};

export async function api_pickup_to(args: PickupToArgs): Promise<{ ok: true } | { ok: false; error: string; http_status?: number; detail?: any }> {
    const res = await fetch(`${args.base_url}/api/place/items/pickup_to`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            actor_id: args.actor_id,
            place_id: args.place_id,
            item_id: args.item_id,
            to_container: args.to_container,
            action_cost: args.action_cost,
        }),
    });
    const out = await res.json().catch(() => null as any);
    if (res.ok && out?.ok) return { ok: true };
    return { ok: false, error: out?.error || `HTTP ${res.status}`, http_status: res.status, detail: out?.detail };
}

export type TransferArgs = {
    transfer_base_url?: string;
    actor_id: string;
    item_instance_id: string;
    from_container: string;
    to_container: string;
    target_grid_x?: number;
    target_grid_y?: number;
};

export async function api_transfer_inline(args: TransferArgs): Promise<ApiResult> {
    const base = args.transfer_base_url ?? 'http://localhost:8787';
    const res = await fetch(`${base}/api/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            actor_id: args.actor_id,
            item_instance_id: args.item_instance_id,
            from_container: args.from_container,
            to_container: args.to_container,
            target_grid_x: args.target_grid_x,
            target_grid_y: args.target_grid_y,
        }),
    });
    const out = await res.json().catch(() => null as any);
    if (res.ok && out?.ok) return { ok: true };
    return { ok: false, error: out?.error || `HTTP ${res.status}`, http_status: res.status, detail: out?.detail };
}

export type DepositToContainerItemArgs = {
    base_url: string;
    actor_id: string;
    place_id: string;
    item_id: string;
    container_item_id: string;
    target_grid_x?: number;
    target_grid_y?: number;
    action_cost?: number;
};

export async function api_deposit_to_container_item(args: DepositToContainerItemArgs): Promise<ApiResult> {
    const res = await fetch(`${args.base_url}/api/place/items/deposit_to_container_item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            actor_id: args.actor_id,
            place_id: args.place_id,
            item_id: args.item_id,
            container_item_id: args.container_item_id,
            target_grid_x: args.target_grid_x,
            target_grid_y: args.target_grid_y,
            action_cost: args.action_cost,
        }),
    });
    const out = await res.json().catch(() => null as any);
    if (res.ok && out?.ok) return { ok: true };
    return { ok: false, error: out?.error || `HTTP ${res.status}`, http_status: res.status, detail: out?.detail };
}

function parse_place_id_from_place_source_container_id(src: string): string | null {
    // place.ground.<place_id>.* OR place.pile.<place_id>.*
    const parts = String(src || '').split('.');
    if (parts[0] !== 'place') return null;
    if (parts[1] !== 'ground' && parts[1] !== 'pile') return null;
    return parts[2] || null;
}

export type MovePlaceSourcedArgs = {
    base_url: string;
    actor_id: string;
    source_container_id: string;
    item_id: string;
    to_container: string;
    target_grid_x?: number;
    target_grid_y?: number;
    action_cost?: number;
};

export async function api_move_place_sourced_item(args: MovePlaceSourcedArgs): Promise<ApiResult<{ place_id: string }>> {
    const src = String(args.source_container_id ?? '');
    if (src.startsWith('place.item.')) {
        return api_withdraw_from_ground_container_item({
            base_url: args.base_url,
            actor_id: args.actor_id,
            src_container_id: src,
            item_id: args.item_id,
            to_container: args.to_container,
            target_grid_x: args.target_grid_x,
            target_grid_y: args.target_grid_y,
            action_cost: args.action_cost,
        });
    }

    const place_id = parse_place_id_from_place_source_container_id(src);
    if (!place_id) return { ok: false, error: 'invalid_place_source' };
    const pickup = await api_pickup_to({
        base_url: args.base_url,
        actor_id: args.actor_id,
        place_id,
        item_id: args.item_id,
        to_container: args.to_container,
        action_cost: args.action_cost,
    });
    if (pickup.ok) return { ok: true, place_id };
    return pickup;
}

export type MoveActorSourcedToGroundContainerItemArgs = {
    base_url: string;
    actor_id: string;
    item_id: string;
    dest_container_id: string;
    target_grid_x: number;
    target_grid_y: number;
    action_cost?: number;
};

export async function api_move_actor_sourced_item_to_ground_container_item(
    args: MoveActorSourcedToGroundContainerItemArgs,
): Promise<ApiResult<{ place_id: string }>> {
    const parsed = parse_place_item_container_id(args.dest_container_id);
    if (!parsed) return { ok: false, error: 'invalid_to_container' };
    const out = await api_deposit_to_container_item({
        base_url: args.base_url,
        actor_id: args.actor_id,
        place_id: parsed.place_id,
        item_id: args.item_id,
        container_item_id: parsed.container_item_id,
        target_grid_x: args.target_grid_x,
        target_grid_y: args.target_grid_y,
        action_cost: args.action_cost,
    });
    if (out.ok) return { ok: true, place_id: parsed.place_id };
    return out;
}

export type PlaceDragArgs = {
    base_url: string;
    actor_id: string;
    place_id: string;
    from_x: number;
    from_y: number;
    to_x: number;
    to_y: number;
    mode?: 'pile';
    item_id?: string;
    action_cost?: number;
};

export async function api_place_drag(args: PlaceDragArgs): Promise<ApiResult> {
    return post_json(`${args.base_url}/api/place/items/drag`, {
        actor_id: args.actor_id,
        place_id: args.place_id,
        from_x: args.from_x,
        from_y: args.from_y,
        to_x: args.to_x,
        to_y: args.to_y,
        mode: args.mode,
        item_id: args.item_id,
        action_cost: args.action_cost,
    });
}

export type PlaceDropArgs = {
    base_url: string;
    actor_id: string;
    place_id: string;
    item_id: string;
    x: number;
    y: number;
};

export async function api_place_drop(args: PlaceDropArgs): Promise<ApiResult> {
    return post_json(`${args.base_url}/api/place/items/drop`, {
        actor_id: args.actor_id,
        place_id: args.place_id,
        item_id: args.item_id,
        x: args.x,
        y: args.y,
    });
}

export type SpillFromContainerItemArgs = {
    base_url: string;
    actor_id: string;
    place_id: string;
    container_item_id: string;
    item_id: string;
    x: number;
    y: number;
    action_cost?: number;
};

export async function api_spill_from_container_item(args: SpillFromContainerItemArgs): Promise<ApiResult> {
    return post_json(`${args.base_url}/api/place/items/spill_from_container_item`, {
        actor_id: args.actor_id,
        place_id: args.place_id,
        container_item_id: args.container_item_id,
        item_id: args.item_id,
        x: args.x,
        y: args.y,
        action_cost: args.action_cost,
    });
}

export type TransferBetweenContainerItemsArgs = {
    base_url: string;
    actor_id: string;
    place_id: string;
    from_container_item_id: string;
    to_container_item_id: string;
    item_id: string;
    target_grid_x?: number;
    target_grid_y?: number;
    action_cost?: number;
};

export async function api_transfer_between_container_items(args: TransferBetweenContainerItemsArgs): Promise<ApiResult> {
    return post_json(`${args.base_url}/api/place/items/transfer_between_container_items`, {
        actor_id: args.actor_id,
        place_id: args.place_id,
        from_container_item_id: args.from_container_item_id,
        to_container_item_id: args.to_container_item_id,
        item_id: args.item_id,
        target_grid_x: args.target_grid_x,
        target_grid_y: args.target_grid_y,
        action_cost: args.action_cost,
    });
}

export type DepositGroundToContainerItemArgs = {
    base_url: string;
    actor_id: string;
    place_id: string;
    from_x: number;
    from_y: number;
    item_id: string;
    container_item_id: string;
    target_grid_x?: number;
    target_grid_y?: number;
    action_cost?: number;
};

export async function api_deposit_ground_to_container_item(args: DepositGroundToContainerItemArgs): Promise<ApiResult> {
    return post_json(`${args.base_url}/api/place/items/deposit_ground_to_container_item`, {
        actor_id: args.actor_id,
        place_id: args.place_id,
        from_x: args.from_x,
        from_y: args.from_y,
        item_id: args.item_id,
        container_item_id: args.container_item_id,
        target_grid_x: args.target_grid_x,
        target_grid_y: args.target_grid_y,
        action_cost: args.action_cost,
    });
}

export type ReorderPileArgs = {
    base_url: string;
    actor_id: string;
    place_id: string;
    position_key: string;
    item_id: string;
    target_slot_index: number;
    action_cost?: number;
};

export async function api_reorder_pile(args: ReorderPileArgs): Promise<ApiResult> {
    return post_json(`${args.base_url}/api/place/items/reorder_pile`, {
        actor_id: args.actor_id,
        place_id: args.place_id,
        position_key: args.position_key,
        item_id: args.item_id,
        target_slot_index: args.target_slot_index,
        action_cost: args.action_cost,
    });
}

export type MoveWithinContainerItemArgs = {
    base_url: string;
    actor_id: string;
    place_id: string;
    container_item_id: string;
    item_id: string;
    target_grid_x?: number;
    target_grid_y?: number;
};

export async function api_move_within_container_item(args: MoveWithinContainerItemArgs): Promise<ApiResult> {
    return post_json(`${args.base_url}/api/place/items/move_within_container_item`, {
        actor_id: args.actor_id,
        place_id: args.place_id,
        container_item_id: args.container_item_id,
        item_id: args.item_id,
        target_grid_x: args.target_grid_x,
        target_grid_y: args.target_grid_y,
    });
}
