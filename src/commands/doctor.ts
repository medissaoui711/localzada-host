/**
 * `localzada doctor` — environment health check
 * فحص البيئة
 */

import { platform, arch, release } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import chalk from 'chalk';
import { ui } from '../ui.js';
import { APP_DIR, APP_VERSION, EXIT, LOGS_DIR } from '../constants.js';
import { findCloudflared, getInstallInstructions } from '../cloudflared.js';
import { getCurrentPlan } from '../plan.js';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fixHint?: string;
}

export async function doctorCommand(): Promise<number> {
  const checks: Check[] = [];

  // Node version
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'Node.js >= 18',
    ok: nodeMajor >= 18,
    detail: `v${process.versions.node}`,
    fixHint: nodeMajor < 18 ? 'Upgrade to Node.js 18 or newer' : undefined,
  });

  // App dirs writable
  let dirsOk = true;
  let dirDetail = APP_DIR;
  try {
    if (!existsSync(APP_DIR)) mkdirSync(APP_DIR, { recursive: true });
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
  } catch (err) {
    dirsOk = false;
    dirDetail = `${APP_DIR} (${(err as Error).message})`;
  }
  checks.push({
    name: 'App data directory',
    ok: dirsOk,
    detail: dirDetail,
    fixHint: !dirsOk ? `Check write permissions for ${APP_DIR}` : undefined,
  });

  // cloudflared
  const cf = await findCloudflared();
  checks.push({
    name: 'cloudflared (for share)',
    ok: cf.found,
    detail: cf.found
      ? `${cf.source}: ${cf.version ?? 'unknown'}`
      : 'not installed',
    fixHint: !cf.found ? getInstallInstructions() : undefined,
  });

  // Print
  ui.banner();
  console.log(chalk.bold('System'));
  console.log(chalk.gray(`  OS:        ${platform()} ${release()} (${arch()})`));
  console.log(chalk.gray(`  Localzada: v${APP_VERSION}`));
  console.log(chalk.gray(`  Plan:      ${getCurrentPlan()}`));
  console.log();

  console.log(chalk.bold('Checks'));
  for (const c of checks) {
    const mark = c.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${mark} ${c.name.padEnd(28)} ${chalk.gray(c.detail)}`);
  }
  console.log();

  const failed = checks.filter((c) => !c.ok);
  if (failed.length === 0) {
    ui.success('All checks passed.');
    return EXIT.OK;
  }

  console.log(chalk.bold.yellow('Suggested fixes:'));
  for (const c of failed) {
    if (c.fixHint) {
      console.log();
      console.log(`  ${chalk.bold(c.name)}:`);
      for (const line of c.fixHint.split('\n')) {
        console.log(`    ${line}`);
      }
    }
  }

  return EXIT.GENERIC_ERROR;
}
