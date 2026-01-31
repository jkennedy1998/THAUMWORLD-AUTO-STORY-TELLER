import type { CommandNode, ValueNode } from "../system_syntax/index.js";
import type { RuleResult } from "./types.js";
import type { SenseClarity, SenseContext, SenseName } from "./senses.js";
import { compute_sense_clarity, compute_sense_range_mag } from "./senses.js";
import { load_actor } from "../actor_storage/store.js";
import { load_npc } from "../npc_storage/store.js";
import { is_timed_event_active } from "../world_storage/store.js";

function format_command_line(command: CommandNode): string {
    const args = Object.entries(command.args)
        .map(([k, v]) => `${k}=${format_value(v)}`)
        .join(", ");
    return `${command.subject}.${command.verb}(${args})`;
}

function format_value(value: CommandNode["args"][string]): string {
    switch (value.type) {
        case "string":
            return `"${value.value}"`;
        case "number":
            return String(value.value);
        case "boolean":
            return value.value ? "true" : "false";
        case "identifier":
            return value.value;
        case "list":
            return `[${value.value.map(format_value).join(", ")}]`;
        case "object":
            return `{${Object.entries(value.value).map(([k, v]) => `${k}=${format_value(v)}`).join(", ")}}`;
        default:
            return "";
    }
}

function get_identifier(value: ValueNode | undefined): string | null {
    if (!value || value.type !== "identifier") return null;
    return value.value;
}

function get_number(value: ValueNode | undefined): number | null {
    if (!value || value.type !== "number") return null;
    return value.value;
}

function get_string(value: ValueNode | undefined): string | null {
    if (!value) return null;
    if (value.type === "identifier") return value.value;
    if (value.type === "string") return value.value;
    return null;
}

function parse_subject_ref(subject: string): { type: "actor" | "npc"; id: string } | null {
    if (subject.startsWith("actor.")) return { type: "actor", id: subject.split(".")[1] ?? "" };
    if (subject.startsWith("npc.")) return { type: "npc", id: subject.split(".")[1] ?? "" };
    if (subject.endsWith("_actor")) return { type: "actor", id: subject };
    if (subject.endsWith("_npc")) return { type: "npc", id: subject };
    return null;
}

function load_subject_tags(slot: number, subject: string): Array<Record<string, unknown>> | null {
    const parsed = parse_subject_ref(subject);
    if (!parsed || !parsed.id) return null;
    if (parsed.type === "actor") {
        const loaded = load_actor(slot, parsed.id);
        if (!loaded.ok) return null;
        return Array.isArray(loaded.actor.tags) ? (loaded.actor.tags as Array<Record<string, unknown>>) : null;
    }
    const loaded = load_npc(slot, parsed.id);
    if (!loaded.ok) return null;
    return Array.isArray(loaded.npc.tags) ? (loaded.npc.tags as Array<Record<string, unknown>>) : null;
}

function load_subject_location(slot: number, subject: string): Record<string, unknown> | null {
    const parsed = parse_subject_ref(subject);
    if (!parsed || !parsed.id) return null;
    if (parsed.type === "actor") {
        const loaded = load_actor(slot, parsed.id);
        if (!loaded.ok) return null;
        return (loaded.actor.location as Record<string, unknown>) ?? null;
    }
    const loaded = load_npc(slot, parsed.id);
    if (!loaded.ok) return null;
    return (loaded.npc.location as Record<string, unknown>) ?? null;
}

function build_location_tile_refs(location: Record<string, unknown>): { tile: string; region: string; world: string } {
    const world = (location.world_tile as Record<string, unknown>) ?? {};
    const region = (location.region_tile as Record<string, unknown>) ?? {};
    const tile = (location.tile as Record<string, unknown>) ?? {};
    const world_x = Number(world.x ?? 0);
    const world_y = Number(world.y ?? 0);
    const region_x = Number(region.x ?? 0);
    const region_y = Number(region.y ?? 0);
    const tile_x = Number(tile.x ?? 0);
    const tile_y = Number(tile.y ?? 0);
    return {
        tile: `tile.${world_x}.${world_y}.${region_x}.${region_y}.${tile_x}.${tile_y}`,
        region: `region_tile.${world_x}.${world_y}.${region_x}.${region_y}`,
        world: `world_tile.${world_x}.${world_y}`,
    };
}

