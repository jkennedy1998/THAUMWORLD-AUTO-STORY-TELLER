export type EquipmentSlotItem = string | Record<string, unknown>;

export const STANDARD_BODY_SLOTS = {
    head: 'head',
    torso: 'torso',
    hand_left: 'hand_left',
    hand_right: 'hand_right',
    leg_left: 'leg_left',
    leg_right: 'leg_right',
} as const;

export const SLOT_DISPLAY_NAMES: Record<string, string> = {
    head: 'HEAD',
    torso: 'TORSO',
    hand_left: 'LEFT HAND',
    hand_right: 'RIGHT HAND',
    leg_left: 'LEFT LEG',
    leg_right: 'RIGHT LEG',
};

export interface EquipmentSlot {
    name: string;
    critical: boolean;
    armor: EquipmentSlotItem | null;
    garb: EquipmentSlotItem[];
    tool: EquipmentSlotItem | null;
}

export type EquipmentSlots = Record<string, EquipmentSlot>;

export const SLOT_TYPE_CATEGORIES: Record<string, string[]> = {
    head: ['armor', 'garb'],
    torso: ['armor', 'garb'],
    hand_left: ['armor', 'garb', 'tool'],
    hand_right: ['armor', 'garb', 'tool'],
    leg_left: ['armor', 'garb'],
    leg_right: ['armor', 'garb'],
};

export const SLOT_TYPE_CAPACITY: Record<string, number> = {
    armor: 1,
    garb: Infinity,
    tool: 1,
};

export const SLOT_TYPE_COLORS = {
    armor: { r: 60, g: 120, b: 220 },
    garb: { r: 60, g: 180, b: 100 },
    tool: { r: 220, g: 60, b: 60 },
};

export type EquipValidationResult =
    | { valid: true }
    | { valid: false; reason: string };

function normalize_slot_name(slot_name: string): string {
    return String(slot_name ?? '').toLowerCase().replace(/\s+/g, '_');
}

function is_hand_slot(slot_name: string): boolean {
    return slot_name === 'hand_left' || slot_name === 'hand_right';
}

function normalize_item_ref(value: unknown): EquipmentSlotItem | null {
    if (typeof value === 'string' && value.trim().length > 0) return value;
    if (value && typeof value === 'object') return value as Record<string, unknown>;
    return null;
}

export function create_equipment_slot(name: string, critical: boolean = false): EquipmentSlot {
    return {
        name: normalize_slot_name(name),
        critical: Boolean(critical),
        armor: null,
        garb: [],
        tool: null,
    };
}

export function initialize_equipment_slots(
    parts: Array<{ slot: string; critical?: boolean }> | undefined
): EquipmentSlots {
    const slots: EquipmentSlots = {};
    if (!parts || parts.length === 0) return slots;

    for (const part of parts) {
        const name = normalize_slot_name(String(part.slot ?? ''));
        if (!name) continue;
        slots[name] = create_equipment_slot(name, Boolean(part.critical));
    }

    return slots;
}

export function normalize_body_slots(body_slots: unknown): EquipmentSlots {
    if (!body_slots || typeof body_slots !== 'object') return {};

    const normalized: EquipmentSlots = {};
    for (const [raw_name, raw_slot] of Object.entries(body_slots as Record<string, unknown>)) {
        const slot = raw_slot as Record<string, unknown> | null | undefined;
        const name = normalize_slot_name(String(slot?.name ?? raw_name ?? ''));
        if (!name) continue;

        const critical = Boolean(slot?.critical);
        const next = create_equipment_slot(name, critical);

        if (slot && ('armor' in slot || 'garb' in slot || 'tool' in slot)) {
            next.armor = normalize_item_ref(slot.armor);
            next.tool = normalize_item_ref(slot.tool);
            next.garb = Array.isArray(slot.garb)
                ? slot.garb.map(normalize_item_ref).filter((item): item is EquipmentSlotItem => item !== null)
                : [];
        } else {
            const legacy_item = normalize_item_ref(slot?.item_instance_id);
            if (legacy_item) {
                if (is_hand_slot(name)) {
                    next.tool = legacy_item;
                } else {
                    next.armor = legacy_item;
                }
            }
        }

        normalized[name] = next;
    }

    return normalized;
}

export function is_slot_empty(body_slots: EquipmentSlots, slot_name: string): boolean {
    return get_slot_item_id(body_slots, slot_name) === null;
}

export function get_slot_item_id(body_slots: EquipmentSlots, slot_name: string): string | null {
    const slot = body_slots[slot_name];
    if (!slot) return null;
    const first = slot.tool ?? slot.armor ?? slot.garb[0] ?? null;
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object' && typeof (first as { id?: unknown }).id === 'string') {
        return (first as { id: string }).id;
    }
    return null;
}

export function get_slot_all_item_ids(body_slots: EquipmentSlots, slot_name: string): string[] {
    const slot = body_slots[slot_name];
    if (!slot) return [];

    const ids: string[] = [];
    for (const value of [slot.tool, slot.armor, ...slot.garb]) {
        if (typeof value === 'string' && value) ids.push(value);
        else if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
            ids.push((value as { id: string }).id);
        }
    }
    return ids;
}

export function find_item_slot(body_slots: EquipmentSlots, item_instance_id: string): string | null {
    for (const slot_name of Object.keys(body_slots)) {
        if (get_slot_all_item_ids(body_slots, slot_name).includes(item_instance_id)) {
            return slot_name;
        }
    }
    return null;
}

export function is_item_equipped(body_slots: EquipmentSlots, item_instance_id: string): boolean {
    return find_item_slot(body_slots, item_instance_id) !== null;
}

export function get_occupied_slots(body_slots: EquipmentSlots): Array<{ slot_name: string; item_ids: string[] }> {
    const occupied: Array<{ slot_name: string; item_ids: string[] }> = [];
    for (const slot_name of Object.keys(body_slots)) {
        const item_ids = get_slot_all_item_ids(body_slots, slot_name);
        if (item_ids.length > 0) occupied.push({ slot_name, item_ids });
    }
    return occupied;
}
