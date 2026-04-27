/**
 * `localzada share` — open a Cloudflare Quick Tunnel to a local port
 * مشاركة سيرفر محلي
 */

import ora from 'ora';
import { ui } from '../ui.js';
import { EXIT } from '../constants.js';
import {
  findSession,
  generateSessionId,
  reconcileSessions,
  updateSession,
} from '../sessions.js';
import { findCloudflared, getInstallInstructions } from '../cloudflared.js';
import { openQuickTunnel } from '../tunnel.js';
import { isPortInUse, waitForPort } from '../runner.js';
import { checkFeature, checkLimit } from '../plan.js';
import { LockError, withLock } from '../lock.js';

export interface ShareOptions {
  port: number;
  /** optional: associate with an existing session by name/id */
  session?: string;
  /** custom subdomain (Pro feature) */
  subdomain?: string;
  /** wait for port to come up before opening tunnel */
  waitForPort?: boolean;
}

export async function shareCommand(opts: ShareOptions): Promise<number> {
  // 1. Subdomain is a Pro feature — gate it client-side
  if (opts.subdomain) {
    const gate = checkFeature('customSubdomains');
    if (!gate.allowed) {
      ui.error(gate.reason ?? 'Custom subdomains require Pro plan');
      ui.info(`Upgrade to ${gate.requiredPlan} to use --subdomain.`);
      ui.info(`For free, you'll get a random *.trycloudflare.com URL instead.`);
      return EXIT.PLAN_LIMIT_REACHED;
    }
    // v1.1: even on Pro we don't yet implement named tunnels — be honest
    ui.warn(
      `Custom subdomains require named tunnels (CF account). ` +
        `Coming in v1.2 — for now using a Quick Tunnel.`,
    );
  }

  // 2. Concurrent tunnel limit
  const running = reconcileSessions().filter(
    (s) => s.status === 'running' && s.tunnel,
  );
  const tunnelGate = checkLimit('maxConcurrentTunnels', running.length);
  if (!tunnelGate.allowed) {
    ui.error(tunnelGate.reason ?? 'Tunnel limit reached');
    if (tunnelGate.requiredPlan) {
      ui.info(`Upgrade to ${tunnelGate.requiredPlan} to open more tunnels.`);
    }
    return EXIT.PLAN_LIMIT_REACHED;
  }

  // 3. cloudflared must be installed
  const cf = await findCloudflared();
  if (!cf.found) {
    ui.error('cloudflared is not installed.');
    console.log();
    console.log(getInstallInstructions());
    return EXIT.DEPENDENCY_MISSING;
  }
  ui.dim(`Using cloudflared: ${cf.source} (${cf.version ?? 'unknown version'})`);

  // 4. Make sure something is actually listening on that port
  let portReady = await isPortInUse(opts.port);
  if (!portReady && opts.waitForPort) {
    const spinner = ora(`Waiting for port ${opts.port} to come up...`).start();
    portReady = await waitForPort(opts.port, 15_000);
    if (portReady) spinner.succeed(`Port ${opts.port} is ready`);
    else spinner.fail(`Port ${opts.port} is still not reachable`);
  }
  if (!portReady) {
    ui.error(`No service listening on port ${opts.port}.`);
    ui.info(`Start one first:  ${ui.code(`localzada start --port ${opts.port} -- <your-command>`)}`);
    ui.info(`Or pass ${ui.code('--wait')} to retry for up to 15s.`);
    return EXIT.NOT_FOUND;
  }

  // 5. Open the tunnel
  const sessionId = opts.session
    ? findSession(opts.session)?.id ?? generateSessionId()
    : generateSessionId();

  const spinner = ora('Opening Cloudflare Tunnel...').start();
  let tunnel;
  try {
    tunnel = await openQuickTunnel({ port: opts.port, sessionId });
    spinner.succeed('Tunnel is live');
  } catch (err) {
    spinner.fail('Failed to open tunnel');
    ui.error((err as Error).message);
    return EXIT.GENERIC_ERROR;
  }

  // 6. If the session existed, attach the tunnel to it (under lock)
  if (opts.session) {
    try {
      await withLock('sessions', () => {
        const session = findSession(opts.session!);
        if (session) updateSession(session.id, { tunnel });
      });
    } catch (err) {
      if (err instanceof LockError) {
        ui.warn(
          `Tunnel is live but couldn't attach it to session "${opts.session}" ` +
            `(sessions list locked). It will appear unattached in status.`,
        );
      } else {
        throw err;
      }
    }
  }

  // 7. Output
  console.log();
  ui.divider();
  console.log(`  ${ui.gray('Local:')}   http://localhost:${opts.port}`);
  console.log(`  ${ui.gray('Public:')}  ${ui.url(tunnel.publicUrl)}`);
  ui.divider();
  console.log();
  ui.info(`Tunnel PID: ${tunnel.pid}  ·  Logs: ${tunnel.logFile}`);
  ui.info(`Stop the tunnel:  ${ui.code(`localzada unshare ${sessionId}`)}`);

  return EXIT.OK;
}