function parse_tile_ref(ref: string): { world_x: number; world_y: number; region_x: number; region_y: number; tile_x: number; tile_y: number } | null {
    const parts = ref.split(".");
    if (parts.length !== 7) return null;
    const world_x = Number(parts[1]);
    const world_y = Number(parts[2]);
    const region_x = Number(parts[3]);
    const region_y = Number(parts[4]);
    const tile_x = Number(parts[5]);
    const tile_y = Number(parts[6]);
    if (![world_x, world_y, region_x, region_y, tile_x, tile_y].every((n) => Number.isFinite(n))) return null;
    return { world_x, world_y, region_x, region_y, tile_x, tile_y };
}

function is_tile_ref(ref: string): boolean {
    return ref.startsWith("tile.");
}

function is_region_tile_ref(ref: string): boolean {
    return ref.startsWith("region_tile.");
}

function is_world_tile_ref(ref: string): boolean {
    return ref.startsWith("world_tile.");
}

function get_owner_ref_from_target(target_ref: string): string | null {
    if (target_ref.startsWith("actor.")) {
        const parts = target_ref.split(".");
        return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : null;
    }
    if (target_ref.startsWith("npc.")) {
        const parts = target_ref.split(".");
        return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : null;
    }
    return null;
}

function has_awareness_tag(tags: Array<Record<string, unknown>> | null, target_ref: string): boolean {
    if (!tags || tags.length === 0) return false;
    for (const tag of tags) {
        if (String(tag.name ?? "").toUpperCase() !== "AWARENESS") continue;
        const info = Array.isArray(tag.info) ? (tag.info as unknown[]) : [];
        if (info.some((entry) => String(entry) === target_ref)) return true;
    }
    return false;
}

function has_target_awareness(slot: number, subject: string, target_ref: string): boolean {
    if (!target_ref) return true;
    if (target_ref === subject) return true;

    const tags = load_subject_tags(slot, subject);
    const location = load_subject_location(slot, subject);
    const owner_ref = get_owner_ref_from_target(target_ref);

    if (location) {
        const refs = build_location_tile_refs(location);
        if (is_tile_ref(target_ref) && target_ref === refs.tile) {
            const senses = load_subject_senses(slot, subject);
            if (senses && Number(senses.pressure ?? 0) > 0) return true;
        }
        if (is_tile_ref(target_ref)) {
            const target_tile = parse_tile_ref(target_ref);
            if (target_tile) {
                const world = (location.world_tile as Record<string, unknown>) ?? {};
                const region = (location.region_tile as Record<string, unknown>) ?? {};
                const tile = (location.tile as Record<string, unknown>) ?? {};
                const world_x = Number(world.x ?? 0);
                const world_y = Number(world.y ?? 0);
                const region_x = Number(region.x ?? 0);
                const region_y = Number(region.y ?? 0);
                const tile_x = Number(tile.x ?? 0);
                const tile_y = Number(tile.y ?? 0);
                const same_region = target_tile.world_x === world_x && target_tile.world_y === world_y
                    && target_tile.region_x === region_x && target_tile.region_y === region_y;
                if (same_region) {
                    const dx = Math.abs(target_tile.tile_x - tile_x);
                    const dy = Math.abs(target_tile.tile_y - tile_y);
                    if (dx + dy === 1) {
                        const senses = load_subject_senses(slot, subject);
                        if (senses && Number(senses.pressure ?? 0) > 0) return true;
                    }
                }
            }
        }
        if (is_region_tile_ref(target_ref) && target_ref === refs.region) return true;
        if (is_world_tile_ref(target_ref) && target_ref === refs.world) return true;
    }

    if (has_awareness_tag(tags, target_ref)) return true;
    if (owner_ref && has_awareness_tag(tags, owner_ref)) return true;
    return false;
}

type TargetType = "character" | "body_slot" | "item" | "tile" | "region_tile" | "world_tile" | "unknown";

function classify_target_type(target_ref: string): TargetType {
    if (target_ref.startsWith("actor.") || target_ref.startsWith("npc.")) {
        if (target_ref.includes(".body_slots.")) return "body_slot";
        return "character";
    }
    if (target_ref.includes("item_")) return "item";
    if (target_ref.startsWith("tile.")) return "tile";
    if (target_ref.startsWith("region_tile.")) return "region_tile";
    if (target_ref.startsWith("world_tile.")) return "world_tile";
    return "unknown";
}

