/**
 * Cloudflare Tunnel (cloudflared) integration
 * دمج Cloudflare Tunnel
 *
 * Strategy:
 * 1. Check if `cloudflared` exists on PATH (system install) — preferred.
 * 2. Check our bundled location at ~/.localzada/bin/cloudflared(.exe).
 * 3. If neither: print platform-specific install instructions.
 *
 * We deliberately do NOT auto-download cloudflared in v1.1 — that's a
 * larger surface (signature verification, GitHub API rate limits, write
 * permissions on Windows). Slated for v1.2.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import { execa } from 'execa';
import { BIN_DIR, CLOUDFLARED_BIN_NAMES } from './constants.js';

export interface CloudflaredLocation {
  found: boolean;
  path?: string;
  source?: 'system' | 'bundled';
  version?: string;
}

function getBundledPath(): string {
  const plat = platform() as keyof typeof CLOUDFLARED_BIN_NAMES;
  const binName = CLOUDFLARED_BIN_NAMES[plat] ?? 'cloudflared';
  return join(BIN_DIR, binName);
}

export async function findCloudflared(): Promise<CloudflaredLocation> {
  // 1. Try system PATH
  try {
    const { stdout } = await execa('cloudflared', ['--version'], {
      timeout: 5000,
    });
    return {
      found: true,
      path: 'cloudflared',
      source: 'system',
      version: stdout.split('\n')[0]?.trim(),
    };
  } catch {
    // not on PATH — keep going
  }

  // 2. Try bundled location
  const bundled = getBundledPath();
  if (existsSync(bundled)) {
    try {
      const { stdout } = await execa(bundled, ['--version'], { timeout: 5000 });
      return {
        found: true,
        path: bundled,
        source: 'bundled',
        version: stdout.split('\n')[0]?.trim(),
      };
    } catch {
      // bundled binary is corrupt
    }
  }

  return { found: false };
}

export function getInstallInstructions(): string {
  const plat = platform();
  const lines: string[] = ['Cloudflared is not installed. Install it via:'];

  switch (plat) {
    case 'darwin':
      lines.push('  brew install cloudflared');
      break;
    case 'linux':
      lines.push('  # Debian/Ubuntu:');
      lines.push('  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb');
      lines.push('  sudo dpkg -i cloudflared.deb');
      lines.push('');
      lines.push('  # Arch:');
      lines.push('  yay -S cloudflared-bin');
      break;
    case 'win32':
      lines.push('  # Winget:');
      lines.push('  winget install --id Cloudflare.cloudflared');
      lines.push('');
      lines.push('  # Or download from:');
      lines.push('  https://github.com/cloudflare/cloudflared/releases/latest');
      break;
    default:
      lines.push(`  Visit: https://github.com/cloudflare/cloudflared/releases/latest`);
  }

  return lines.join('\n');
}
