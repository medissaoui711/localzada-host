/**
 * `localzada start` — run a local command on a given port
 * تشغيل سيرفر محلي
 *
 * Concurrency model:
 *   - We hold a global "sessions" lock for the entire critical section
 *     (read sessions → check limit → check port → spawn → persist).
 *   - We also hold a per-port lock so two concurrent `start` calls on the
 *     SAME port fail fast with a clear message instead of one silently
 *     winning. The per-port lock is acquired first; if held, we abort
 *     before doing any other work.
 */

import { join } from 'node:path';
import { ui } from '../ui.js';
import { LOGS_DIR, EXIT } from '../constants.js';
import {
  addSession,
  generateSessionId,
  loadSessions,
  reconcileSessions,
} from '../sessions.js';
import { isPortInUse, spawnDetached } from '../runner.js';
import { checkLimit } from '../plan.js';
import { acquireLock, LockError } from '../lock.js';
import type { ProcessRecord } from '../types.js';

export interface StartOptions {
  port: number;
  name?: string;
  command: string;
  args: string[];
  cwd: string;
}

export async function startCommand(opts: StartOptions): Promise<number> {
  // Lock #1: per-port lock — fastest fail for the most common race
  // (two terminals trying the same port simultaneously).
  let portLock;
  try {
    portLock = acquireLock(`port-${opts.port}`);
  } catch (err) {
    if (err instanceof LockError) {
      ui.error(
        `Another Localzada operation is already starting on port ${opts.port}` +
          (err.ownerPid ? ` (PID ${err.ownerPid})` : '') +
          '.',
      );
      ui.info('Wait for it to finish, or pick a different port.');
      return EXIT.ALREADY_RUNNING;
    }
    throw err;
  }

  try {
    // Lock #2: sessions registry lock — protects the read-modify-write
    // cycle on sessions.json. Held briefly.
    let sessionsLock;
    try {
      sessionsLock = acquireLock('sessions');
    } catch (err) {
      if (err instanceof LockError) {
        ui.error('Another Localzada command is updating the sessions list.');
        ui.info('Try again in a moment.');
        return EXIT.ALREADY_RUNNING;
      }
      throw err;
    }

    try {
      // 1. Plan limit check
      const running = reconcileSessions().filter((s) => s.status === 'running');
      const gate = checkLimit('maxConcurrentSessions', running.length);
      if (!gate.allowed) {
        ui.error(gate.reason ?? 'Plan limit reached');
        if (gate.requiredPlan) {
          ui.info(
            `Upgrade to ${gate.requiredPlan} to run more sessions concurrently.`,
          );
        }
        return EXIT.PLAN_LIMIT_REACHED;
      }

      // 2. Port-in-use check
      if (await isPortInUse(opts.port)) {
        const occupier = loadSessions().find(
          (s) => s.port === opts.port && s.status === 'running',
        );
        if (occupier) {
          ui.error(
            `Port ${opts.port} is already used by Localzada session ` +
              `"${occupier.name}" (id: ${occupier.id}).`,
          );
          ui.info(`Stop it first:  localzada stop ${occupier.name}`);
        } else {
          ui.error(`Port ${opts.port} is already in use by another process.`);
          ui.info(
            `Choose a different port with --port, or stop the conflicting process.`,
          );
        }
        return EXIT.PORT_IN_USE;
      }

      // 3. Spawn it
      const id = generateSessionId();
      const name = opts.name ?? `session-${id}`;
      const logFile = join(LOGS_DIR, `${id}.log`);

      let pid: number;
      try {
        const result = spawnDetached(opts.command, opts.args, {
          cwd: opts.cwd,
          logFile,
        });
        pid = result.pid;
      } catch (err) {
        ui.error(`Failed to start: ${(err as Error).message}`);
        return EXIT.GENERIC_ERROR;
      }

      // 4. Persist the session
      const record: ProcessRecord = {
        id,
        name,
        port: opts.port,
        command: opts.command,
        args: opts.args,
        pid,
        startedAt: new Date().toISOString(),
        cwd: opts.cwd,
        logFile,
        status: 'running',
      };
      addSession(record);

      // 5. Friendly output
      ui.success(`Started ${ui.code(name)} (PID ${pid}) on port ${opts.port}`);
      ui.dim(`  Command: ${opts.command} ${opts.args.join(' ')}`);
      ui.dim(`  Logs:    ${logFile}`);
      console.log();
      ui.info(
        `Share publicly:  ${ui.code(`localzada share --port ${opts.port}`)}`,
      );
      ui.info(`Stop:            ${ui.code(`localzada stop ${name}`)}`);

      return EXIT.OK;
    } finally {
      sessionsLock.release();
    }
  } finally {
    portLock.release();
  }
}
