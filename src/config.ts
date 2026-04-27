/**
 * Configuration management using `conf` package
 * إدارة الإعدادات
 */

import Conf from 'conf';
import type { LocalzadaConfig } from './types.js';
import { APP_NAME } from './constants.js';

const defaults: LocalzadaConfig = {
  plan: 'free',
  tunnelProvider: 'cloudflare',
  banner: true,
  lang: 'en',
  telemetry: false,
};

/**
 * Conf handles cross-platform config storage automatically:
 * - Windows: %APPDATA%\localzada-nodejs\config.json
 * - macOS:   ~/Library/Preferences/localzada-nodejs/config.json
 * - Linux:   ~/.config/localzada-nodejs/config.json
 */
export const config = new Conf<LocalzadaConfig>({
  projectName: APP_NAME,
  defaults,
});

export function getConfig(): LocalzadaConfig {
  return config.store;
}

export function setConfigValue<K extends keyof LocalzadaConfig>(
  key: K,
  value: LocalzadaConfig[K],
): void {
  config.set(key, value);
}

export function resetConfig(): void {
  config.clear();
}
