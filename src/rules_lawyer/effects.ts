import type { CommandNode, ValueNode } from "../system_syntax/index.js";
import type { RuleResult } from "./types.js";
import type { SenseClarity, SenseContext, SenseName } from "./senses.js";
import { compute_sense_clarity, compute_sense_range_mag } from "./senses.js";
import { load_actor } from "../actor_storage/store.js";
import { load_npc } from "../npc_storage/store.js";

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

    // TODO: use target.evasion from resolved data
    const target_evasion = 10;
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
