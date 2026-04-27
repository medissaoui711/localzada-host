/**
 * Cloudflare Tunnel orchestration
 * تشغيل وإدارة الـ tunnel
 *
 * For v1.1 we use Cloudflare "Quick Tunnels" (no account required):
 *   cloudflared tunnel --url http://localhost:PORT
 *
 * cloudflared writes its public URL to stderr in a line that contains
 * "trycloudflare.com". We tail that output to extract the URL.
 *
 * v1.1 lifecycle model:
 *   1. Spawn cloudflared with stderr piped (so we can read URL).
 *   2. Watch stderr until URL appears OR timeout OR early exit.
 *   3. Once we have the URL: keep streaming stderr to log file via a pipe;
 *      NEVER destroy stderr — that would SIGPIPE cloudflared.
 *   4. unref() the child so the parent CLI can exit.
 *
 * Persistent named tunnels (cloudflared tunnel create + DNS routing)
 * require a CF account and are gated behind the Pro plan in v1.2.
 */

import { spawn } from 'node:child_process';
import { appendFileSync, createWriteStream, openSync } from 'node:fs';
import { join } from 'node:path';
import { LOGS_DIR } from './constants.js';
import { findCloudflared } from './cloudflared.js';
import type { TunnelInfo } from './types.js';

const URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const URL_TIMEOUT_MS = 30_000;

export interface OpenTunnelOptions {
  port: number;
  sessionId: string;
}

export type OpenTunnelResult = TunnelInfo;

/**
 * Open a Cloudflare Quick Tunnel and resolve once the public URL is known.
 *
 * Lifecycle: spawns cloudflared as a detached process, captures stderr
 * until the public URL appears, then leaves stderr piping to the log file
 * for the rest of cloudflared's lifetime.
 */
export async function openQuickTunnel(
  opts: OpenTunnelOptions,
): Promise<OpenTunnelResult> {
  const cf = await findCloudflared();
  if (!cf.found || !cf.path) {
    throw new Error('cloudflared not found');
  }

  const logFile = join(LOGS_DIR, `tunnel-${opts.sessionId}.log`);
  // stdout → log file (via fd, so it survives parent exit)
  const stdoutFd = openSync(logFile, 'a');

  // stderr is piped because we need to read the public URL from it.
  // After URL acquisition we KEEP streaming stderr to the log file via a
  // pipe; we never destroy/end stderr ourselves, because that can SIGPIPE
  // cloudflared and kill the tunnel.
  const child = spawn(
    cf.path,
    ['tunnel', '--url', `http://localhost:${opts.port}`, '--no-autoupdate'],
    {
      detached: true,
      stdio: ['ignore', stdoutFd, 'pipe'],
      windowsHide: true,
      shell: false,
    },
  );

  if (!child.pid) {
    throw new Error('Failed to spawn cloudflared');
  }

  const pid = child.pid;

  // Stage 1: wait for URL on stderr (or timeout / early exit).
  const publicUrl = await new Promise<string>((resolve, reject) => {
    let buffered = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `Timed out waiting for tunnel URL (${URL_TIMEOUT_MS}ms). ` +
            `Check ${logFile} for cloudflared output.`,
        ),
      );
    }, URL_TIMEOUT_MS);

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf-8');
      buffered += text;

      // Mirror stderr lines to the log file so user can debug
      try {
        appendFileSync(logFile, text);
      } catch {
        // log file write failure shouldn't kill the tunnel
      }

      const match = buffered.match(URL_REGEX);
      if (match && !settled) {
        settled = true;
        cleanup();
        resolve(match[0]);
      }
    };

    const onExit = (code: number | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(`cloudflared exited early (code ${code}). Check ${logFile}.`),
      );
    };

    const onError = (err: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`cloudflared spawn error: ${err.message}`));
    };

    function cleanup(): void {
      clearTimeout(timer);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
    }

    child.stderr?.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
  });

  // Stage 2: URL acquired. Now:
  //   a) Keep streaming stderr to log file (so `localzada logs` works).
  //   b) NEVER destroy/close stderr — would SIGPIPE cloudflared.
  //   c) unref the child so this CLI can exit while tunnel survives.
  //
  // pipe() handles backpressure and won't kill cloudflared. When cloudflared
  // exits naturally, the pipe ends cleanly.
  if (child.stderr) {
    const logStream = createWriteStream(logFile, { flags: 'a' });
    child.stderr.pipe(logStream);
    // If the log stream errors (disk full, etc), don't crash cloudflared:
    logStream.on('error', () => {
      child.stderr?.unpipe(logStream);
    });
  }

  // Detach so cloudflared survives parent CLI exit.
  child.unref();

  return {
    provider: 'cloudflare',
    publicUrl,
    startedAt: new Date().toISOString(),
    pid,
    logFile,
  };
}
