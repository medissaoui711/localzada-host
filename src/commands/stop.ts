/**
 * `localzada stop` — stop a running session (and its tunnel if any)
 * إيقاف الجلسات
 *
 * Locking: we hold the sessions lock while reading the session list and
 * during the read-modify-write to sessions.json. We RELEASE the lock
 * around the kill syscalls because:
 *   1. killProcessTree may take seconds for stubborn processes.
 *   2. Other commands (status/list) need to read sessions.json meanwhile.
 *   3. The PID we're killing isn't going to be reused mid-call.
 */

import { ui } from '../ui.js';
import { EXIT } from '../constants.js';
import {
  findSession,
  loadSessions,
  removeSession,
  updateSession,
} from '../sessions.js';
import { killProcessTree } from '../runner.js';
import { acquireLock, LockError, withLock } from '../lock.js';
import type { ProcessRecord } from '../types.js';

export async function stopCommand(
  idOrName: string | undefined,
  all = false,
): Promise<number> {
  if (all) {
    // Snapshot the running sessions under lock
    let running: ProcessRecord[] = [];
    try {
      running = await withLock('sessions', () =>
        loadSessions().filter((s) => s.status === 'running'),
      );
    } catch (err) {
      if (err instanceof LockError) {
        ui.error('Another Localzada command is updating the sessions list.');
        return EXIT.ALREADY_RUNNING;
      }
      throw err;
    }

    if (running.length === 0) {
      ui.info('No running sessions.');
      return EXIT.OK;
    }
    let failed = 0;
    for (const s of running) {
      try {
        const code = await stopSingle(s.id);
        if (code !== EXIT.OK) failed++;
      } catch {
        failed++;
      }
    }
    if (failed > 0) {
      ui.warn(
        `Stopped ${running.length - failed}/${running.length}; ${failed} failed.`,
      );
      return EXIT.GENERIC_ERROR;
    }
    ui.success(`Stopped ${running.length} session(s).`);
    return EXIT.OK;
  }

  if (!idOrName) {
    ui.error('Provide a session name/id, or use --all.');
    return EXIT.INVALID_USAGE;
  }

  return stopSingle(idOrName);
}

async function stopSingle(idOrName: string): Promise<number> {
  // Phase 1: locate session under lock (cheap, fast)
  let session: ProcessRecord | undefined;
  try {
    session = await withLock('sessions', () => findSession(idOrName));
  } catch (err) {
    if (err instanceof LockError) {
      ui.error('Another Localzada command is updating the sessions list.');
      return EXIT.ALREADY_RUNNING;
    }
    throw err;
  }

  if (!session) {
    ui.error(`No session named "${idOrName}".`);
    return EXIT.NOT_FOUND;
  }

  // Phase 2: kill — NO lock held (kills can be slow, others may want to read)
  if (session.tunnel) {
    try {
      await killProcessTree(session.tunnel.pid);
      ui.step(`Closed tunnel ${session.tunnel.publicUrl}`);
    } catch (err) {
      ui.warn(`Could not close tunnel cleanly: ${(err as Error).message}`);
    }
  }

  let killOk = true;
  try {
    await killProcessTree(session.pid);
  } catch (err) {
    killOk = false;
    ui.error(`Failed to stop ${session.name}: ${(err as Error).message}`);
  }

  // Phase 3: persist outcome under lock
  try {
    const lock = acquireLock('sessions');
    try {
      if (killOk) {
        updateSession(session.id, { status: 'stopped' });
        removeSession(session.id);
      } else {
        // Kill failed but we tried — record as crashed for visibility
        updateSession(session.id, { status: 'crashed' });
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    if (err instanceof LockError) {
      ui.warn(
        `Stopped ${session.name} but could not update sessions list ` +
          `(another command was holding the lock). ` +
          `Run "localzada status" to see current state.`,
      );
    } else {
      throw err;
    }
  }

  if (killOk) {
    ui.success(`Stopped ${session.name} (PID ${session.pid})`);
    return EXIT.OK;
  }
  return EXIT.GENERIC_ERROR;
}
