// Session management for THAUMWORLD Auto Story Teller
// Prevents reprocessing of messages from previous boots

import { read_host_session_file } from './host_session_store.js';
import { generateSessionId } from './session_ids.js';

function readSessionFile() {
  try {
    return read_host_session_file();
  } catch (e) {
    console.error('[Session] Failed to read session file:', e);
    return null;
  }
}

// Initialize session ID from file or generate new one
function initializeSessionId(): string {
  // First, try to read from session file (for multi-service coordination)
  const sessionFile = readSessionFile();
  if (sessionFile && sessionFile.session_id) {
    console.log(`[Session] Loaded session from file: ${sessionFile.session_id}`);
    console.log(`[Session] Boot time: ${sessionFile.boot_time}`);
    return sessionFile.session_id;
  }

  // Fallback: generate new session ID (for backwards compatibility)
  const newSessionId = generateSessionId({ suffixLength: 7 });
  console.log(`[Session] Generated new session (no file found): ${newSessionId}`);
  return newSessionId;
}

// Current session ID (exported as a live binding).
// This allows long-running services to follow updates to `.session_id`.
export let SESSION_ID = initializeSessionId();

// Poll host session file every 5 seconds to detect controlled host restarts.
// Client-only boots must never rewrite this file.
setInterval(() => {
  const sessionFile = readSessionFile();
  if (sessionFile && sessionFile.session_id && sessionFile.session_id !== SESSION_ID) {
    console.log(`[Session] Session file updated: ${SESSION_ID} -> ${sessionFile.session_id}`);
    console.log(`[Session] New boot time: ${sessionFile.boot_time}`);
    SESSION_ID = sessionFile.session_id;
  }
}, 5000);

/**
 * Checks if a message belongs to the current session.
 * Messages without session_id are considered legacy and will be ignored.
 */
export function isCurrentSession(message: { meta?: Record<string, unknown> }): boolean {
  const msgSessionId = message.meta?.session_id;
  if (!msgSessionId) return false; // Legacy messages without session_id are ignored
  return msgSessionId === SESSION_ID;
}

/**
 * Gets session metadata to attach to new messages.
 */
export function getSessionMeta(): { session_id: string; created_at: string } {
  return {
    session_id: SESSION_ID,
    created_at: new Date().toISOString()
  };
}