function is_allowed_target_for_verb(verb: string, target_type: TargetType, subject: string, target_ref: string, slot: number): boolean {
    if (verb === "USE") return ["character", "body_slot", "item", "tile"].includes(target_type);
    if (verb === "ATTACK") return ["character", "body_slot", "item", "tile"].includes(target_type);
    if (verb === "HELP") {
        if (target_type !== "character") return false;
        return target_ref !== subject;
    }
    if (verb === "DEFEND") return target_type === "character";
    if (verb === "GRAPPLE") return target_type === "character";
    if (verb === "INSPECT") return ["character", "body_slot", "item", "tile", "region_tile", "world_tile"].includes(target_type);
    if (verb === "COMMUNICATE") return ["character", "region_tile"].includes(target_type);
    if (verb === "DODGE") return target_ref === subject;
    if (verb === "SLEEP") return target_ref === subject;
    if (verb === "REPAIR") return target_ref === subject || target_type === "body_slot";
    if (verb === "MOVE") {
        if (target_type === "tile") return is_timed_event_active(slot);
        if (target_type === "region_tile" || target_type === "world_tile") return !is_timed_event_active(slot);
        return false;
    }
    if (verb === "WORK") return ["item", "tile", "region_tile"].includes(target_type);
    if (verb === "GUARD") return ["tile", "region_tile", "world_tile"].includes(target_type);
    if (verb === "HOLD") return true;
    if (verb === "CRAFT") return target_type === "item";
    return true;
}

function load_subject_senses(slot: number, subject: string): Record<string, number> | null {
    const parsed = parse_subject_ref(subject);
    if (!parsed || !parsed.id) return null;
    if (parsed.type === "actor") {
        const loaded = load_actor(slot, parsed.id);
        if (!loaded.ok) return null;
        return (loaded.actor.senses as Record<string, number>) ?? null;
    }
    const loaded = load_npc(slot, parsed.id);
    if (!loaded.ok) return null;
    return (loaded.npc.senses as Record<string, number>) ?? null;
}

function read_sense_context(args: Record<string, ValueNode>): SenseContext {
    const ctx_node = args.sense_context;
    if (!ctx_node || ctx_node.type !== "object") {
        const distance_mag = get_number(args.distance_mag as ValueNode | undefined);
        const thin_walls = get_number(args.thin_walls as ValueNode | undefined);
        const thick_walls = get_number(args.thick_walls as ValueNode | undefined);
        const signal_mag = get_number(args.signal_mag as ValueNode | undefined);
        const sound_level = get_string(args.sound_level as ValueNode | undefined);
        const out: SenseContext = {};
        if (distance_mag !== null) out.distance_mag = distance_mag;
        if (thin_walls !== null) out.thin_walls = thin_walls;
        if (thick_walls !== null) out.thick_walls = thick_walls;
        if (signal_mag !== null) out.signal_mag = signal_mag;
        if (out.signal_mag === undefined && sound_level) {
            if (sound_level === "slightly_louder") out.signal_mag = 1;
            if (sound_level === "yelling") out.signal_mag = 2;
        }
        return out;
    }

    const entries = ctx_node.value;
    const distance_mag = get_number(entries.distance_mag as ValueNode | undefined);
    const thin_walls = get_number(entries.thin_walls as ValueNode | undefined);
    const thick_walls = get_number(entries.thick_walls as ValueNode | undefined);
    const signal_mag = get_number(entries.signal_mag as ValueNode | undefined);
    const sound_level = get_string(entries.sound_level as ValueNode | undefined);
    const out: SenseContext = {};
    if (distance_mag !== null) out.distance_mag = distance_mag;
    if (thin_walls !== null) out.thin_walls = thin_walls;
    if (thick_walls !== null) out.thick_walls = thick_walls;
    if (signal_mag !== null) out.signal_mag = signal_mag;
    if (out.signal_mag === undefined && sound_level) {
        if (sound_level === "slightly_louder") out.signal_mag = 1;
        if (sound_level === "yelling") out.signal_mag = 2;
    }
    return out;
}

function parse_sense_list(value: ValueNode | undefined): SenseName[] {
    if (!value || value.type !== "list") return [];
    const out: SenseName[] = [];
    for (const item of value.value) {
        const name = get_string(item);
        if (name === "light" || name === "pressure" || name === "aroma" || name === "thaumic") {
            out.push(name);
        }
    }
    return out;
}

function compute_awareness_clarity(slot: number, subject: string, senses: SenseName[], context: SenseContext): SenseClarity {
    if (senses.length === 0) return "clear";
    const subject_senses = load_subject_senses(slot, subject);
    if (!subject_senses) return "clear";

    let best: SenseClarity = "none";
    for (const sense of senses) {
        const mag = Number(subject_senses[sense]);
        if (!Number.isFinite(mag)) continue;
        const range_mag = compute_sense_range_mag(sense, mag, context);
        const clarity = compute_sense_clarity(range_mag, context.distance_mag);
        if (clarity === "clear") return "clear";
        if (clarity === "obscured") best = "obscured";
    }

    return best;
}

