import * as fs from "node:fs";
import { ensure_dir_exists } from "./log_store.js";
import { get_metrics_dir, get_metrics_path } from "./paths.js";

export type MetricEntry = {
    at: string;
    model: string;
    ok: boolean;
    duration_ms: number;
    stage: string;
    session: string;
    error?: string;
};

type MetricsFile = {
    schema_version: number;
    entries: MetricEntry[];
};

function read_metrics(pathname: string): MetricsFile {
    if (!fs.existsSync(pathname)) return { schema_version: 1, entries: [] };
    const raw = fs.readFileSync(pathname, "utf-8").trim();
    if (!raw) return { schema_version: 1, entries: [] };
    try {
        return JSON.parse(raw) as MetricsFile;
    } catch {
        return { schema_version: 1, entries: [] };
    }
}

function write_metrics(pathname: string, metrics: MetricsFile): void {
    fs.writeFileSync(pathname, JSON.stringify(metrics, null, 2), "utf-8");
}

export function ensure_metrics_exists(slot: number, name: string): string {
    const dir = get_metrics_dir(slot);
    ensure_dir_exists(dir);
    const metrics_path = get_metrics_path(slot, name);
    if (!fs.existsSync(metrics_path)) {
        write_metrics(metrics_path, { schema_version: 1, entries: [] });
    }
    return metrics_path;
}

export function append_metric(slot: number, name: string, entry: MetricEntry): void {
    const metrics_path = ensure_metrics_exists(slot, name);
    const metrics = read_metrics(metrics_path);
    metrics.entries.push(entry);
    write_metrics(metrics_path, metrics);
}
