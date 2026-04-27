#!/usr/bin/env node
/**
 * Localzada CLI entry point
 *
 * Command surface (mirrors v1 bash script + new commands):
 *   localzada install        (legacy alias — use npm install instead)
 *   localzada start --port <p> [--name <n>] -- <command...>
 *   localzada share --port <p> [--subdomain <s>] [--wait]
 *   localzada unshare [<id>]
 *   localzada stop [<id>] [--all]
 *   localzada status | list
 *   localzada logs <id> [-f] [-n <lines>]
 *   localzada doctor
 *   localzada config <get|set|reset> [key] [value]
 */

import { Command } from 'commander';
import { APP_VERSION } from './constants.js';
import { startCommand } from './commands/start.js';
import { shareCommand } from './commands/share.js';
import { stopCommand } from './commands/stop.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { doctorCommand } from './commands/doctor.js';
import { unshareCommand } from './commands/unshare.js';
import { configGet, configSet, configReset } from './commands/config.js';
import { ui } from './ui.js';

const program = new Command();

program
  .name('localzada')
  .description('Run and share local servers with one command.')
  .version(APP_VERSION, '-v, --version')
  .showHelpAfterError(true)
  .configureHelp({ sortSubcommands: true });

// ---------------- start ----------------
program
  .command('start')
  .description('Start a local server in the background')
  .requiredOption('-p, --port <port>', 'local port to bind/track', (v) => parseInt(v, 10))
  .option('-n, --name <name>', 'friendly name for this session')
  .argument('<command...>', 'command to run (e.g. npm run dev)')
  .action(async (commandArgs: string[], opts) => {
    const [cmd, ...args] = commandArgs;
    if (!cmd) {
      ui.error('You must provide a command to run.');
      process.exit(2);
    }
    const code = await startCommand({
      port: opts.port,
      name: opts.name,
      command: cmd,
      args,
      cwd: process.cwd(),
    });
    process.exit(code);
  });

// ---------------- share ----------------
program
  .command('share')
  .description('Open a public Cloudflare Tunnel to a local port')
  .requiredOption('-p, --port <port>', 'local port to share', (v) => parseInt(v, 10))
  .option('-s, --session <idOrName>', 'attach tunnel to existing session')
  .option('--subdomain <name>', 'custom subdomain (Pro plan)')
  .option('--wait', 'wait up to 15s for the port to come up', false)
  .action(async (opts) => {
    const code = await shareCommand({
      port: opts.port,
      session: opts.session,
      subdomain: opts.subdomain,
      waitForPort: opts.wait,
    });
    process.exit(code);
  });

// ---------------- unshare ----------------
program
  .command('unshare [idOrName]')
  .description('Close a tunnel (without stopping the local server)')
  .action(async (idOrName?: string) => {
    const code = await unshareCommand(idOrName);
    process.exit(code);
  });

// ---------------- stop ----------------
program
  .command('stop [idOrName]')
  .description('Stop a running session')
  .option('-a, --all', 'stop all sessions', false)
  .action(async (idOrName: string | undefined, opts) => {
    const code = await stopCommand(idOrName, opts.all);
    process.exit(code);
  });

// ---------------- status / list ----------------
program
  .command('status')
  .alias('list')
  .alias('ls')
  .description('Show running sessions')
  .action(() => {
    const code = statusCommand();
    process.exit(code);
  });

// ---------------- logs ----------------
program
  .command('logs <idOrName>')
  .description('Print logs of a session')
  .option('-f, --follow', 'follow new log output', false)
  .option('-n, --lines <count>', 'number of trailing lines', (v) => parseInt(v, 10), 50)
  .action(async (idOrName: string, opts) => {
    const code = await logsCommand(idOrName, {
      follow: opts.follow,
      lines: opts.lines,
    });
    process.exit(code);
  });

// ---------------- doctor ----------------
program
  .command('doctor')
  .description('Diagnose your environment')
  .action(async () => {
    const code = await doctorCommand();
    process.exit(code);
  });

// ---------------- config ----------------
const configCmd = program
  .command('config')
  .description('Get/set Localzada configuration');

configCmd
  .command('get [key]')
  .description('Print configuration value(s)')
  .action((key?: string) => {
    process.exit(configGet(key));
  });

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action((key: string, value: string) => {
    process.exit(configSet(key, value));
  });

configCmd
  .command('reset')
  .description('Reset configuration to defaults')
  .action(() => {
    process.exit(configReset());
  });

// ---------------- install (legacy compatibility) ----------------
program
  .command('install')
  .description('(legacy) — install via npm instead: `npm install -g localzada`')
  .action(() => {
    ui.info('Localzada v1.1+ is distributed via npm.');
    ui.info('Install or upgrade with:');
    console.log('  npm install -g localzada');
    process.exit(0);
  });

// Global error handler so unexpected throws don't print ugly stacktraces
process.on('uncaughtException', (err) => {
  ui.error(`Unexpected error: ${err.message}`);
  if (process.env.LOCALZADA_DEBUG) console.error(err.stack);
  process.exit(1);
});

// Signal handling: ensure clean exit on Ctrl+C and SIGTERM.
// Locks are released via the per-command try/finally; this handler
// guarantees the process actually exits even if a long-running command
// (e.g. `logs -f`) is mid-flight.
let shuttingDown = false;
function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  // exit code 130 is conventional for SIGINT (128 + 2)
  const code = signal === 'SIGINT' ? 130 : 143;
  process.exit(code);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

program.parseAsync(process.argv).catch((err) => {
  ui.error(err.message);
  process.exit(1);
});