function compute_roll(roll_node: ValueNode | undefined): ValueNode | undefined {
    if (!roll_node || roll_node.type !== "object") return roll_node;
    const roll = { ...roll_node.value } as Record<string, ValueNode>;

    const dice_expr = get_identifier(roll.dice as ValueNode | undefined);
    const nat_node = roll.nat as ValueNode | undefined;
    const base_node = roll.base as ValueNode | undefined;

    let faces: number[] | null = null;
    let base = base_node && base_node.type === "number" ? base_node.value : null;

    if (nat_node) {
        if (nat_node.type === "number") {
            faces = [nat_node.value];
            base = nat_node.value;
        } else if (nat_node.type === "list") {
            const nums = nat_node.value.filter((v) => v.type === "number").map((v) => v.value);
            faces = nums;
            base = nums.reduce((sum, n) => sum + n, 0);
        }
    }

    // dice rolling is handled by roller; only compute when nat is provided

    if (base === null) base = 0;
    roll.base = { type: "number", value: base };

    const effectors = roll.effectors && roll.effectors.type === "list" ? roll.effectors.value : [];
    let shift = 0;
    let scale = 1;
    for (const eff of effectors) {
        if (eff.type !== "object") continue;
        const type = get_identifier(eff.value.type as ValueNode | undefined);
        const val = get_number(eff.value.value as ValueNode | undefined) ?? 0;
        if (type === "SHIFT") shift += val;
        if (type === "SCALE") scale *= val;
    }

    const result = Math.floor((base + shift) * scale);
    roll.result = { type: "number", value: result };

    if (faces && faces.length > 0) {
        const face_list = faces.join(",");
        const expr = dice_expr ?? "die";
        roll.roll_result = { type: "string", value: `${result} (${expr} rolled ${face_list})` };
    }

    return { type: "object", value: roll } as ValueNode;
}

function compute_command(command: CommandNode): CommandNode {
    const args: Record<string, ValueNode> = { ...command.args };
    if (args.roll) args.roll = compute_roll(args.roll) ?? args.roll;
    if (args.potency) args.potency = compute_roll(args.potency) ?? args.potency;
    return { ...command, args };
}

function roll_passes_attack(command: CommandNode): boolean {
    const roll_node = command.args.roll;
    if (!roll_node || roll_node.type !== "object") return false;
    const result = get_number(roll_node.value.result as ValueNode | undefined);

    const target_ref = get_identifier(command.args.target) ?? "";
    const is_tile = target_ref.startsWith("tile.") || target_ref.startsWith("region_tile.") || target_ref.startsWith("world_tile.");
    const target_evasion = is_tile ? 0 : 10;
    if (result === null) return false;
    return result >= target_evasion;
}

function roll_passes_check(command: CommandNode): boolean {
    const roll_node = command.args.roll;
    if (!roll_node || roll_node.type !== "object") return true;
    const result = get_number(roll_node.value.result as ValueNode | undefined);
    const target_cr = get_number(roll_node.value.target_cr as ValueNode | undefined);
    if (result === null) return true;
    if (target_cr === null) return true;
    return result >= target_cr;
}

