/**
 * UI helpers — colored output, banners, tables
 * وحدة عرض الرسائل الملونة
 */

import chalk from 'chalk';

export const ui = {
  success: (msg: string) => console.log(chalk.green('✓'), msg),
  info: (msg: string) => console.log(chalk.cyan('ℹ'), msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
  error: (msg: string) => console.error(chalk.red('✗'), msg),
  step: (msg: string) => console.log(chalk.gray('→'), msg),
  /** Print a dimmed line */
  dim: (msg: string) => console.log(chalk.gray(msg)),

  banner: () => {
    console.log();
    console.log(chalk.bold.cyan('  Localzada') + chalk.gray(' v1.1.0'));
    console.log(chalk.gray('  Run and share local servers with one command'));
    console.log();
  },

  divider: () => console.log(chalk.gray('─'.repeat(50))),

  /** highlight a URL (returns string for inline use) */
  url: (url: string) => chalk.bold.underline.blue(url),

  /** highlight a code/command snippet (returns string for inline use) */
  code: (text: string) => chalk.bold.white(text),

  /** dim text inline (returns string, doesn't print) */
  gray: (text: string) => chalk.gray(text),
};

/** Format bytes into human readable */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/** Format uptime in seconds to human-readable */
export function formatUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}
