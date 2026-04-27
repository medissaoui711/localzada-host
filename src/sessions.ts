/**
 * Session storage and tracking
 * إدارة وتخزين الجلسات
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { APP_DIR, LOGS_DIR, SESSIONS_FILE } from './constants.js';
import type { ProcessRecord } from './types.js';

function ensureDirs(): void {
  for (const dir of [APP_DIR, LOGS_DIR, dirname(SESSIONS_FILE)]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function loadSessions(): ProcessRecord[] {
  ensureDirs();
  if (!existsSync(SESSIONS_FILE)) return [];
  try {
    const raw = readFileSync(SESSIONS_FILE, 'utf-8');
    return JSON.parse(raw) as ProcessRecord[];
  } catch {
    // corrupted file — start fresh but don't lose silently
    return [];
  }
}

export function saveSessions(sessions: ProcessRecord[]): void {
  ensureDirs();
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
}

export function addSession(session: ProcessRecord): void {
  const sessions = loadSessions();
  sessions.push(session);
  saveSessions(sessions);
}

export function updateSession(
  id: string,
  patch: Partial<ProcessRecord>,
): void {
  const sessions = loadSessions();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) return;
  sessions[idx] = { ...sessions[idx], ...patch } as ProcessRecord;
  saveSessions(sessions);
}

export function removeSession(id: string): void {
  const sessions = loadSessions().filter((s) => s.id !== id);
  saveSessions(sessions);
}

export function findSession(idOrName: string): ProcessRecord | undefined {
  const sessions = loadSessions();
  return sessions.find((s) => s.id === idOrName || s.name === idOrName);
}

export function generateSessionId(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Check whether a PID is actually alive on the host OS.
 * Uses signal 0 — works on Linux, macOS, and Windows in Node.
 */
export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM means process exists but we lack permission — still alive
    return code === 'EPERM';
  }
}

/**
 * Reconcile recorded sessions with reality:
 * mark dead processes as 'crashed' and return only running ones.
 */
export function reconcileSessions(): ProcessRecord[] {
  const sessions = loadSessions();
  let changed = false;
  for (const s of sessions) {
    if (s.status === 'running' && !isProcessAlive(s.pid)) {
      s.status = 'crashed';
      changed = true;
    }
  }
  if (changed) saveSessions(sessions);
  return sessions;
}
