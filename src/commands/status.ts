/**
 * `localzada status` / `localzada list` — show running sessions
 * عرض حالة الجلسات
 */

import chalk from 'chalk';
import { ui, formatUptime } from '../ui.js';
import { EXIT } from '../constants.js';
import { reconcileSessions } from '../sessions.js';

export function statusCommand(): number {
  const sessions = reconcileSessions();

  if (sessions.length === 0) {
    ui.info('No sessions. Start one with:');
    ui.dim('  localzada start --port 3000 -- npm run dev');
    return EXIT.OK;
  }

  console.log();
  console.log(
    chalk.bold(
      pad('NAME', 20) +
        pad('PORT', 8) +
        pad('PID', 9) +
        pad('UPTIME', 12) +
        pad('STATUS', 10) +
        'PUBLIC',
    ),
  );
  ui.divider();

  for (const s of sessions) {
    const statusColored =
      s.status === 'running'
        ? chalk.green(s.status)
        : s.status === 'crashed'
          ? chalk.red(s.status)
          : chalk.gray(s.status);

    const publicUrl = s.tunnel?.publicUrl ?? chalk.gray('—');

    console.log(
      pad(s.name, 20) +
        pad(String(s.port), 8) +
        pad(String(s.pid), 9) +
        pad(s.status === 'running' ? formatUptime(s.startedAt) : '—', 12) +
        pad(statusColored, 10, true) +
        publicUrl,
    );
  }

  console.log();
  return EXIT.OK;
}

function pad(text: string, width: number, hasAnsi = false): string {
  // chalk wraps strings in ANSI escape codes which inflate .length;
  // strip them when measuring width.
  const visibleLen = hasAnsi
    ? text.replace(/\x1b\[[0-9;]*m/g, '').length
    : text.length;
  if (visibleLen >= width) return text + ' ';
  return text + ' '.repeat(width - visibleLen);
}
