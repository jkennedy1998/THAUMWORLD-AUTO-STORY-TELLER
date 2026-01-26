import type { CommandNode, ValueNode } from "../system_syntax/index.js";
import type { RuleResult } from "./types.js";
import { roll_expr } from "./dice.js";

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

    if (!faces && dice_expr) {
        const rolled = roll_expr(dice_expr);
        if (rolled) {
            faces = rolled.faces;
            base = rolled.base;
            const first_face = faces[0] ?? 0;
            roll.nat = faces.length === 1
                ? { type: "number", value: first_face }
                : { type: "list", value: faces.map((n) => ({ type: "number", value: n })) };
        }
    }

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

export function apply_rules_stub(commands: CommandNode[]): RuleResult {
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
                for (const t of targets.value) {
                    if (t.type === "identifier") {
                        effect_lines.push(`SYSTEM.SET_AWARENESS(observer=${command.subject}, target=${t.value})`);
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
