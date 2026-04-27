/**
 * Print what user-facing error messages actually look like.
 * Run: npx tsx scripts/preview-errors.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadYaml,
  YamlValidationError,
  YamlLoadError,
} from '../src/yaml/loader.js';

const tmpRoot = mkdtempSync(join(tmpdir(), 'lz-preview-'));

function showError(label: string, content: string): void {
  console.log('━'.repeat(70));
  console.log(`Case: ${label}`);
  console.log('━'.repeat(70));
  console.log('YAML:');
  console.log(content.split('\n').map((l) => `  | ${l}`).join('\n'));
  console.log();

  const dir = join(tmpRoot, label.replace(/\s+/g, '-'));
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'localzada.yaml');
  writeFileSync(filePath, content, 'utf-8');

  try {
    loadYaml(filePath);
    console.log('✓ Validated successfully');
  } catch (err) {
    if (err instanceof YamlValidationError) {
      console.log(`✗ ${err.message}`);
      for (const iss of err.issues) {
        console.log(`    ${iss.path}: ${iss.message}`);
      }
    } else if (err instanceof YamlLoadError) {
      console.log(`✗ ${err.message}`);
    } else {
      console.log(`✗ Unknown: ${(err as Error).message}`);
    }
  }
  console.log();
}

showError('typo: command instead of cmd', `version: 1
profile: app
services:
  api:
    command: npm run dev
    port: 3000`);

showError('missing version', `profile: app
services:
  api:
    cmd: x`);

showError('cyclic dependsOn', `version: 1
profile: app
services:
  a:
    cmd: x
    dependsOn: [b]
  b:
    cmd: y
    dependsOn: [a]`);

showError('tunnel.type:named without hostname', `version: 1
profile: app
services:
  api:
    cmd: x
    port: 8000
tunnel:
  type: named
  service: http://localhost:8000`);

showError('multiple errors at once', `version: 99
profile: APP
services:
  bad-service:
    command: x
    port: 99999`);

rmSync(tmpRoot, { recursive: true, force: true });