export function apply_rules_stub(commands: CommandNode[], slot: number): RuleResult {
    const event_lines: string[] = [];
    const effect_lines: string[] = [];

    for (const raw of commands) {
        const command = compute_command(raw);
        event_lines.push(format_command_line(command));

        const target_ref = get_identifier(command.args.target);
        const targets_list = command.args.targets;

        if (command.verb === "CRAFT") {
            const result_ref = get_identifier(command.args.result);
            if (!result_ref || classify_target_type(result_ref) !== "item") {
                event_lines.push(`NOTE.INVALID_TARGET(verb=${command.verb}, target=${result_ref ?? "missing"})`);
                continue;
            }
        }

        if (command.verb === "COMMUNICATE") {
            if (!targets_list || targets_list.type !== "list" || targets_list.value.length === 0) {
                event_lines.push(`NOTE.INVALID_TARGET(verb=${command.verb}, target=missing)`);
                continue;
            }
        }

        if (["USE", "ATTACK", "HELP", "DEFEND", "GRAPPLE", "INSPECT", "MOVE", "WORK", "GUARD", "DODGE", "SLEEP", "REPAIR"].includes(command.verb)) {
            const allows_missing = ["DODGE", "SLEEP", "REPAIR", "DEFEND"].includes(command.verb);
            if (!target_ref && !allows_missing) {
                event_lines.push(`NOTE.INVALID_TARGET(verb=${command.verb}, target=missing)`);
                continue;
            }
        }

        if (target_ref) {
            const target_type = classify_target_type(target_ref);
            if (!is_allowed_target_for_verb(command.verb, target_type, command.subject, target_ref, slot)) {
                event_lines.push(`NOTE.INVALID_TARGET(verb=${command.verb}, target=${target_ref})`);
                continue;
            }
            if (!has_target_awareness(slot, command.subject, target_ref)) {
                event_lines.push(`NOTE.NO_AWARENESS(target=${target_ref})`);
                continue;
            }
        }

        if (command.verb === "ATTACK") {
            if (roll_passes_attack(command)) {
                const potency = command.args.potency;
                const target = get_identifier(command.args.target) ?? "target";
                const mag = potency && potency.type === "object"
                    ? get_number(potency.value.result as ValueNode | undefined)
                    : null;
                effect_lines.push(`SYSTEM.APPLY_DAMAGE(target=${target}, mag=${mag ?? 1})`);
            }
        }

        if (command.verb === "MOVE") {
            const actor = command.subject;
            const target = get_identifier(command.args.target) ?? "target";
            effect_lines.push(`SYSTEM.SET_OCCUPANCY(target=${actor}, tiles=[${target}])`);

            const action_cost = get_identifier(command.args.action_cost);
            if (action_cost === "EXTENDED") {
                effect_lines.push("SYSTEM.ADVANCE_TIME(unit=EXTENDED_ACTION, count=1)");
            }
            // TODO: enforce movement speed, partial moves, and full-action recharge
        }

        if (command.verb === "CRAFT") {
            if (roll_passes_check(command)) {
                const actor = command.subject;
                const result_item = get_identifier(command.args.result) ?? "item";
                effect_lines.push(`SYSTEM.ADJUST_INVENTORY(target=${actor}, item=${result_item}, mag=1)`);

                const components = command.args.components;
                if (components && components.type === "list") {
                    for (const comp of components.value) {
                        if (comp.type === "identifier") {
                            effect_lines.push(`SYSTEM.ADJUST_INVENTORY(target=${actor}, item=${comp.value}, mag=-1)`);
                        }
                    }
                }
            }
        }

        if (command.verb === "COMMUNICATE") {
            const targets = command.args.targets;
            if (targets && targets.type === "list") {
                const sense_list = parse_sense_list(command.args.senses as ValueNode | undefined);
                const senses: SenseName[] = sense_list.length > 0 ? sense_list : ["pressure"];
                const context = read_sense_context(command.args);
                for (const t of targets.value) {
                    if (t.type === "identifier") {
                        const target_type = classify_target_type(t.value);
                        if (!is_allowed_target_for_verb(command.verb, target_type, command.subject, t.value, slot)) {
                            event_lines.push(`NOTE.INVALID_TARGET(verb=${command.verb}, target=${t.value})`);
                            continue;
                        }
                        // For COMMUNICATE: Check if TARGET (NPC) has awareness of SUBJECT (player)
                        // Per THAUMWORLD rules: NPC must be aware of player to receive communication
                        if (!has_target_awareness(slot, t.value, command.subject)) {
                            event_lines.push(`NOTE.NO_AWARENESS(target=${t.value})`);
                            continue;
                        }
                        const clarity = compute_awareness_clarity(slot, command.subject, senses, context);
                        if (clarity === "none") continue;
                        if (clarity === "obscured") {
                            effect_lines.push(`SYSTEM.SET_AWARENESS(observer=${command.subject}, target=${t.value}, clarity=obscured)`);
                        } else {
                            effect_lines.push(`SYSTEM.SET_AWARENESS(observer=${command.subject}, target=${t.value})`);
                        }
                    }
                }
            }
            // TODO: attach memory/health/goals/personality context for renderer
        }

        if (command.verb === "SLEEP" || command.verb === "REPAIR") {
            const potency = command.args.potency;
            const mag = potency && potency.type === "object"
                ? get_number(potency.value.result as ValueNode | undefined)
                : null;
            effect_lines.push(`SYSTEM.APPLY_HEAL(target=${command.subject}, mag=${mag ?? 1})`);
            // TODO: match thaumworld health regen rules
        }

        if (command.verb === "DEFEND") {
            // TODO: implement DEFEND tag effects
        }

        if (command.verb === "HOLD" || command.verb === "WORK") {
            // TODO: implement HOLD/WORK rules
        }
    }

    return { event_lines, effect_lines };
}
