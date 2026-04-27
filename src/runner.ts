/**
 * Process runner — spawn user commands as detached background processes.
 * تشغيل العمليات في الخلفية
 *
 * Cross-platform notes:
 * - On POSIX: detached + stdio redirected to log file + unref() lets parent exit.
 * - On Windows: detached + windowsHide gives similar behavior.
 * - We DO NOT use shell:true (security: avoids command injection on user args).
 */

import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { platform } from 'node:os';
import { createConnection } from 'node:net';

export interface SpawnResult {
  pid: number;
}

/**
 * Spawn a detached process with logs redirected to a file.
 * Returns the child PID.
 */
export function spawnDetached(
  command: string,
  args: string[],
  options: {
    cwd: string;
    logFile: string;
    env?: NodeJS.ProcessEnv;
  },
): SpawnResult {
  // append-mode log so restarts don't clobber history
  const out = openSync(options.logFile, 'a');
  const err = openSync(options.logFile, 'a');

  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true,
    env: { ...process.env, ...options.env },
    // Important: shell:false (default). User commands are passed as args
    // to avoid shell injection.
    shell: false,
  });

  if (!child.pid) {
    throw new Error(`Failed to spawn process: ${command}`);
  }

  // Detach so the parent CLI can exit while child keeps running
  child.unref();

  return { pid: child.pid };
}

/**
 * Check if a TCP port is already in use locally.
 * Cross-platform — works on Linux, macOS, and Windows.
 */
export async function isPortInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host, timeout: 500 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);   // something is listening
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      // ECONNREFUSED — nothing listening, port is free
      resolve(false);
    });
  });
}

/**
 * Wait for a port to become reachable, with timeout.
 * Useful so `localzada share` doesn't open the tunnel before
 * the underlying dev server is actually ready.
 */
export async function waitForPort(
  port: number,
  timeoutMs = 15_000,
  host = '127.0.0.1',
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortInUse(port, host)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * Cross-platform process tree kill.
 * On Windows we use taskkill /T /F via tree-kill;
 * on POSIX we send SIGTERM to the process group.
 */
export async function killProcessTree(pid: number, signal = 'SIGTERM'): Promise<void> {
  // Lazy import so we only load when needed
  const { default: treeKill } = await import('tree-kill');
  return new Promise((resolve, reject) => {
    treeKill(pid, signal, (err) => {
      if (err) {
        // ESRCH — process already gone, treat as success
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ESRCH') return resolve();
        return reject(err);
      }
      resolve();
    });
  });
}

export const PLATFORM = platform();
export const IS_WINDOWS = PLATFORM === 'win32';
