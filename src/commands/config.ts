/**
 * `localzada config` — view/set configuration
 * إدارة الإعدادات
 */

import chalk from 'chalk';
import { ui } from '../ui.js';
import { EXIT, PLAN_LIMITS } from '../constants.js';
import { getConfig, setConfigValue, resetConfig } from '../config.js';
import type { LocalzadaConfig } from '../types.js';

const ALLOWED_KEYS: Array<keyof LocalzadaConfig> = [
  'plan',
  'licenseKey',
  'tunnelProvider',
  'banner',
  'lang',
  'telemetry',
];

export function configGet(key?: string): number {
  const cfg = getConfig();
  if (!key) {
    console.log();
    for (const k of ALLOWED_KEYS) {
      const v = cfg[k];
      const display =
        k === 'licenseKey' && v ? maskLicense(String(v)) : String(v ?? '—');
      console.log(`  ${chalk.bold(k.padEnd(18))} ${display}`);
    }
    console.log();

    const limits = PLAN_LIMITS[cfg.plan];
    console.log(chalk.bold(`Plan limits (${cfg.plan}):`));
    for (const [k, v] of Object.entries(limits)) {
      console.log(`  ${k.padEnd(28)} ${v}`);
    }
    console.log();
    return EXIT.OK;
  }

  if (!ALLOWED_KEYS.includes(key as keyof LocalzadaConfig)) {
    ui.error(`Unknown key: ${key}`);
    ui.info(`Valid keys: ${ALLOWED_KEYS.join(', ')}`);
    return EXIT.INVALID_USAGE;
  }
  const v = cfg[key as keyof LocalzadaConfig];
  console.log(v ?? '');
  return EXIT.OK;
}

export function configSet(key: string, value: string): number {
  if (!ALLOWED_KEYS.includes(key as keyof LocalzadaConfig)) {
    ui.error(`Unknown key: ${key}`);
    ui.info(`Valid keys: ${ALLOWED_KEYS.join(', ')}`);
    return EXIT.INVALID_USAGE;
  }

  // Type-coerce specific keys
  if (key === 'plan') {
    if (!['free', 'pro', 'enterprise'].includes(value)) {
      ui.error(`plan must be one of: free, pro, enterprise`);
      return EXIT.INVALID_USAGE;
    }
    // NOTE: setting plan directly is a dev/internal escape hatch.
    // Real upgrades happen via `localzada license activate <key>`.
    ui.warn(
      `Setting plan directly bypasses license validation. ` +
        `For real activation use: ${ui.code('localzada license activate <key>')}`,
    );
    setConfigValue('plan', value as LocalzadaConfig['plan']);
  } else if (key === 'banner' || key === 'telemetry') {
    setConfigValue(key, value === 'true');
  } else if (key === 'lang') {
    if (!['en', 'ar'].includes(value)) {
      ui.error(`lang must be one of: en, ar`);
      return EXIT.INVALID_USAGE;
    }
    setConfigValue('lang', value as LocalzadaConfig['lang']);
  } else {
    // licenseKey, tunnelProvider — store raw string
    setConfigValue(
      key as keyof LocalzadaConfig,
      value as never,
    );
  }

  ui.success(`Set ${key} = ${key === 'licenseKey' ? maskLicense(value) : value}`);
  return EXIT.OK;
}

export function configReset(): number {
  resetConfig();
  ui.success('Configuration reset to defaults.');
  return EXIT.OK;
}

function maskLicense(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
