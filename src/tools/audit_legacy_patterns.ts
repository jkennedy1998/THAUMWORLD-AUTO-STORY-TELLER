import fs from 'fs';
import path from 'path';

type Finding = {
  kind: string;
  file: string;
  line: number;
  snippet: string;
};

function walk(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function find_in_file(file: string, re: RegExp, kind: string, max_per_file: number): Finding[] {
  const txt = fs.readFileSync(file, 'utf8');
  const lines = txt.split(/\r?\n/);
  const hits: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (re.test(line)) {
      hits.push({ kind, file, line: i + 1, snippet: line.trim().slice(0, 240) });
      if (hits.length >= max_per_file) break;
    }
  }
  return hits;
}

function print_group(title: string, findings: Finding[]): void {
  console.log(`\n== ${title} ==`);
  if (findings.length === 0) {
    console.log('OK (no matches)');
    return;
  }
  console.log(`Found ${findings.length} match(es)`);
  for (const f of findings) {
    console.log(`- ${f.file}:${f.line} ${f.kind} :: ${f.snippet}`);
  }
}

function main(): void {
  const slot = process.argv[2] ? parseInt(process.argv[2], 10) : 1;
  if (!Number.isFinite(slot)) {
    console.error('Usage: npx tsx src/tools/audit_legacy_patterns.ts <data_slot_number>');
    process.exit(2);
  }

  const root = process.cwd();
  const slot_dir = path.join(root, 'local_data', `data_slot_${slot}`);
  const master_items_dir = path.join(root, 'local_data', 'items');
  const slot_items_dir = path.join(slot_dir, 'items');

  console.log('Audit Legacy Patterns');
  console.log(`- data_slot: ${slot}`);
  console.log(`- slot_dir: ${slot_dir}`);

  const findings: Finding[] = [];

  // Saved entity data
  for (const sub of ['actors', 'places', 'npcs'] as const) {
    const dir = path.join(slot_dir, sub);
    if (!fs.existsSync(dir)) continue;
    const files = walk(dir).filter((f) => f.endsWith('.jsonc') || f.endsWith('.json'));

    for (const f of files) {
      findings.push(...find_in_file(f, /"container_data"\s*:/, 'legacy_container_data', 5));
      findings.push(...find_in_file(f, /"id"\s*:\s*"item\./, 'legacy_container_id_item_dot', 5));
      findings.push(...find_in_file(f, /"container_id"\s*:\s*"item\./, 'legacy_container_id_item_dot', 5));
      findings.push(...find_in_file(f, /"valid_body_slots"\s*:\s*\[/, 'legacy_valid_body_slots_field', 3));
    }
  }

  // Item definitions
  const def_files: string[] = [];
  if (fs.existsSync(master_items_dir)) {
    def_files.push(...walk(master_items_dir).filter((f) => f.endsWith('.jsonc') || f.endsWith('.json')));
  }
  if (fs.existsSync(slot_items_dir)) {
    def_files.push(...walk(slot_items_dir).filter((f) => f.endsWith('.jsonc') || f.endsWith('.json')));
  }

  for (const f of def_files) {
    findings.push(...find_in_file(f, /"valid_body_slots"\s*:\s*\[/, 'legacy_valid_body_slots_field', 3));
    // Defs that still encode left-only jewelry meta can be spotted by GARB meta hand_left/hand_right.
    findings.push(...find_in_file(f, /"name"\s*:\s*"GARB"[\s\S]{0,120}?"meta"\s*:\s*\[[^\]]*(hand_left|hand_right)[^\]]*\]/, 'garb_meta_specific_hand', 1));
  }

  const by_kind = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = by_kind.get(f.kind) ?? [];
    arr.push(f);
    by_kind.set(f.kind, arr);
  }

  print_group('legacy_container_data (inline items still store container_data)', by_kind.get('legacy_container_data') ?? []);
  print_group('legacy_container_id_item_dot (item.<id> container ids)', by_kind.get('legacy_container_id_item_dot') ?? []);
  print_group('legacy_valid_body_slots_field (defs or instances still using valid_body_slots)', by_kind.get('legacy_valid_body_slots_field') ?? []);
  print_group('garb_meta_specific_hand (defs with hand_left/hand_right meta)', by_kind.get('garb_meta_specific_hand') ?? []);

  const total = findings.length;
  console.log(`\nTotal findings: ${total}`);
  process.exit(total > 0 ? 1 : 0);
}

main();
