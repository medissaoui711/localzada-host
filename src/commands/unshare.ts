/**
 * `localzada unshare` — close a tunnel without stopping the local server
 * إغلاق الـ tunnel فقط مع إبقاء السيرفر شغّالاً
 */

import { ui } from '../ui.js';
import { EXIT } from '../constants.js';
import {
  findSession,
  loadSessions,
  updateSession,
} from '../sessions.js';
import { killProcessTree } from '../runner.js';
import { acquireLock, LockError, withLock } from '../lock.js';
import type { ProcessRecord } from '../types.js';

export async function unshareCommand(
  idOrName: string | undefined,
): Promise<number> {
  // If no id, close all tunnels
  if (!idOrName) {
    let withTunnel: ProcessRecord[] = [];
    try {
      withTunnel = await withLock('sessions', () =>
        loadSessions().filter((s) => s.tunnel),
      );
    } catch (err) {
      if (err instanceof LockError) {
        ui.error('Another Localzada command is updating the sessions list.');
        return EXIT.ALREADY_RUNNING;
      }
      throw err;
    }

    if (withTunnel.length === 0) {
      ui.info('No active tunnels.');
      return EXIT.OK;
    }

    let failed = 0;
    for (const s of withTunnel) {
      try {
        if (!s.tunnel) continue;
        await killProcessTree(s.tunnel.pid);
        // Update under lock
        const lock = acquireLock('sessions');
        try {
          updateSession(s.id, { tunnel: undefined });
        } finally {
          lock.release();
        }
      } catch {
        failed++;
      }
    }
    if (failed > 0) {
      ui.warn(
        `Closed ${withTunnel.length - failed}/${withTunnel.length} tunnels`,
      );
      return EXIT.GENERIC_ERROR;
    }
    ui.success(`Closed ${withTunnel.length} tunnel(s).`);
    return EXIT.OK;
  }

  // Single tunnel
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
  if (!session.tunnel) {
    ui.info(`Session "${session.name}" has no active tunnel.`);
    return EXIT.OK;
  }

  try {
    await killProcessTree(session.tunnel.pid);
  } catch (err) {
    ui.error(`Failed to close tunnel: ${(err as Error).message}`);
    return EXIT.GENERIC_ERROR;
  }

  try {
    const lock = acquireLock('sessions');
    try {
      updateSession(session.id, { tunnel: undefined });
    } finally {
      lock.release();
    }
  } catch (err) {
    if (err instanceof LockError) {
      ui.warn(
        `Tunnel closed but couldn't update sessions list. ` +
          `Run "localzada status" to verify.`,
      );
      return EXIT.OK;
    }
    throw err;
  }

  ui.success(`Closed tunnel for ${session.name}`);
  return EXIT.OK;
}
