import fs from 'fs';
import path from 'path';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function probeJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function detectLocalHost(slot) {
  const status = await probeJson(`http://localhost:8787/api/host/status?slot=${slot}`);
  return Boolean(status?.ok);
}

export async function waitForLocalHost(slot, timeoutMs = 20000) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    if (await detectLocalHost(slot)) return true;
    await sleep(500);
  }
  return false;
}

export async function detectVite() {
  try {
    const res = await fetch('http://localhost:5173');
    return res.ok;
  } catch {
    return false;
  }
}

export function getHostLockPath(baseDir, slot) {
  return path.join(baseDir, 'local_data', `data_slot_${slot}`, 'host_launcher.lock');
}

export function getHostSessionFilePath(baseDir, slot) {
  return path.join(baseDir, 'local_data', `data_slot_${slot}`, 'host_session.json');
}

export function writeHostSessionFile(baseDir, slot, sessionId, bootTime) {
  const filePath = getHostSessionFilePath(baseDir, slot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    session_id: sessionId,
    boot_time: bootTime.toISOString(),
    boot_timestamp: bootTime.getTime(),
    version: 1,
  }, null, 2));
  return filePath;
}

export function acquireHostLaunchLock(baseDir, slot) {
  const lockPath = getHostLockPath(baseDir, slot);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }), 'utf-8');
    return { ok: true, lockPath, release: () => releaseHostLaunchLock(lockPath) };
  } catch {
    return { ok: false, lockPath, release: () => undefined };
  }
}

export function readHostLaunchLock(baseDir, slot) {
  const lockPath = getHostLockPath(baseDir, slot);
  try {
    if (!fs.existsSync(lockPath)) return null;
    const raw = fs.readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      lockPath,
      pid: Number(parsed?.pid ?? 0) || 0,
      created_at: String(parsed?.created_at ?? '').trim(),
    };
  } catch {
    return { lockPath, pid: 0, created_at: '' };
  }
}

export function isProcessAlive(pid) {
  const n = Number(pid ?? 0);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

export async function recoverHostLaunchLock(baseDir, slot, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 4000) || 4000;
  const probeFirst = options.probeFirst !== false;
  const lock = readHostLaunchLock(baseDir, slot);
  if (!lock) {
    return { hadLock: false, stale: false, cleared: false, reason: 'missing' };
  }

  if (probeFirst) {
    const hostAlive = await waitForLocalHost(slot, Math.min(timeoutMs, 3000));
    if (hostAlive) {
      return { hadLock: true, stale: false, cleared: false, reason: 'host_alive', lock };
    }
  }

  const pidAlive = isProcessAlive(lock.pid);
  if (pidAlive) {
    const hostAlive = await waitForLocalHost(slot, timeoutMs);
    if (hostAlive) {
      return { hadLock: true, stale: false, cleared: false, reason: 'launcher_alive_host_started', lock };
    }
    releaseHostLaunchLock(lock.lockPath);
    return { hadLock: true, stale: true, cleared: true, reason: 'launcher_alive_host_unreachable', lock };
  }

  releaseHostLaunchLock(lock.lockPath);
  return { hadLock: true, stale: true, cleared: true, reason: 'launcher_dead', lock };
}

export function releaseHostLaunchLock(lockPath) {
  try {
    if (lockPath && fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {
    // ignore cleanup failure
  }
}
