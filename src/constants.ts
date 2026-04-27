/**
 * Constants and plan-based limits
 * الثوابت وحدود الخطط
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PlanLimits } from './types.js';

export const APP_NAME = 'localzada';
export const APP_VERSION = '1.1.0';

// Storage paths (cross-platform)
// node:os homedir() works on Windows, macOS, and Linux
export const HOME = homedir();
export const APP_DIR = join(HOME, '.localzada');
export const SESSIONS_DIR = join(APP_DIR, 'sessions');
export const LOGS_DIR = join(APP_DIR, 'logs');
export const BIN_DIR = join(APP_DIR, 'bin');         // for bundled cloudflared
export const CONFIG_FILE = join(APP_DIR, 'config.json');
export const SESSIONS_FILE = join(APP_DIR, 'sessions.json');

// Cloudflare Tunnel
export const CLOUDFLARED_BIN_NAMES = {
  win32: 'cloudflared.exe',
  darwin: 'cloudflared',
  linux: 'cloudflared',
} as const;

// Plan limits — the open core gating happens here
export const PLAN_LIMITS: Record<'free' | 'pro' | 'enterprise', PlanLimits> = {
  free: {
    maxConcurrentSessions: 2,
    maxConcurrentTunnels: 1,
    customSubdomains: false,
    persistentTunnels: false,
    teamFeatures: false,
    prioritySupport: false,
  },
  pro: {
    maxConcurrentSessions: 10,
    maxConcurrentTunnels: 5,
    customSubdomains: true,
    persistentTunnels: true,
    teamFeatures: false,
    prioritySupport: true,
  },
  enterprise: {
    maxConcurrentSessions: Infinity,
    maxConcurrentTunnels: Infinity,
    customSubdomains: true,
    persistentTunnels: true,
    teamFeatures: true,
    prioritySupport: true,
  },
};

// Exit codes (consistent across the app)
export const EXIT = {
  OK: 0,
  GENERIC_ERROR: 1,
  INVALID_USAGE: 2,
  NOT_FOUND: 3,
  ALREADY_RUNNING: 4,
  PORT_IN_USE: 5,
  DEPENDENCY_MISSING: 6,
  PLAN_LIMIT_REACHED: 7,
} as const;
