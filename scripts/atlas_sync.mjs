import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.join(__dirname, '..', 'graphics', 'thaumworld', 'tiles');
const TARGET_DIR = path.join(__dirname, '..', 'src', 'canvas_app', 'public', 'atlas');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function shouldCopyFile(sourcePath, targetPath) {
  if (!fs.existsSync(targetPath)) return true;
  const srcStat = fs.statSync(sourcePath);
  const dstStat = fs.statSync(targetPath);
  return srcStat.size !== dstStat.size || srcStat.mtimeMs > dstStat.mtimeMs;
}

export function syncAtlasAssets() {
  ensureDir(TARGET_DIR);
  if (!fs.existsSync(SOURCE_DIR)) {
    return { copied: [], skipped: [], missingSource: true, sourceDir: SOURCE_DIR, targetDir: TARGET_DIR };
  }

  const copied = [];
  const skipped = [];
  const entries = fs.readdirSync(SOURCE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.png')) continue;
    const sourcePath = path.join(SOURCE_DIR, entry.name);
    const targetPath = path.join(TARGET_DIR, entry.name);
    if (shouldCopyFile(sourcePath, targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
      copied.push(entry.name);
    } else {
      skipped.push(entry.name);
    }
  }

  return { copied, skipped, missingSource: false, sourceDir: SOURCE_DIR, targetDir: TARGET_DIR };
}
