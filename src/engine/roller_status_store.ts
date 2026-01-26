import * as fs from "node:fs";

export type RollerStatus = {
    schema_version: number;
    spinner: string;
    last_player_roll: string;
    dice_label: string;
    disabled: boolean;
    roll_id: string | null;
    updated_at: string;
};

export function ensure_roller_status_exists(path: string): void {
    if (fs.existsSync(path)) return;
    const status: RollerStatus = {
        schema_version: 1,
        spinner: "|",
        last_player_roll: "",
        dice_label: "D20",
        disabled: true,
        roll_id: null,
        updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(path, JSON.stringify(status, null, 2), "utf-8");
}

export function read_roller_status(path: string): RollerStatus {
    const raw = fs.readFileSync(path, "utf-8");
    return JSON.parse(raw) as RollerStatus;
}

export function write_roller_status(path: string, status: RollerStatus): void {
    const next = { ...status, updated_at: new Date().toISOString() };
    fs.writeFileSync(path, JSON.stringify(next, null, 2), "utf-8");
}
