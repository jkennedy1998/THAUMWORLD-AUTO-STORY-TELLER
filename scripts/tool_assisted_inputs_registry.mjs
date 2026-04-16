import fs from 'fs';
import path from 'path';

export function getToolAssistedInputsRoot(baseDir) {
  return path.join(baseDir, 'local_data', 'tool_assisted_inputs');
}

export function getToolAssistedInputsRegistryPath(baseDir) {
  return path.join(getToolAssistedInputsRoot(baseDir), 'registry.json');
}

export function readToolAssistedInputsRegistry(baseDir) {
  const registryPath = getToolAssistedInputsRegistryPath(baseDir);
  const raw = fs.readFileSync(registryPath, 'utf-8');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid tool assisted inputs registry: ${registryPath}`);
  }
  return { registryPath, entries: data };
}

export function resolveToolAssistedInputsEntry(baseDir, taiId) {
  const normalizedId = String(taiId ?? '').trim();
  if (!/^\d{2}$/.test(normalizedId)) {
    throw new Error(`Invalid tai id '${normalizedId}'. Expected two digits like 01.`);
  }
  const { registryPath, entries } = readToolAssistedInputsRegistry(baseDir);
  const entry = entries[normalizedId];
  if (!entry || typeof entry !== 'object') {
    throw new Error(`No tool assisted inputs entry for id ${normalizedId} in ${registryPath}`);
  }
  const relativePath = String(entry.path ?? '').trim();
  if (!relativePath) {
    throw new Error(`Tool assisted inputs entry ${normalizedId} is missing a path in ${registryPath}`);
  }
  const scriptPath = path.resolve(getToolAssistedInputsRoot(baseDir), relativePath);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Tool assisted inputs script for id ${normalizedId} does not exist: ${scriptPath}`);
  }
  const rawScript = fs.readFileSync(scriptPath, 'utf-8');
  const scriptData = JSON.parse(rawScript);
  const testName = String(scriptData?.test_name ?? '').trim();
  if (!testName) {
    throw new Error(`Tool assisted inputs script for id ${normalizedId} is missing test_name: ${scriptPath}`);
  }
  const openMs = Math.max(0, Math.floor(Number(scriptData?.open_ms) || 0));
  if (!openMs) {
    throw new Error(`Tool assisted inputs script for id ${normalizedId} is missing open_ms: ${scriptPath}`);
  }
  const endDelayMs = Math.max(0, Math.floor(Number(scriptData?.end_delay_ms) || 0));
  if (typeof scriptData?.end_delay_ms !== 'number') {
    throw new Error(`Tool assisted inputs script for id ${normalizedId} is missing end_delay_ms: ${scriptPath}`);
  }
  return {
    id: normalizedId,
    testName,
    openMs,
    endDelayMs,
    scriptPath,
    relativePath,
    registryPath,
  };
}
